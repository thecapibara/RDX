pub mod anubis;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, REFERER, USER_AGENT};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use url::Url;
use anubis::AnubisSolver;

pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CookieStoreData {
    /// domain -> (cookie_name -> cookie_value)
    pub cookies: HashMap<String, HashMap<String, String>>,
}

pub struct PersistentCookieStore {
    file_path: Option<PathBuf>,
    data: Mutex<CookieStoreData>,
}

impl PersistentCookieStore {
    pub fn new<P: AsRef<Path>>(file_path: Option<P>) -> Self {
        let mut store_data = CookieStoreData::default();
        let path_buf = file_path.map(|p| p.as_ref().to_path_buf());

        if let Some(ref path) = path_buf {
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(path) {
                    if let Ok(deserialized) = serde_json::from_str::<CookieStoreData>(&content) {
                        store_data = deserialized;
                    }
                }
            }
        }

        Self {
            file_path: path_buf,
            data: Mutex::new(store_data),
        }
    }

    pub fn in_memory() -> Self {
        Self::new::<PathBuf>(None)
    }

    fn persist(&self) {
        if let Some(ref path) = self.file_path {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(guard) = self.data.lock() {
                if let Ok(json) = serde_json::to_string_pretty(&*guard) {
                    let _ = std::fs::write(path, json);
                }
            }
        }
    }

    pub fn get_cookie_header_for_url(&self, url: &Url) -> Option<String> {
        let host = url.host_str()?;
        let guard = self.data.lock().ok()?;

        let mut matching_cookies = HashMap::new();

        for (domain, cookies) in &guard.cookies {
            let matches_domain = if domain.starts_with('.') {
                let suffix = &domain[1..];
                host == suffix || host.ends_with(domain.as_str())
            } else {
                host == domain || host.ends_with(&format!(".{}", domain))
            };

            if matches_domain {
                for (k, v) in cookies {
                    matching_cookies.insert(k.clone(), v.clone());
                }
            }
        }

        if matching_cookies.is_empty() {
            None
        } else {
            let header_str = matching_cookies
                .into_iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("; ");
            Some(header_str)
        }
    }

    pub fn parse_and_store_response_cookies(&self, url: &Url, response: &Response) {
        let host = match url.host_str() {
            Some(h) => h.to_string(),
            None => return,
        };

        let mut changed = false;
        let mut guard = match self.data.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        for header in response.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(header_str) = header.to_str() {
                if let Some(cookie_part) = header_str.split(';').next() {
                    let mut parts = cookie_part.splitn(2, '=');
                    if let (Some(name), Some(value)) = (parts.next(), parts.next()) {
                        let name = name.trim().to_string();
                        let value = value.trim().to_string();

                        // Check domain attribute in Set-Cookie if present
                        let mut target_domain = host.clone();
                        for attr in header_str.split(';').skip(1) {
                            let mut attr_parts = attr.trim().splitn(2, '=');
                            if let (Some(attr_name), Some(attr_val)) = (attr_parts.next(), attr_parts.next()) {
                                if attr_name.eq_ignore_ascii_case("domain") {
                                    target_domain = attr_val.trim().trim_start_matches('.').to_string();
                                }
                            }
                        }

                        let domain_map = guard.cookies.entry(target_domain).or_default();
                        if value.is_empty() || header_str.contains("Max-Age=0") {
                            domain_map.remove(&name);
                        } else {
                            domain_map.insert(name, value);
                        }
                        changed = true;
                    }
                }
            }
        }

        drop(guard);
        if changed {
            self.persist();
        }
    }

    pub fn set_cookie(&self, domain: &str, name: &str, value: &str) {
        if let Ok(mut guard) = self.data.lock() {
            let domain_map = guard.cookies.entry(domain.to_string()).or_default();
            domain_map.insert(name.to_string(), value.to_string());
            drop(guard);
            self.persist();
        }
    }

    pub fn get_all_cookies(&self) -> HashMap<String, HashMap<String, String>> {
        self.data.lock().map(|g| g.cookies.clone()).unwrap_or_default()
    }
}

pub struct HttpClient {
    client: Client,
    no_redirect_client: Client,
    cookie_store: Arc<PersistentCookieStore>,
    user_agent: String,
}

impl HttpClient {
    pub fn new(cookie_store: Arc<PersistentCookieStore>, proxy_url: Option<&str>) -> reqwest::Result<Self> {
        let mut builder = Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(10));

