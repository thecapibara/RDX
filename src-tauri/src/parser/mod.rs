pub mod deobfuscator;
pub mod models;

use chrono::Utc;
use regex::Regex;
use scraper::{Html, Selector};
use serde_json::Value;

use crate::client::HttpClient;
use crate::parser::deobfuscator::StreamDeobfuscator;
pub use crate::parser::models::*;

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

    /// Parses catalog items list from HTML (Home, Category, Search pages)
    pub fn parse_catalog_html(html: &str, base_url: &str) -> Vec<MediaCard> {
        let document = Html::parse_document(html);
        let item_sel = Selector::parse(".b-content__inline_item").unwrap();
        let link_sel = Selector::parse(".b-content__inline_item-link > a").unwrap();
        let misc_sel = Selector::parse(".b-content__inline_item-link .misc").unwrap();
        let cover_img_sel = Selector::parse(".b-content__inline_item-cover img").unwrap();
        let cat_sel = Selector::parse(".b-content__inline_item-cover .cat .entity").unwrap();
        let info_sel = Selector::parse(".b-content__inline_item-cover .info").unwrap();
        let rating_sel = Selector::parse(".rating i, .hd-tooltip").unwrap();

        let mut cards = Vec::new();

        for element in document.select(&item_sel) {
            let id = element
                .value()
                .attr("data-id")
                .map(|s| s.to_string())
                .unwrap_or_default();

            let data_url = element.value().attr("data-url");

            let (title, url) = if let Some(link_elem) = element.select(&link_sel).next() {
                let t = link_elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                let u = data_url
                    .or_else(|| link_elem.value().attr("href"))
                    .unwrap_or_default();
                (t, u.to_string())
            } else {
                (String::new(), data_url.unwrap_or_default().to_string())
            };

            if title.is_empty() && url.is_empty() {
                continue;
            }

            let poster = element
                .select(&cover_img_sel)
                .next()
                .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
                .map(|s| Self::normalize_link(s, base_url))
                .unwrap_or_default();

            let entity_type = element
                .select(&cat_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_else(|| "Фильм".to_string());

            let series_info = element
                .select(&info_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .filter(|s| !s.is_empty());

            let misc_info = element
                .select(&misc_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            let rating = element
                .select(&rating_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .filter(|s| !s.is_empty());

            let full_url = Self::normalize_link(&url, base_url);

            cards.push(MediaCard {
                id,
                url: full_url,
                title,
                poster,
                entity_type,
                series_info,
                misc_info,
                rating,
            });
        }

        cards
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
        let item_sel = Selector::parse(".b-search__section_list li a").unwrap();
        let enty_sel = Selector::parse(".enty").unwrap();
        let rating_sel = Selector::parse(".rating, .rating-green-string").unwrap();

        let mut items = Vec::new();

        for link in document.select(&item_sel) {
            let href = link.value().attr("href").unwrap_or_default();
            let full_url = Self::normalize_link(href, base_url);

            let title = link
                .select(&enty_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
                .unwrap_or_default();

            let rating = link
                .select(&rating_sel)
                .next()
                .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

            // Full text inside <a> contains (Original Title, Type, Year)
            let full_text = link.text().collect::<Vec<_>>().join(" ");
            let paren_re = Regex::new(r"\((.*?)\)").unwrap();

            let mut orig_title = None;
            let mut entity_type = None;
            let mut year = None;

            if let Some(cap) = paren_re.captures(&full_text) {
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
        let title_sel = Selector::parse("div.b-post__title > h1, .b-post__title").unwrap();
        let title = document
            .select(&title_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .unwrap_or_default();

        if title.is_empty() {
            return Err("Failed to parse media title from page".to_string());
        }

        // Original Title
        let orig_title_sel = Selector::parse("div.b-post__origtitle").unwrap();
        let orig_title = document
            .select(&orig_title_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        // Posters
        let poster_img_sel = Selector::parse("div.b-sidecover img").unwrap();
        let poster = document
            .select(&poster_img_sel)
            .next()
            .and_then(|img| img.value().attr("src"))
            .map(|s| Self::normalize_link(s, base_url))
            .unwrap_or_default();

        let poster_link_sel = Selector::parse("div.b-sidecover a").unwrap();
        let high_res_poster = document
            .select(&poster_link_sel)
            .next()
            .and_then(|a| a.value().attr("href"))
            .map(|s| Self::normalize_link(s, base_url));

        // Ratings
        let imdb_sel = Selector::parse(".b-post__info_rates.imdb .bold").unwrap();
        let imdb_rating = document
            .select(&imdb_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

        let kp_sel = Selector::parse(".b-post__info_rates.kp .bold").unwrap();
        let kp_rating = document
            .select(&kp_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string());

        // Description
        let desc_sel = Selector::parse("div.b-post__description_text").unwrap();
        let description = document
            .select(&desc_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join("\n").trim().to_string())
            .unwrap_or_default();

        // Info table
        let table_tr_sel = Selector::parse("table.b-post__info tr").unwrap();
        let td_l_sel = Selector::parse("td.l").unwrap();
        let td_r_sel = Selector::parse("td:nth-child(2)").unwrap();
        let mut info_table = Vec::new();

        for tr in document.select(&table_tr_sel) {
            if let (Some(l_elem), Some(r_elem)) = (tr.select(&td_l_sel).next(), tr.select(&td_r_sel).next()) {
                let key = l_elem.text().collect::<Vec<_>>().join(" ").trim().trim_end_matches(':').trim().to_string();
                let val = r_elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                if !key.is_empty() && !val.is_empty() {
                    info_table.push((key, val));
                }
            }
        }

        // Translators: deduplicate by id (rezka can contain hidden SEO <a> tags)
        let trans_sel = Selector::parse("#translators-list [data-translator_id]").unwrap();
        let mut translators: Vec<Translator> = Vec::new();

        for elem in document.select(&trans_sel) {
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

            let lang_img_sel = Selector::parse("img").unwrap();
            let language = elem
                .select(&lang_img_sel)
                .next()
                .and_then(|img| img.value().attr("title").or_else(|| img.value().attr("alt")))
                .map(|s| s.to_string())
                .or_else(|| {
                    elem.value().attr("title").filter(|t| t.contains("Украин") || t.contains("Україн")).map(|s| s.to_string())
                });

            if let Some(existing) = translators.iter_mut().find(|t| t.id == id) {
                existing.is_active = existing.is_active || is_active;
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
                });
            }
        }

        // Seasons tabs (.b-simple_season__item matches both <li> and <a>)
        let season_sel = Selector::parse(".b-simple_season__item").unwrap();
        let mut seasons: Vec<SeasonTab> = Vec::new();
        for elem in document.select(&season_sel) {
            let tab_id = elem.value().attr("data-tab_id").unwrap_or_default();
            let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
            if !tab_id.is_empty() && !seasons.iter().any(|s| s.id == tab_id) {
                seasons.push(SeasonTab {
                    id: tab_id.to_string(),
                    title,
                });
            }
        }

        // Episodes tabs (.b-simple_episode__item matches both <li> and <a>)
        let episode_sel = Selector::parse(".b-simple_episode__item").unwrap();
        let mut episodes: Vec<EpisodeTab> = Vec::new();
        for elem in document.select(&episode_sel) {
            let season_id = elem.value().attr("data-season_id").unwrap_or_default();
            let episode_id = elem.value().attr("data-episode_id").unwrap_or_default();
            let ep_title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();

            if !season_id.is_empty()
                && !episode_id.is_empty()
                && !episodes.iter().any(|e| e.season_id == season_id && e.episode_id == episode_id)
            {
                episodes.push(EpisodeTab {
                    season_id: season_id.to_string(),
                    episode_id: episode_id.to_string(),
                    title: ep_title,
                });
            }
        }

        // Extract media id and fallback translator_id from URL or initCDN scripts
        let init_re =
            Regex::new(r"sof\.tv\.initCDN(?:Movies|Series)Events\(\s*(\d+)\s*,\s*(\d+)").unwrap();
        let init_caps = init_re.captures(html);

        let id_re = Regex::new(r"/(\d+)-[^/]+\.html").unwrap();
        let media_id = if let Some(cap) = id_re.captures(page_url) {
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
                });
            }
        }

        // Extract initial embedded player streams from inline script
        let initial_streams = Self::extract_inline_player_info(html);

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
        })
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
        let json: Value = serde_json::from_str(&response_text)?;

        let success = json.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        if !success {
            let msg = json.get("message").and_then(|v| v.as_str()).unwrap_or("Stream fetch failed");
            return Err(msg.into());
        }

        let raw_url = json.get("url").and_then(|v| v.as_str()).unwrap_or_default();
        let default_q = json.get("quality").and_then(|v| v.as_str());
        let subtitles = json.get("subtitle").and_then(|v| v.as_str());
        let thumbnails = json.get("thumbnails").and_then(|v| v.as_str());

        Ok(StreamDeobfuscator::build_stream_data(
            raw_url,
            default_q,
            subtitles,
            thumbnails,
        ))
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
        let json: Value = serde_json::from_str(&response_text)?;

        let mut seasons: Vec<SeasonTab> = Vec::new();
        let mut episodes: Vec<EpisodeTab> = Vec::new();

        if let Some(seasons_html) = json.get("seasons").and_then(|v| v.as_str()) {
            let doc = Html::parse_fragment(seasons_html);
            let season_sel = Selector::parse(".b-simple_season__item").unwrap();
            for elem in doc.select(&season_sel) {
                let tab_id = elem.value().attr("data-tab_id").unwrap_or_default();
                let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                if !tab_id.is_empty() && !seasons.iter().any(|s| s.id == tab_id) {
                    seasons.push(SeasonTab {
                        id: tab_id.to_string(),
                        title,
                    });
                }
            }
        }

        if let Some(episodes_html) = json.get("episodes").and_then(|v| v.as_str()) {
            let doc = Html::parse_fragment(episodes_html);
            let ep_sel = Selector::parse(".b-simple_episode__item").unwrap();
            for elem in doc.select(&ep_sel) {
                let s_id = elem.value().attr("data-season_id").unwrap_or_default();
                let ep_id = elem.value().attr("data-episode_id").unwrap_or_default();
                let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                if !s_id.is_empty()
                    && !ep_id.is_empty()
                    && !episodes.iter().any(|e| e.season_id == s_id && e.episode_id == ep_id)
                {
                    episodes.push(EpisodeTab {
                        season_id: s_id.to_string(),
                        episode_id: ep_id.to_string(),
                        title,
                    });
                }
            }
        }

        let stream_data = if let Some(raw_url) = json.get("url").and_then(|v| v.as_str()) {
            let default_q = json.get("quality").and_then(|v| v.as_str());
            let subtitles = json.get("subtitle").and_then(|v| v.as_str());
            let thumbnails = json.get("thumbnails").and_then(|v| v.as_str());
            Some(StreamDeobfuscator::build_stream_data(
                raw_url,
                default_q,
                subtitles,
                thumbnails,
            ))
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
}
