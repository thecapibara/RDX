pub mod deobfuscator;
pub mod models;

use chrono::Utc;
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::Value;
use std::sync::LazyLock;

use crate::client::HttpClient;
use crate::parser::deobfuscator::StreamDeobfuscator;
pub use crate::parser::models::*;

// Catalog Selectors
static ITEM_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item").unwrap());
static LINK_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item-link > a").unwrap());
static MISC_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item-link .misc").unwrap());
static COVER_IMG_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item-cover img").unwrap());
static CAT_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item-cover .cat .entity").unwrap());
static INFO_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-content__inline_item-cover .info").unwrap());
static RATING_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".rating i, .hd-tooltip").unwrap());

// Autocomplete Selectors & Regex
static AUTO_ITEM_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-search__section_list li a").unwrap());
static AUTO_ENTY_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".enty").unwrap());
static AUTO_RATING_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".rating, .rating-green-string").unwrap());
static PAREN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\((.*?)\)").unwrap());

// Details Selectors & Regex
static TITLE_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("div.b-post__title > h1, .b-post__title").unwrap());
static ORIG_TITLE_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("div.b-post__origtitle").unwrap());
static POSTER_IMG_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("div.b-sidecover img").unwrap());
static POSTER_LINK_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("div.b-sidecover a").unwrap());
static IMDB_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-post__info_rates.imdb .bold").unwrap());
static KP_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-post__info_rates.kp .bold").unwrap());
static DESC_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("div.b-post__description_text").unwrap());
static TABLE_TR_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("table.b-post__info tr").unwrap());
static TD_L_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("td.l").unwrap());
static TD_R_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("td:nth-child(2)").unwrap());
static TRANS_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("#translators-list [data-translator_id]").unwrap());
static IMG_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("img").unwrap());
static SEASON_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-simple_season__item").unwrap());
static EPISODE_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-simple_episode__item").unwrap());
static RELATED_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-sidelist .b-content__inline_item, .b-content__inline_items .b-content__inline_item").unwrap());
static PART_ITEM_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".b-post__partcontent .b-post__partcontent_item").unwrap());
static PART_TITLE_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".title").unwrap());
static PART_YEAR_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".year").unwrap());
static PART_RATING_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse(".rating").unwrap());
static PART_LINK_SEL: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());
static INIT_CDN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"sof\.tv\.initCDN(?:Movies|Series)Events\(\s*(\d+)\s*,\s*(\d+)").unwrap());
static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/(\d+)-[^/]+\.html").unwrap());
static YEAR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(19\d{2}|20\d{2})\b").unwrap());

pub struct RezkaParser;

impl RezkaParser {
    fn normalize_link(url: &str, base_url: &str) -> String {
        let trimmed = url.trim();
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else {
            let base = base_url.trim_end_matches('/');
            let path = trimmed.trim_start_matches('/');
            format!("{}/{}", base, path)
        }
    }

    /// Rewrites any full HDRezka page URL (e.g. from bookmarks/history on an older mirror) to the active mirror
    pub fn rewrite_to_mirror(url: &str, base_url: &str) -> String {
        let trimmed = url.trim();
        let base = base_url.trim_end_matches('/');
        if let Ok(parsed) = url::Url::parse(trimmed) {
            let path = parsed.path();
            let query = parsed.query().map(|q| format!("?{}", q)).unwrap_or_default();
            format!("{}{}{}", base, path, query)
        } else {
            let path = trimmed.trim_start_matches('/');
            format!("{}/{}", base, path)
        }
    }