        let mut no_redirect_builder = Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none());

        if let Some(proxy) = proxy_url {
            if !proxy.trim().is_empty() {
                if let Ok(p) = reqwest::Proxy::all(proxy) {
                    builder = builder.proxy(p.clone());
                    no_redirect_builder = no_redirect_builder.proxy(p);
                }
            }
        }

        let client = builder.build()?;
        let no_redirect_client = no_redirect_builder.build()?;
        Ok(Self {
            client,
            no_redirect_client,
            cookie_store,
            user_agent: DEFAULT_USER_AGENT.to_string(),
        })
    }

    pub fn cookie_store(&self) -> &Arc<PersistentCookieStore> {
        &self.cookie_store
    }

    fn prepare_headers(&self, url: &Url, referer: Option<&str>, is_ajax: bool) -> HeaderMap {
        let mut headers = HeaderMap::new();

        headers.insert(
            USER_AGENT,
            HeaderValue::from_str(&self.user_agent).unwrap_or(HeaderValue::from_static("Mozilla/5.0")),
        );
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        );
        headers.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7"),
        );

        if let Some(ref_str) = referer {
            if let Ok(ref_val) = HeaderValue::from_str(ref_str) {
                headers.insert(REFERER, ref_val);
            }
        }

        if is_ajax {
            headers.insert("X-Requested-With", HeaderValue::from_static("XMLHttpRequest"));
        }

        if let Some(cookie_hdr) = self.cookie_store.get_cookie_header_for_url(url) {
            if let Ok(cookie_val) = HeaderValue::from_str(&cookie_hdr) {
                headers.insert(COOKIE, cookie_val);
            }
        }

        headers
    }

    /// Executes an HTTP request with automatic Anubis PoW solving
    pub async fn execute_with_anti_bot(
        &self,
        method: Method,
        url_str: &str,
        form_params: Option<&[(&str, &str)]>,
        referer: Option<&str>,
        is_ajax: bool,
    ) -> Result<Response, Box<dyn std::error::Error + Send + Sync>> {
        let target_url = Url::parse(url_str)?;
        let headers = self.prepare_headers(&target_url, referer, is_ajax);

        let mut req_builder = self.client.request(method.clone(), target_url.clone()).headers(headers);
        if let Some(params) = form_params {
            req_builder = req_builder.form(params);
        }

        let resp = req_builder.send().await?;
        self.cookie_store.parse_and_store_response_cookies(&target_url, &resp);

        // Check if response contains Anubis challenge
        let status = resp.status();
        if status.is_success() || status.as_u16() == 403 {
            let body_bytes = resp.bytes().await?;
            let body_str = String::from_utf8_lossy(&body_bytes);

            if AnubisSolver::is_anubis_challenge(&body_str) {
                if let Some(challenge_payload) = AnubisSolver::extract_challenge(&body_str) {
                    let solution = AnubisSolver::solve(&challenge_payload);

                    // Submit pass-challenge request
                    let base_origin = format!("{}://{}", target_url.scheme(), target_url.host_str().unwrap_or(""));
                    let redir_path = target_url.path();
                    let redir_query = target_url.query().map(|q| format!("?{}", q)).unwrap_or_default();
                    let redir = if redir_path.is_empty() {
                        "/".to_string()
                    } else {
                        format!("{}{}", redir_path, redir_query)
                    };

                    let pass_url_str = format!(
                        "{}/.within.website/x/cmd/anubis/api/pass-challenge?id={}&response={}&nonce={}&redir={}&elapsedTime={}",
                        base_origin,
                        solution.challenge_id,
                        solution.response_hash,
                        solution.nonce,
                        urlencoding::encode(&redir),
                        solution.elapsed_ms
                    );

                    let pass_url = Url::parse(&pass_url_str)?;
                    let pass_headers = self.prepare_headers(&pass_url, Some(url_str), false);
                    let pass_resp = self.no_redirect_client.get(pass_url.clone()).headers(pass_headers).send().await?;
                    self.cookie_store.parse_and_store_response_cookies(&pass_url, &pass_resp);

                    // Re-try original request with authenticated cookies
                    let retry_headers = self.prepare_headers(&target_url, referer, is_ajax);
                    let mut retry_builder = self.client.request(method, target_url.clone()).headers(retry_headers);
                    if let Some(params) = form_params {
                        retry_builder = retry_builder.form(params);
                    }
                    let retry_resp = retry_builder.send().await?;
                    self.cookie_store.parse_and_store_response_cookies(&target_url, &retry_resp);
                    return Ok(retry_resp);
                }
            }

            // Not a challenge: rebuild a response from the bytes so caller can read it
            let final_resp = http::Response::builder()
                .status(status)
                .body(body_bytes)?;
            return Ok(Response::from(final_resp));
        }

        Ok(resp)
    }

    pub async fn get_html(&self, url: &str, referer: Option<&str>) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.execute_with_anti_bot(Method::GET, url, None, referer, false).await?;
        let text = resp.text().await?;
        Ok(text)
    }

    pub async fn post_ajax(
        &self,
        url: &str,
        params: &[(&str, &str)],
        referer: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self.execute_with_anti_bot(Method::POST, url, Some(params), referer, true).await?;
        let text = resp.text().await?;
        Ok(text)
    }
}

pub fn default_cookie_path() -> PathBuf {
    if let Some(mut dir) = dirs::data_dir() {
        dir.push("rdx");
        dir.push("cookies.json");
        dir
    } else {
        PathBuf::from("cookies.json")
    }
}