    /// Parses a single `.b-content__inline_item` element into a `MediaCard`
    fn parse_card_element(element: scraper::ElementRef, base_url: &str) -> Option<MediaCard> {
        let data_url = element.value().attr("data-url");

        let (title, url) = if let Some(link_elem) = element.select(&LINK_SEL).next() {
            let t = link_elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
            let u = data_url
                .or_else(|| link_elem.value().attr("href"))
                .unwrap_or_default();
            (t, u.to_string())
        } else {
            (String::new(), data_url.unwrap_or_default().to_string())
        };

        if title.is_empty() && url.is_empty() {
            return None;
        }

        let id = element
            .value()
            .attr("data-id")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                ID_RE
                    .captures(&url)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
            })
            .unwrap_or_default();

        let poster = element
            .select(&COVER_IMG_SEL)
            .next()
            .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
            .map(|s| Self::normalize_link(s, base_url))
            .unwrap_or_default();

        let entity_type = element
            .select(&CAT_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_else(|| "Фильм".to_string());

        let series_info = element
            .select(&INFO_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        let misc_info = element
            .select(&MISC_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default();

        let rating = element
            .select(&RATING_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        let full_url = Self::normalize_link(&url, base_url);

        Some(MediaCard {
            id,
            url: full_url,
            title,
            poster,
            entity_type,
            series_info,
            misc_info,
            rating,
        })
    }

    /// Parses catalog items list from HTML (Home, Category, Search pages)
    pub fn parse_catalog_html(html: &str, base_url: &str) -> Vec<MediaCard> {
        let document = Html::parse_document(html);
        document
            .select(&ITEM_SEL)
            .filter_map(|el| Self::parse_card_element(el, base_url))
            .collect()
    }

    /// Fetches and parses Home page catalog rows
    pub async fn get_home_catalog(
        client: &HttpClient,
        base_url: &str,
        filter: Option<&str>,
        genre: Option<&str>,
        page: Option<u32>,
    ) -> Result<Vec<MediaCard>, Box<dyn std::error::Error + Send + Sync>> {
        let base = base_url.trim_end_matches('/');
        let mut query_params = Vec::new();

        if let Some(f) = filter {
            query_params.push(format!("filter={}", f));
        }
        if let Some(g) = genre {
            query_params.push(format!("genre={}", g));
        }
        if let Some(p) = page {
            if p > 1 {
                query_params.push(format!("page={}", p));
            }
        }

        let url = if query_params.is_empty() {
            format!("{}/", base)
        } else {
            format!("{}/?{}", base, query_params.join("&"))
        };

        let html = client.get_html(&url, None).await?;
        Ok(Self::parse_catalog_html(&html, base_url))
    }

    /// Builds full HDRezka category URL supporting optional genre, sort filter, and pagination
    pub fn build_category_url(
        base_url: &str,
        category_path: &str,
        genre: Option<&str>,
        filter: Option<&str>,
        page: Option<u32>,
    ) -> String {
        let base = base_url.trim_end_matches('/');
        let cat = category_path.trim_matches('/');

        let mut path_parts = vec![cat.to_string()];
        if let Some(g) = genre {
            let clean_g = g.trim().trim_matches('/');
            if !clean_g.is_empty() {
                path_parts.push(clean_g.to_string());
            }
        }

        let base_path = path_parts.join("/");
        let full_path = match page {
            Some(p) if p > 1 => format!("{}/page/{}/", base_path, p),
            _ => format!("{}/", base_path),
        };

        if let Some(f) = filter {
            let clean_f = f.trim();
            if !clean_f.is_empty() && clean_f != "last" {
                format!("{}/{}?filter={}", base, full_path, clean_f)
            } else {
                format!("{}/{}", base, full_path)
            }
        } else {
            format!("{}/{}", base, full_path)
        }
    }

    /// Fetches and parses category catalog pages (/films/, /series/, /cartoons/, /animation/)
    /// with optional genre (/films/comedy/), sort filter (?filter=popular), and page (/page/2/)
    pub async fn get_category_catalog(
        client: &HttpClient,
        base_url: &str,
        category_path: &str,
        genre: Option<&str>,
        filter: Option<&str>,
        page: Option<u32>,
    ) -> Result<Vec<MediaCard>, Box<dyn std::error::Error + Send + Sync>> {
        let url = Self::build_category_url(base_url, category_path, genre, filter, page);
        let html = client.get_html(&url, None).await?;
        Ok(Self::parse_catalog_html(&html, base_url))
    }

    /// Full search query (/search/?do=search&subaction=search&q=...)
    pub async fn search_media(
        client: &HttpClient,
        base_url: &str,
        query: &str,
    ) -> Result<Vec<MediaCard>, Box<dyn std::error::Error + Send + Sync>> {
        let base = base_url.trim_end_matches('/');
        let encoded_q = urlencoding::encode(query);
        let url = format!("{}/search/?do=search&subaction=search&q={}", base, encoded_q);

        let html = client.get_html(&url, None).await?;
        Ok(Self::parse_catalog_html(&html, base_url))
    }

    /// Live search autocomplete (/engine/ajax/search.php)
    pub async fn search_autocomplete(
        client: &HttpClient,
        base_url: &str,
        query: &str,
    ) -> Result<Vec<SearchItem>, Box<dyn std::error::Error + Send + Sync>> {
        let base = base_url.trim_end_matches('/');
        let url = format!("{}/engine/ajax/search.php", base);
        let params = [("q", query)];

        let html = client.post_ajax(&url, &params, Some(base)).await?;
        let document = Html::parse_fragment(&html);
        let mut items = Vec::new();

        for link in document.select(&AUTO_ITEM_SEL) {
            let href = link.value().attr("href").unwrap_or_default();
            let full_url = Self::normalize_link(href, base_url);

            let title = link
                .select(&AUTO_ENTY_SEL)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            let rating = link
                .select(&AUTO_RATING_SEL)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

            // Full text inside <a> contains (Original Title, Type, Year)
            let full_text = link.text().collect::<Vec<_>>().join(" ");

            let mut orig_title = None;
            let mut entity_type = None;
            let mut year = None;

            if let Some(cap) = PAREN_RE.captures(&full_text) {
                if let Some(meta_str) = cap.get(1) {
                    let parts: Vec<&str> = meta_str.as_str().split(',').map(|s| s.trim()).collect();
                    if !parts.is_empty() {
                        orig_title = Some(parts[0].to_string());
                    }
                    if parts.len() >= 2 {
                        entity_type = Some(parts[1].to_string());
                    }
                    if parts.len() >= 3 {
                        year = Some(parts[2].to_string());
                    }
                }
            }

            if !title.is_empty() {
                items.push(SearchItem {
                    title,
                    orig_title,
                    year,
                    entity_type,
                    rating,
                    url: full_url,
                });
            }
        }

        Ok(items)
    }

    /// Parses full media detail page HTML
    pub fn parse_media_details(html: &str, page_url: &str, base_url: &str) -> Result<MediaDetails, String> {
        let document = Html::parse_document(html);

        // Title
        let title = document
            .select(&TITLE_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default();

        if title.is_empty() {
            return Err("Failed to parse media title from page".to_string());
        }

        // Original Title
        let orig_title = document
            .select(&ORIG_TITLE_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        // Posters
        let poster = document
            .select(&POSTER_IMG_SEL)
            .next()
            .and_then(|img| img.value().attr("src"))
            .map(|s| Self::normalize_link(s, base_url))
            .unwrap_or_default();

        let high_res_poster = document
            .select(&POSTER_LINK_SEL)
            .next()
            .and_then(|a| a.value().attr("href"))
            .map(|s| Self::normalize_link(s, base_url));

        // Ratings
        let imdb_rating = document
            .select(&IMDB_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

        let kp_rating = document
            .select(&KP_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

        // Description
        let description = document
            .select(&DESC_SEL)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join("\n").trim().to_string())
            .unwrap_or_default();

        // Info table
        let mut info_table = Vec::new();

        for tr in document.select(&TABLE_TR_SEL) {
            if let (Some(l_elem), Some(r_elem)) = (tr.select(&TD_L_SEL).next(), tr.select(&TD_R_SEL).next()) {
                let key = l_elem.text().collect::<Vec<_>>().join(" ").trim().trim_end_matches(':').trim().to_string();
                let val = r_elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                if !key.is_empty() && !val.is_empty() {
                    info_table.push((key, val));
                }
            }
        }

        // Translators: deduplicate by id (rezka can contain hidden SEO <a> tags)
        let mut translators: Vec<Translator> = Vec::new();

        for elem in document.select(&TRANS_SEL) {
            let id = elem.value().attr("data-translator_id").unwrap_or_default();
            if id.is_empty() {
                continue;
            }

            let text_val = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
            let name = if !text_val.is_empty() {
                text_val
            } else {
                elem.value().attr("title").unwrap_or_default().trim().to_string()
            };

            let is_active = elem.value().classes().any(|c| c == "active");
            let is_premium = elem.value().classes().any(|c| c == "b-prem_translator");

            let language = elem
                .select(&IMG_SEL)
                .next()
                .and_then(|img| img.value().attr("title").or_else(|| img.value().attr("alt")))
                .map(|s| s.to_string())
                .or_else(|| {
                    elem.value().attr("title").filter(|t| t.contains("Украин") || t.contains("Україн")).map(|s| s.to_string())
                });

            if let Some(existing) = translators.iter_mut().find(|t| t.id == id) {
                existing.is_active = existing.is_active || is_active;
                existing.is_premium = existing.is_premium || is_premium;
                if existing.language.is_none() && language.is_some() {
                    existing.language = language;
                }
                if existing.name.is_empty() && !name.is_empty() {
                    existing.name = name;
                }
            } else {
                translators.push(Translator {
                    id: id.to_string(),
                    name,
                    language,
                    is_active,
                    is_premium,
                });
            }
        }

        // Seasons tabs (.b-simple_season__item matches both <li> and <a>)
        let mut seasons: Vec<SeasonTab> = Vec::new();
        let mut seen_seasons: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for elem in document.select(&SEASON_SEL) {
            let tab_id = elem.value().attr("data-tab_id").unwrap_or_default();
            if !tab_id.is_empty() && seen_seasons.insert(tab_id) {
                let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                seasons.push(SeasonTab {
                    id: tab_id.to_string(),
                    title,
                });
            }
        }

        // Episodes tabs (.b-simple_episode__item matches both <li> and <a>)
        let mut episodes: Vec<EpisodeTab> = Vec::new();
        let mut seen_episodes: std::collections::HashSet<(&str, &str)> = std::collections::HashSet::new();
        for elem in document.select(&EPISODE_SEL) {
            let season_id = elem.value().attr("data-season_id").unwrap_or_default();
            let episode_id = elem.value().attr("data-episode_id").unwrap_or_default();

            if !season_id.is_empty()
                && !episode_id.is_empty()
                && seen_episodes.insert((season_id, episode_id))
            {
                let ep_title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                episodes.push(EpisodeTab {
                    season_id: season_id.to_string(),
                    episode_id: episode_id.to_string(),
                    title: ep_title,
                });
            }
        }

        // Extract media id and fallback translator_id from URL or initCDN scripts
        let init_caps = INIT_CDN_RE.captures(html);

        let media_id = if let Some(cap) = ID_RE.captures(page_url) {
            cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default()
        } else {
            init_caps
                .as_ref()
                .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
                .unwrap_or_default()
        };

        // Single-translator movies/series on HDRezka omit #translators-list and pass translator_id in initCDN*Events
        if translators.is_empty() {
            if let Some(trans_id) = init_caps
                .as_ref()
                .and_then(|c| c.get(2).map(|m| m.as_str().to_string()))
            {
                translators.push(Translator {
                    id: trans_id,
                    name: "Оригінал / Дубляж".to_string(),
                    language: None,
                    is_active: true,
                    is_premium: false,
                });
            }
        }

        // Extract initial embedded player streams from inline script
        let initial_streams = Self::extract_inline_player_info(html);

        // Extract "Similar / Watch Also" cards from the details page
        let mut related: Vec<MediaCard> = document
            .select(&RELATED_SEL)
            .filter_map(|el| Self::parse_card_element(el, base_url))
            .filter(|c| c.id != media_id && !c.url.is_empty())
            .collect();
        if related.is_empty() {
            related = document
                .select(&ITEM_SEL)
                .filter_map(|el| Self::parse_card_element(el, base_url))
                .filter(|c| c.id != media_id && !c.url.is_empty())
                .collect();
        }

        let franchise = Self::parse_franchise(&document, page_url, base_url);

        Ok(MediaDetails {
            id: media_id,
            url: page_url.to_string(),
            title,
            orig_title,
            poster,
            high_res_poster,
            imdb_rating,
            kp_rating,
            description,
            info_table,
            translators,
            seasons,
            episodes,
            initial_streams,
            related,
            franchise,
        })
    }

    /// Lightweight fallback to extract just the cover poster from an HDRezka page when TMDB has no match.
    pub async fn get_poster_from_page(
        client: &HttpClient,
        base_url: &str,
        item_url: &str,
    ) -> Option<String> {
        let base = base_url.trim_end_matches('/');
        let page_url = Self::normalize_link(item_url, base);
        let html = client.get_html(&page_url, Some(base)).await.ok()?;
        let document = Html::parse_document(&html);
        document
            .select(&POSTER_IMG_SEL)
            .next()
            .and_then(|img| {
                img.value()
                    .attr("src")
                    .or_else(|| img.value().attr("data-src"))
            })
            .map(|s| Self::normalize_link(s, base))
            .filter(|s| !s.is_empty())
    }

    /// Parses HDRezka franchise / series chronology block (`.b-post__partcontent`) sorted by release year.
    fn parse_franchise(document: &Html, page_url: &str, base_url: &str) -> Vec<FranchisePart> {
        let mut raw_parts: Vec<(Option<u32>, usize, FranchisePart)> = Vec::new();

        for (idx, el) in document.select(&PART_ITEM_SEL).enumerate() {
            let is_current = el.value().classes().any(|c| c == "current");

            let raw_url = el
                .value()
                .attr("data-url")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    el.select(&PART_LINK_SEL)
                        .next()
                        .and_then(|a| a.value().attr("href"))
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                })
                .or_else(|| {
                    if is_current {
                        Some(page_url.to_string())
                    } else {
                        None
                    }
                });

            let Some(raw_url) = raw_url else {
                continue;
            };
            let url = Self::normalize_link(&raw_url, base_url);

            let title = el
                .select(&PART_TITLE_SEL)
                .next()
                .map(|t| t.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    el.select(&PART_LINK_SEL)
                        .next()
                        .map(|a| a.text().collect::<String>().trim().to_string())
                        .filter(|s| !s.is_empty())
                });

            let Some(title) = title else {
                continue;
            };

            let year_text = el
                .select(&PART_YEAR_SEL)
                .next()
                .map(|y| y.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty());

            let year_num = year_text
                .as_deref()
                .and_then(|y| YEAR_RE.find(y))
                .and_then(|m| m.as_str().parse::<u32>().ok());

            let year = year_num.map(|y| y.to_string()).or(year_text);

            let rating = el
                .select(&PART_RATING_SEL)
                .next()
                .map(|r| r.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty() && s != "-" && s != "—" && s != "0");

            let id = ID_RE
                .captures(&url)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| format!("part-{}", idx + 1));

            raw_parts.push((
                year_num,
                idx,
                FranchisePart {
                    id,
                    url,
                    title,
                    year,
                    rating,
                    is_current,
                    order: idx + 1,
                },
            ));
        }

        if raw_parts.len() <= 1 {
            return Vec::new();
        }

        // Sort chronologically by release year (ascending), preserving source order on ties or missing years.
        raw_parts.sort_by(|a, b| {
            let ay = a.0.unwrap_or(u32::MAX);
            let by = b.0.unwrap_or(u32::MAX);
            ay.cmp(&by).then_with(|| a.1.cmp(&b.1))
        });

        raw_parts
            .into_iter()
            .enumerate()
            .map(|(i, (_, _, mut part))| {
                part.order = i + 1;
                part
            })
            .collect()
    }

    /// Extracts initial player_info JSON object from sof.tv.initCDN*Events script
    fn extract_inline_player_info(html: &str) -> Option<StreamData> {
        let pattern = "sof.tv.initCDN";
        let start_pos = html.find(pattern)?;
        let remainder = &html[start_pos..];
        let json_start_rel = remainder.find('{')?;
        let json_start = start_pos + json_start_rel;

        // Balanced brace matching to find complete JSON object
        let mut depth = 0;
        let mut json_end = None;
        for (i, c) in html[json_start..].char_indices() {
            if c == '{' {
                depth += 1;
            } else if c == '}' {
                depth -= 1;
                if depth == 0 {
                    json_end = Some(json_start + i + 1);
                    break;
                }
            }
        }

        let json_str = &html[json_start..json_end?];
        if let Ok(val) = serde_json::from_str::<Value>(json_str) {
            let raw_streams = val.get("streams").and_then(|v| v.as_str()).unwrap_or_default();
            let default_q = val.get("default_quality").and_then(|v| v.as_str());
            let subtitles = val.get("subtitle").and_then(|v| v.as_str());
            let thumbnails = val.get("thumbnails").and_then(|v| v.as_str());

            if !raw_streams.is_empty() {
                return Some(StreamDeobfuscator::build_stream_data(
                    raw_streams,
                    default_q,
                    subtitles,
                    thumbnails,
                ));
            }
        }
        None
    }

    /// Fetches media detail page and parses all fields
    pub async fn get_media_details(
        client: &HttpClient,
        base_url: &str,
        item_url: &str,
    ) -> Result<MediaDetails, Box<dyn std::error::Error + Send + Sync>> {
        let full_url = Self::rewrite_to_mirror(item_url, base_url);
        let html = client.get_html(&full_url, None).await?;
        let details = Self::parse_media_details(&html, &full_url, base_url)
            .map_err(|e| format!("Error parsing details for {}: {}", full_url, e))?;
        Ok(details)
    }

    /// Fetches stream URL for movie or series episode via /ajax/get_cdn_series/
    pub async fn get_stream(
        client: &HttpClient,
        base_url: &str,
        media_id: &str,
        translator_id: Option<&str>,
        season: Option<i32>,
        episode: Option<i32>,
        is_series: bool,
        referer_url: &str,
    ) -> Result<StreamData, Box<dyn std::error::Error + Send + Sync>> {
        let base = base_url.trim_end_matches('/');
        let active_referer = Self::rewrite_to_mirror(referer_url, base_url);
        let timestamp = Utc::now().timestamp_millis();
        let ajax_url = format!("{}/ajax/get_cdn_series/?t={}", base, timestamp);

        let trans_id = translator_id.unwrap_or("");
        let season_str = season.map(|s| s.to_string()).unwrap_or_default();
        let episode_str = episode.map(|e| e.to_string()).unwrap_or_default();

        let form_params: Vec<(&str, &str)> = if is_series {
            vec![
                ("id", media_id),
                ("translator_id", trans_id),
                ("season", &season_str),
                ("episode", &episode_str),
                ("action", "get_stream"),
                ("favs", ""),
            ]
        } else {
            vec![
                ("id", media_id),
                ("translator_id", trans_id),
                ("is_camrip", "0"),
                ("is_ads", "0"),
                ("is_director", "0"),
                ("action", "get_movie"),
                ("favs", ""),
            ]
        };

        let response_text = client.post_ajax(&ajax_url, &form_params, Some(&active_referer)).await?;
        let trimmed_resp = response_text.trim();
        if trimmed_resp.starts_with("<!DOCTYPE")
            || trimmed_resp.starts_with("<!doctype")
            || trimmed_resp.starts_with("<html")
        {
            return Err("Отримано HTML-сторінку замість очікуваного JSON від сервера (захист Cloudflare або помилка 502/503)".into());
        }

        let json: Value = serde_json::from_str(&response_text)
            .map_err(|e| format!("Некоректна відповідь сервера (очікувався JSON): {e}"))?;

        let is_premium = json
            .get("premium_content")
            .and_then(|v| {
                v.as_bool()
                    .or_else(|| v.as_i64().map(|n| n == 1))
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok().map(|n| n == 1)))
            })
            .unwrap_or(false)
            || json
                .get("message")
                .and_then(|v| v.as_str())
                .map(|m| {
                    let m_lower = m.to_lowercase();
                    m_lower.contains("премиум") || m_lower.contains("преміум") || m_lower.contains("premium")
                })
                .unwrap_or(false);

        let success = json.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        if !success {
            if is_premium {
                return Ok(StreamData {
                    qualities: vec![],
                    default_quality: String::new(),
                    subtitles: vec![],
                    thumbnails: None,
                    is_premium: true,
                    cdn_host: None,
                    cdn_ping_ms: None,
                });
            }
            let msg = json.get("message").and_then(|v| v.as_str()).unwrap_or("Stream fetch failed");
            return Err(msg.into());
        }

        let raw_url = json.get("url").and_then(|v| v.as_str()).unwrap_or_default();
        let default_q = json.get("quality").and_then(|v| v.as_str());
        let subtitles = json.get("subtitle").and_then(|v| v.as_str());
        let thumbnails = json.get("thumbnails").and_then(|v| v.as_str());

        let mut stream_data = StreamDeobfuscator::build_stream_data(
            raw_url,
            default_q,
            subtitles,
            thumbnails,
        );
        stream_data.is_premium = is_premium;

        Ok(stream_data)
    }

    /// Fetches series episodes matrix when switching translators
    pub async fn get_episodes(
        client: &HttpClient,
        base_url: &str,
        media_id: &str,
        translator_id: &str,
        referer_url: &str,
    ) -> Result<(Vec<SeasonTab>, Vec<EpisodeTab>, Option<StreamData>), Box<dyn std::error::Error + Send + Sync>> {
        let base = base_url.trim_end_matches('/');
        let active_referer = Self::rewrite_to_mirror(referer_url, base_url);
        let timestamp = Utc::now().timestamp_millis();
        let ajax_url = format!("{}/ajax/get_cdn_series/?t={}", base, timestamp);

        let form_params = [
            ("id", media_id),
            ("translator_id", translator_id),
            ("action", "get_episodes"),
            ("favs", ""),
        ];

        let response_text = client.post_ajax(&ajax_url, &form_params, Some(&active_referer)).await?;
        let trimmed_resp = response_text.trim();
        if trimmed_resp.starts_with("<!DOCTYPE")
            || trimmed_resp.starts_with("<!doctype")
            || trimmed_resp.starts_with("<html")
        {
            return Err("Отримано HTML-сторінку замість очікуваного JSON від сервера (захист Cloudflare або помилка 502/503)".into());
        }

        let json: Value = serde_json::from_str(&response_text)
            .map_err(|e| format!("Некоректна відповідь сервера (очікувався JSON): {e}"))?;

        let mut seasons: Vec<SeasonTab> = Vec::new();
        let mut episodes: Vec<EpisodeTab> = Vec::new();

        if let Some(seasons_html) = json.get("seasons").and_then(|v| v.as_str()) {
            let doc = Html::parse_fragment(seasons_html);
            let mut seen_seasons: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for elem in doc.select(&SEASON_SEL) {
                let tab_id = elem.value().attr("data-tab_id").unwrap_or_default();
                if !tab_id.is_empty() && seen_seasons.insert(tab_id) {
                    let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                    seasons.push(SeasonTab {
                        id: tab_id.to_string(),
                        title,
                    });
                }
            }
        }

        if let Some(episodes_html) = json.get("episodes").and_then(|v| v.as_str()) {
            let doc = Html::parse_fragment(episodes_html);
            let mut seen_episodes: std::collections::HashSet<(&str, &str)> = std::collections::HashSet::new();
            for elem in doc.select(&EPISODE_SEL) {
                let s_id = elem.value().attr("data-season_id").unwrap_or_default();
                let ep_id = elem.value().attr("data-episode_id").unwrap_or_default();
                if !s_id.is_empty()
                    && !ep_id.is_empty()
                    && seen_episodes.insert((s_id, ep_id))
                {
                    let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                    episodes.push(EpisodeTab {
                        season_id: s_id.to_string(),
                        episode_id: ep_id.to_string(),
                        title,
                    });
                }
            }
        }

        let is_premium = json
            .get("premium_content")
            .and_then(|v| {
                v.as_bool()
                    .or_else(|| v.as_i64().map(|n| n == 1))
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok().map(|n| n == 1)))
            })
            .unwrap_or(false)
            || json
                .get("message")
                .and_then(|v| v.as_str())
                .map(|m| {
                    let m_lower = m.to_lowercase();
                    m_lower.contains("премиум") || m_lower.contains("преміум") || m_lower.contains("premium")
                })
                .unwrap_or(false);

        let stream_data = if let Some(raw_url) = json.get("url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            let default_q = json.get("quality").and_then(|v| v.as_str());
            let subtitles = json.get("subtitle").and_then(|v| v.as_str());
            let thumbnails = json.get("thumbnails").and_then(|v| v.as_str());

            let mut s = StreamDeobfuscator::build_stream_data(
                raw_url,
                default_q,
                subtitles,
                thumbnails,
            );
            s.is_premium = is_premium;
            Some(s)
        } else if is_premium {
            Some(StreamData {
                qualities: vec![],
                default_quality: String::new(),
                subtitles: vec![],
                thumbnails: None,
                is_premium: true,
                cdn_host: None,
                cdn_ping_ms: None,
            })
        } else {
            None
        };

        Ok((seasons, episodes, stream_data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_catalog_html() {
        let sample_html = r#"
        <div class="b-content__inline_items">
          <div class="b-content__inline_item" data-id="92807" data-url="/series/drama/92807-noktyurn-2026.html">
            <div class="b-content__inline_item-cover">
              <a href="/series/drama/92807-noktyurn-2026.html">
                <img src="https://static.hdrezka.ac/posters/92807.jpg" alt="Ноктюрн" />
                <span class="cat series"><i class="entity">Сериал</i></span>
                <span class="info">1 сезон 2 серия</span>
              </a>
            </div>
            <div class="b-content__inline_item-link">
              <a href="/series/drama/92807-noktyurn-2026.html">Ноктюрн</a>
              <div class="misc">2026, США, Драма</div>
            </div>
          </div>
        </div>
        "#;

        let cards = RezkaParser::parse_catalog_html(sample_html, "https://rezka-tv.org");
        assert_eq!(cards.len(), 1);
        let card = &cards[0];
        assert_eq!(card.id, "92807");
        assert_eq!(card.title, "Ноктюрн");
        assert_eq!(card.url, "https://rezka-tv.org/series/drama/92807-noktyurn-2026.html");
        assert_eq!(card.entity_type, "Сериал");
        assert_eq!(card.series_info.as_deref(), Some("1 сезон 2 серия"));
        assert_eq!(card.misc_info, "2026, США, Драма");
    }

    #[test]
    fn test_parse_media_details() {
        let sample_html = r#"
        <div class="b-post__title"><h1>Тестовий Фільм</h1></div>
        <div class="b-post__origtitle">Test Movie Original</div>
        <div class="b-sidecover">
            <a href="https://static.hdrezka.ac/big.jpg"><img src="https://static.hdrezka.ac/small.jpg" /></a>
        </div>
        <div class="b-post__info_rates imdb"><span class="bold">8.4</span></div>
        <div class="b-post__info_rates kp"><span class="bold">7.9</span></div>
        <div class="b-post__description_text">Дуже цікавий сюжет фільму...</div>
        <table class="b-post__info">
            <tr><td class="l">Рік</td><td>2026</td></tr>
            <tr><td class="l">Країна</td><td>Україна</td></tr>
        </table>
        <ul id="translators-list" class="b-translators__list">
            <li class="b-translator__item active" data-translator_id="56">
                <img title="Український" src="/flag_ua.png" /> Озвучення Студії
            </li>
        </ul>
        <script>
            sof.tv.initCDNMoviesEvents(12345, 56, 0, 0, 0, 'host', 0, 0, {
                "streams": "[360p]https://stream.com/360.mp4:hls:manifest.m3u8,[720p]https://stream.com/720.mp4:hls:manifest.m3u8",
                "default_quality": "720p",
                "subtitle": false
            });
        </script>
        "#;

        let details = RezkaParser::parse_media_details(
            sample_html,
            "https://rezka-tv.org/films/12345-test.html",
            "https://rezka-tv.org",
        )
        .expect("parse details");

        assert_eq!(details.id, "12345");
        assert_eq!(details.title, "Тестовий Фільм");
        assert_eq!(details.orig_title.as_deref(), Some("Test Movie Original"));
        assert_eq!(details.imdb_rating.as_deref(), Some("8.4"));
        assert_eq!(details.kp_rating.as_deref(), Some("7.9"));
        assert_eq!(details.info_table.len(), 2);
        assert_eq!(details.translators.len(), 1);
        assert_eq!(details.translators[0].id, "56");
        assert!(details.translators[0].is_active);

        let initial_streams = details.initial_streams.expect("initial streams");
        assert_eq!(initial_streams.qualities.len(), 2);
        assert_eq!(initial_streams.default_quality, "720p");
    }

    #[test]
    fn test_build_category_url() {
        let base = "https://rezka-tv.org";
        // Category only
        let url1 = RezkaParser::build_category_url(base, "films", None, None, None);
        assert_eq!(url1, "https://rezka-tv.org/films/");

        // Category + Genre
        let url2 = RezkaParser::build_category_url(base, "films", Some("comedy"), None, None);
        assert_eq!(url2, "https://rezka-tv.org/films/comedy/");

        // Category + Genre + Filter
        let url3 = RezkaParser::build_category_url(base, "films", Some("comedy"), Some("popular"), None);
        assert_eq!(url3, "https://rezka-tv.org/films/comedy/?filter=popular");

        // Category + Genre + Filter + Page
        let url4 = RezkaParser::build_category_url(base, "films", Some("comedy"), Some("popular"), Some(3));
        assert_eq!(url4, "https://rezka-tv.org/films/comedy/page/3/?filter=popular");

        // Default 'last' filter does not append redundant query param
        let url5 = RezkaParser::build_category_url(base, "series", Some("action"), Some("last"), Some(1));
        assert_eq!(url5, "https://rezka-tv.org/series/action/");
    }

    #[test]
    fn test_premium_response_detection() {
        let raw_json = r#"{"success":false,"message":"Доступно только премиум пользователям","premium_content":1}"#;
        let json: Value = serde_json::from_str(raw_json).unwrap();

        let is_premium = json
            .get("premium_content")
            .and_then(|v| {
                v.as_bool()
                    .or_else(|| v.as_i64().map(|n| n == 1))
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok().map(|n| n == 1)))
            })
            .unwrap_or(false)
            || json
                .get("message")
                .and_then(|v| v.as_str())
                .map(|m| {
                    let m_lower = m.to_lowercase();
                    m_lower.contains("премиум") || m_lower.contains("преміум") || m_lower.contains("premium")
                })
                .unwrap_or(false);

        assert!(is_premium);
    }

    #[test]
    fn test_parse_franchise_chronology() {
        let html = r#"
        <div class="b-post__partcontent">
          <div class="b-post__partcontent_item" data-url="/films/fantasy/103-harry-potter-3.html">
            <div class="td num">3</div>
            <div class="td title">Гарри Поттер и узник Азкабана</div>
            <div class="td year">2004 год</div>
            <div class="td rating"><i>8.2</i></div>
          </div>
          <div class="b-post__partcontent_item current">
            <div class="td num">1</div>
            <div class="td title">Гарри Поттер и философский камень</div>
            <div class="td year">2001</div>
            <div class="td rating">8.3</div>
          </div>
          <div class="b-post__partcontent_item" data-url="https://rezka-tv.org/films/fantasy/102-harry-potter-2.html">
            <div class="td num">2</div>
            <div class="td title">Гарри Поттер и Тайная комната</div>
            <div class="td year">2002</div>
            <div class="td rating">-</div>
          </div>
        </div>
        "#;

        let doc = Html::parse_document(html);
        let parts = RezkaParser::parse_franchise(
            &doc,
            "https://rezka-tv.org/films/fantasy/101-harry-potter-1.html",
            "https://rezka-tv.org",
        );

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].id, "101");
        assert_eq!(parts[0].year.as_deref(), Some("2001"));
        assert!(parts[0].is_current);
        assert_eq!(parts[0].order, 1);
        assert_eq!(parts[0].rating.as_deref(), Some("8.3"));

        assert_eq!(parts[1].id, "102");
        assert_eq!(parts[1].year.as_deref(), Some("2002"));
        assert!(!parts[1].is_current);
        assert_eq!(parts[1].order, 2);
        assert_eq!(parts[1].rating, None);

        assert_eq!(parts[2].id, "103");
        assert_eq!(parts[2].url, "https://rezka-tv.org/films/fantasy/103-harry-potter-3.html");
        assert_eq!(parts[2].year.as_deref(), Some("2004"));
        assert_eq!(parts[2].order, 3);
        assert_eq!(parts[2].rating.as_deref(), Some("8.2"));
    }
}
