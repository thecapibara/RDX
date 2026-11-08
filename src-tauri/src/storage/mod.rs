use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub active_mirror: String,
    pub custom_mirrors: Vec<String>,
    pub proxy_url: String,
    pub preferred_quality: String,
    pub preferred_translator: String,
    #[serde(default = "default_true")]
    pub startup_sound: bool,
    #[serde(default = "default_true")]
    pub autoplay_next: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_mirror: "https://hdrezka.me".to_string(),
            custom_mirrors: vec![
                "https://hdrezka.me".to_string(),
                "https://hdrezka.kim".to_string(),
                "https://rezka.pub".to_string(),
            ],
            proxy_url: "".to_string(),
            preferred_quality: "720p".to_string(),
            preferred_translator: "".to_string(),
            startup_sound: true,
            autoplay_next: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchProgress {
    pub media_id: String,
    pub media_url: String,
    pub title: String,
    pub orig_title: Option<String>,
    pub poster_url: String,
    pub media_type: String, // "movie", "series", "cartoon", "anime"
    pub translator_id: Option<String>,
    pub translator_name: Option<String>,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeProgress {
    pub media_id: String,
    pub season: i32,
    pub episode: i32,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub media_id: String,
    pub media_url: String,
    pub title: String,
    pub poster_url: String,
    pub media_type: String,
    pub year_info: Option<String>,
    pub rating: Option<String>,
    pub category: String, // "favorites", "watching", "planned", "watched"
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub media_id: String,
    pub media_url: String,
    pub title: String,
    pub orig_title: Option<String>,
    pub poster_url: String,
    pub media_type: String, // "movie", "series", "cartoon", "anime"
    pub genres: String,
    pub translator_id: String,
    pub translator_name: String,
    pub season: Option<i32>,
    pub episode: Option<i32>,
    pub quality: String,
    pub stream_url: String,
    pub file_path: String,
    pub temp_path: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub status: String, // "queued", "downloading", "paused", "completed", "error"
    pub error_message: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn new<P: AsRef<Path>>(path: P) -> SqlResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    fn init_schema(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS watch_progress (
                media_id TEXT PRIMARY KEY,
                media_url TEXT NOT NULL,
                title TEXT NOT NULL,
                orig_title TEXT,
                poster_url TEXT NOT NULL,
                media_type TEXT NOT NULL,
                translator_id TEXT,
                translator_name TEXT,
                season INTEGER,
                episode INTEGER,
                position_sec REAL NOT NULL,
                duration_sec REAL NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                media_id TEXT PRIMARY KEY,
                media_url TEXT NOT NULL,
                title TEXT NOT NULL,
                poster_url TEXT NOT NULL,
                media_type TEXT NOT NULL,
                year_info TEXT,
                rating TEXT,
                category TEXT NOT NULL,
                added_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS episode_progress (
                media_id TEXT NOT NULL,
                season INTEGER NOT NULL,
                episode INTEGER NOT NULL,
                position_sec REAL NOT NULL,
                duration_sec REAL NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (media_id, season, episode)
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                media_id TEXT NOT NULL,
                media_url TEXT NOT NULL,
                title TEXT NOT NULL,
                orig_title TEXT,
                poster_url TEXT NOT NULL,
                media_type TEXT NOT NULL,
                genres TEXT NOT NULL DEFAULT '',
                translator_id TEXT NOT NULL,
                translator_name TEXT NOT NULL,
                season INTEGER,
                episode INTEGER,
                quality TEXT NOT NULL,
                stream_url TEXT NOT NULL,
                file_path TEXT NOT NULL,
                temp_path TEXT NOT NULL,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                error_message TEXT,
                created_at INTEGER NOT NULL,
                completed_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_watch_progress_updated_at ON watch_progress (updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks (category);
            CREATE INDEX IF NOT EXISTS idx_episode_progress_media ON episode_progress (media_id);
            CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_downloads_media_id ON downloads (media_id);
            "#,
        )?;

        // Ensure default settings exist
        let defaults = AppSettings::default();
        let init_settings = [
            ("active_mirror", defaults.active_mirror),
            ("custom_mirrors", serde_json::to_string(&defaults.custom_mirrors).unwrap_or_default()),
            ("proxy_url", defaults.proxy_url),
            ("preferred_quality", defaults.preferred_quality),
            ("preferred_translator", defaults.preferred_translator),
            ("startup_sound", if defaults.startup_sound { "true".to_string() } else { "false".to_string() }),
            ("autoplay_next", if defaults.autoplay_next { "true".to_string() } else { "false".to_string() }),
        ];

        for (key, val) in init_settings {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, val],
            )?;
        }

        Ok(())
    }

    // --- Settings API ---

    pub fn get_settings(&self) -> SqlResult<AppSettings> {
        let conn = self.conn.lock().unwrap();
        let mut defaults = AppSettings::default();

        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })?;

        for item in rows {
            let (key, value) = item?;
            match key.as_str() {
                "active_mirror" => defaults.active_mirror = value,
                "custom_mirrors" => {
                    if let Ok(mirrors) = serde_json::from_str::<Vec<String>>(&value) {
                        defaults.custom_mirrors = mirrors;
                    }
                }
                "proxy_url" => defaults.proxy_url = value,
                "preferred_quality" => defaults.preferred_quality = value,
                "preferred_translator" => defaults.preferred_translator = value,
                "startup_sound" => defaults.startup_sound = value != "false",
                "autoplay_next" => defaults.autoplay_next = value != "false",
                _ => {}
            }
        }

        Ok(defaults)
    }

    pub fn update_settings(&self, settings: &AppSettings) -> SqlResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let custom_mirrors_json = serde_json::to_string(&settings.custom_mirrors)
            .unwrap_or_else(|_| "[]".to_string());
        let sound_str = if settings.startup_sound { "true" } else { "false" };
        let autoplay_str = if settings.autoplay_next { "true" } else { "false" };

        let pairs = [
            ("active_mirror", settings.active_mirror.as_str()),
            ("custom_mirrors", custom_mirrors_json.as_str()),
            ("proxy_url", settings.proxy_url.as_str()),
            ("preferred_quality", settings.preferred_quality.as_str()),
            ("preferred_translator", settings.preferred_translator.as_str()),
            ("startup_sound", sound_str),
            ("autoplay_next", autoplay_str),
        ];

        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            )?;
            for (key, val) in pairs {
                stmt.execute(params![key, val])?;
            }
        }
        tx.commit()?;

        Ok(())
    }

    // --- Watch Progress API ---

    pub fn save_watch_progress(&self, progress: &WatchProgress) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"
            INSERT INTO watch_progress (
                media_id, media_url, title, orig_title, poster_url, media_type,
                translator_id, translator_name, season, episode,
                position_sec, duration_sec, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(media_id) DO UPDATE SET
                media_url = excluded.media_url,
                title = excluded.title,
                orig_title = excluded.orig_title,
                poster_url = excluded.poster_url,
                media_type = excluded.media_type,
                translator_id = excluded.translator_id,
                translator_name = excluded.translator_name,
                season = excluded.season,
                episode = excluded.episode,
                position_sec = excluded.position_sec,
                duration_sec = excluded.duration_sec,
                updated_at = excluded.updated_at
            "#,
            params![
                progress.media_id,
                progress.media_url,
                progress.title,
                progress.orig_title,
                progress.poster_url,
                progress.media_type,
                progress.translator_id,
                progress.translator_name,
                progress.season,
                progress.episode,
                progress.position_sec,
                progress.duration_sec,
                progress.updated_at,
            ],
        )?;

        if let (Some(season), Some(episode)) = (progress.season, progress.episode) {
            conn.execute(
                r#"
                INSERT INTO episode_progress (media_id, season, episode, position_sec, duration_sec, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(media_id, season, episode) DO UPDATE SET
                    position_sec = excluded.position_sec,
                    duration_sec = excluded.duration_sec,
                    updated_at = excluded.updated_at
                "#,
                params![
                    progress.media_id,
                    season,
                    episode,
                    progress.position_sec,
                    progress.duration_sec,
                    progress.updated_at,
                ],
            )?;
        }

        Ok(())
    }

    pub fn get_watch_progress(&self, media_id: &str) -> SqlResult<Option<WatchProgress>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT media_id, media_url, title, orig_title, poster_url, media_type,
                   translator_id, translator_name, season, episode,
                   position_sec, duration_sec, updated_at
            FROM watch_progress
            WHERE media_id = ?1
            "#,
        )?;

        let mut rows = stmt.query(params![media_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(WatchProgress {
                media_id: row.get(0)?,
                media_url: row.get(1)?,
                title: row.get(2)?,
                orig_title: row.get(3)?,
                poster_url: row.get(4)?,
                media_type: row.get(5)?,
                translator_id: row.get(6)?,
                translator_name: row.get(7)?,
                season: row.get(8)?,
                episode: row.get(9)?,
                position_sec: row.get(10)?,
                duration_sec: row.get(11)?,
                updated_at: row.get(12)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_continue_watching(&self, limit: usize) -> SqlResult<Vec<WatchProgress>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT media_id, media_url, title, orig_title, poster_url, media_type,
                   translator_id, translator_name, season, episode,
                   position_sec, duration_sec, updated_at
            FROM watch_progress
            ORDER BY updated_at DESC
            LIMIT ?1
            "#,
        )?;

        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(WatchProgress {
                media_id: row.get(0)?,
                media_url: row.get(1)?,
                title: row.get(2)?,
                orig_title: row.get(3)?,
                poster_url: row.get(4)?,
                media_type: row.get(5)?,
                translator_id: row.get(6)?,
                translator_name: row.get(7)?,
                season: row.get(8)?,
                episode: row.get(9)?,
                position_sec: row.get(10)?,
                duration_sec: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    pub fn delete_watch_progress(&self, media_id: &str) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM episode_progress WHERE media_id = ?1", params![media_id]);
        let rows = conn.execute("DELETE FROM watch_progress WHERE media_id = ?1", params![media_id])?;
        Ok(rows > 0)
    }

    pub fn get_episode_progress(&self, media_id: &str) -> SqlResult<Vec<EpisodeProgress>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT media_id, season, episode, position_sec, duration_sec, updated_at
            FROM episode_progress
            WHERE media_id = ?1
            ORDER BY season ASC, episode ASC
            "#,
        )?;

        let rows = stmt.query_map(params![media_id], |row| {
            Ok(EpisodeProgress {
                media_id: row.get(0)?,
                season: row.get(1)?,
                episode: row.get(2)?,
                position_sec: row.get(3)?,
                duration_sec: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;

        let mut list = Vec::new();
        for item in rows {
            list.push(item?);
        }
        Ok(list)
    }

    // --- Bookmarks API ---

    pub fn toggle_bookmark(&self, bookmark: &Bookmark) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = conn
            .query_row(
                "SELECT category FROM bookmarks WHERE media_id = ?1",
                params![bookmark.media_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(cat) = existing {
            if cat == bookmark.category {
                // If same category, remove bookmark (toggle off)
                conn.execute(
                    "DELETE FROM bookmarks WHERE media_id = ?1",
                    params![bookmark.media_id],
                )?;
                return Ok(false);
            }
        }

        // Insert or update category
        conn.execute(
            r#"
            INSERT INTO bookmarks (
                media_id, media_url, title, poster_url, media_type,
                year_info, rating, category, added_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(media_id) DO UPDATE SET
                media_url = excluded.media_url,
                title = excluded.title,
                poster_url = excluded.poster_url,
                media_type = excluded.media_type,
                year_info = excluded.year_info,
                rating = excluded.rating,
                category = excluded.category,
                added_at = excluded.added_at
            "#,
            params![
                bookmark.media_id,
                bookmark.media_url,
                bookmark.title,
                bookmark.poster_url,
                bookmark.media_type,
                bookmark.year_info,
                bookmark.rating,
                bookmark.category,
                bookmark.added_at,
            ],
        )?;

        Ok(true)
    }

    pub fn get_bookmarks(&self, category: Option<&str>) -> SqlResult<Vec<Bookmark>> {
        let conn = self.conn.lock().unwrap();
        let mut list = Vec::new();

        if let Some(cat) = category {
            let mut stmt = conn.prepare(
                r#"
                SELECT media_id, media_url, title, poster_url, media_type,
                       year_info, rating, category, added_at
                FROM bookmarks
                WHERE category = ?1
                ORDER BY added_at DESC
                "#,
            )?;
            let rows = stmt.query_map(params![cat], |row| {
                Ok(Bookmark {
                    media_id: row.get(0)?,
                    media_url: row.get(1)?,
                    title: row.get(2)?,
                    poster_url: row.get(3)?,
                    media_type: row.get(4)?,
                    year_info: row.get(5)?,
                    rating: row.get(6)?,
                    category: row.get(7)?,
                    added_at: row.get(8)?,
                })
            })?;
            for item in rows {
                list.push(item?);
            }
        } else {
            let mut stmt = conn.prepare(
                r#"
                SELECT media_id, media_url, title, poster_url, media_type,
                       year_info, rating, category, added_at
                FROM bookmarks
                ORDER BY added_at DESC
                "#,
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(Bookmark {
                    media_id: row.get(0)?,
                    media_url: row.get(1)?,
                    title: row.get(2)?,
                    poster_url: row.get(3)?,
                    media_type: row.get(4)?,
                    year_info: row.get(5)?,
                    rating: row.get(6)?,
                    category: row.get(7)?,
                    added_at: row.get(8)?,
                })
            })?;
            for item in rows {
                list.push(item?);
            }
        }

        Ok(list)
    }

    pub fn is_bookmarked(&self, media_id: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let cat: Option<String> = conn
            .query_row(
                "SELECT category FROM bookmarks WHERE media_id = ?1",
                params![media_id],
                |row| row.get(0),
            )
            .ok();
        Ok(cat)
    }

    // ==================== Downloads Storage ====================

    pub fn add_or_update_download(&self, item: &DownloadItem) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"
            INSERT INTO downloads (
                id, media_id, media_url, title, orig_title, poster_url, media_type,
                genres, translator_id, translator_name, season, episode, quality,
                stream_url, file_path, temp_path, total_bytes, downloaded_bytes,
                status, error_message, created_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
            ON CONFLICT(id) DO UPDATE SET
                total_bytes = ?17,
                downloaded_bytes = ?18,
                status = ?19,
                error_message = ?20,
                completed_at = COALESCE(?22, completed_at)
            "#,
            params![
                item.id,
                item.media_id,
                item.media_url,
                item.title,
                item.orig_title,
                item.poster_url,
                item.media_type,
                item.genres,
                item.translator_id,
                item.translator_name,
                item.season,
                item.episode,
                item.quality,
                item.stream_url,
                item.file_path,
                item.temp_path,
                item.total_bytes as i64,
                item.downloaded_bytes as i64,
                item.status,
                item.error_message,
                item.created_at,
                item.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_downloads(&self) -> SqlResult<Vec<DownloadItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached(
            r#"
            SELECT id, media_id, media_url, title, orig_title, poster_url, media_type,
                   genres, translator_id, translator_name, season, episode, quality,
                   stream_url, file_path, temp_path, total_bytes, downloaded_bytes,
                   status, error_message, created_at, completed_at
            FROM downloads
            ORDER BY created_at DESC
            "#,
        )?;

        let rows = stmt.query_map([], |row| {
            let total_i64: i64 = row.get(16)?;
            let downloaded_i64: i64 = row.get(17)?;
            Ok(DownloadItem {
                id: row.get(0)?,
                media_id: row.get(1)?,
                media_url: row.get(2)?,
                title: row.get(3)?,
                orig_title: row.get(4)?,
                poster_url: row.get(5)?,
                media_type: row.get(6)?,
                genres: row.get(7)?,
                translator_id: row.get(8)?,
                translator_name: row.get(9)?,
                season: row.get(10)?,
                episode: row.get(11)?,
                quality: row.get(12)?,
                stream_url: row.get(13)?,
                file_path: row.get(14)?,
                temp_path: row.get(15)?,
                total_bytes: total_i64.max(0) as u64,
                downloaded_bytes: downloaded_i64.max(0) as u64,
                status: row.get(18)?,
                error_message: row.get(19)?,
                created_at: row.get(20)?,
                completed_at: row.get(21)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                list.push(item);
            }
        }
        Ok(list)
    }

    pub fn get_download_by_id(&self, id: &str) -> SqlResult<Option<DownloadItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare_cached(
            r#"
            SELECT id, media_id, media_url, title, orig_title, poster_url, media_type,
                   genres, translator_id, translator_name, season, episode, quality,
                   stream_url, file_path, temp_path, total_bytes, downloaded_bytes,
                   status, error_message, created_at, completed_at
            FROM downloads
            WHERE id = ?1
            "#,
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let total_i64: i64 = row.get(16)?;
            let downloaded_i64: i64 = row.get(17)?;
            Ok(DownloadItem {
                id: row.get(0)?,
                media_id: row.get(1)?,
                media_url: row.get(2)?,
                title: row.get(3)?,
                orig_title: row.get(4)?,
                poster_url: row.get(5)?,
                media_type: row.get(6)?,
                genres: row.get(7)?,
                translator_id: row.get(8)?,
                translator_name: row.get(9)?,
                season: row.get(10)?,
                episode: row.get(11)?,
                quality: row.get(12)?,
                stream_url: row.get(13)?,
                file_path: row.get(14)?,
                temp_path: row.get(15)?,
                total_bytes: total_i64.max(0) as u64,
                downloaded_bytes: downloaded_i64.max(0) as u64,
                status: row.get(18)?,
                error_message: row.get(19)?,
                created_at: row.get(20)?,
                completed_at: row.get(21)?,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(r.ok())
        } else {
            Ok(None)
        }
    }

    pub fn update_download_progress(
        &self,
        id: &str,
        downloaded: u64,
        total: u64,
        status: &str,
        error_message: Option<&str>,
    ) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let completed_at = if status == "completed" {
            Some(chrono::Utc::now().timestamp_millis())
        } else {
            None
        };

        conn.execute(
            r#"
            UPDATE downloads
            SET downloaded_bytes = ?2,
                total_bytes = CASE WHEN ?3 > 0 THEN ?3 ELSE total_bytes END,
                status = ?4,
                error_message = ?5,
                completed_at = COALESCE(?6, completed_at)
            WHERE id = ?1
            "#,
            params![
                id,
                downloaded as i64,
                total as i64,
                status,
                error_message,
                completed_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_download(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub fn default_db_path() -> PathBuf {
    if let Some(mut dir) = dirs::data_dir() {
        dir.push("rdx");
        dir.push("rdx_data.db");
        dir
    } else {
        PathBuf::from("rdx_data.db")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_settings() {
        let storage = Storage::in_memory().expect("in memory db");
        let settings = storage.get_settings().expect("get settings");
        assert_eq!(settings.active_mirror, "https://hdrezka.me");

        let mut updated = settings;
        updated.active_mirror = "https://custom-mirror.com".to_string();
        storage.update_settings(&updated).expect("update settings");

        let reloaded = storage.get_settings().expect("reload settings");
        assert_eq!(reloaded.active_mirror, "https://custom-mirror.com");
    }

    #[test]
    fn test_watch_progress() {
        let storage = Storage::in_memory().expect("in memory db");
        let item = WatchProgress {
            media_id: "123".to_string(),
            media_url: "/films/drama/123.html".to_string(),
            title: "Test Film".to_string(),
            orig_title: Some("Test Film Orig".to_string()),
            poster_url: "https://example.com/poster.jpg".to_string(),
            media_type: "movie".to_string(),
            translator_id: Some("1".to_string()),
            translator_name: Some("Dubbing".to_string()),
            season: None,
            episode: None,
            position_sec: 120.5,
            duration_sec: 7200.0,
            updated_at: 1000,
        };

        storage.save_watch_progress(&item).expect("save progress");

        let retrieved = storage.get_watch_progress("123").expect("get progress").unwrap();
        assert_eq!(retrieved.title, "Test Film");
        assert_eq!(retrieved.position_sec, 120.5);

        let list = storage.get_continue_watching(10).expect("continue watching");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].media_id, "123");
    }

    #[test]
    fn test_bookmarks_toggle() {
        let storage = Storage::in_memory().expect("in memory db");
        let bookmark = Bookmark {
            media_id: "456".to_string(),
            media_url: "/series/456.html".to_string(),
            title: "Test Series".to_string(),
            poster_url: "https://example.com/poster2.jpg".to_string(),
            media_type: "series".to_string(),
            year_info: Some("2026".to_string()),
            rating: Some("8.5".to_string()),
            category: "favorites".to_string(),
            added_at: 2000,
        };

        // First toggle should add
        let added = storage.toggle_bookmark(&bookmark).expect("toggle bookmark");
        assert!(added);
        assert_eq!(storage.is_bookmarked("456").unwrap(), Some("favorites".to_string()));

        // Second toggle with same category should remove
        let removed = storage.toggle_bookmark(&bookmark).expect("toggle bookmark again");
        assert!(!removed);
        assert_eq!(storage.is_bookmarked("456").unwrap(), None);
    }

    #[test]
    fn test_episode_progress_and_autoplay() {
        let storage = Storage::in_memory().expect("in memory db");
        let settings = storage.get_settings().expect("get settings");
        assert!(settings.autoplay_next);

        let mut updated_settings = settings;
        updated_settings.autoplay_next = false;
        storage.update_settings(&updated_settings).expect("update settings");
        let reloaded = storage.get_settings().expect("reload settings");
        assert!(!reloaded.autoplay_next);

        let ep1 = WatchProgress {
            media_id: "series_1".to_string(),
            media_url: "/series/1.html".to_string(),
            title: "Series 1".to_string(),
            orig_title: None,
            poster_url: "https://example.com/p.jpg".to_string(),
            media_type: "series".to_string(),
            translator_id: Some("1".to_string()),
            translator_name: Some("Dub".to_string()),
            season: Some(1),
            episode: Some(1),
            position_sec: 120.0,
            duration_sec: 2400.0,
            updated_at: 1000,
        };

        let ep2 = WatchProgress {
            media_id: "series_1".to_string(),
            media_url: "/series/1.html".to_string(),
            title: "Series 1".to_string(),
            orig_title: None,
            poster_url: "https://example.com/p.jpg".to_string(),
            media_type: "series".to_string(),
            translator_id: Some("1".to_string()),
            translator_name: Some("Dub".to_string()),
            season: Some(1),
            episode: Some(2),
            position_sec: 300.0,
            duration_sec: 2400.0,
            updated_at: 2000,
        };

        storage.save_watch_progress(&ep1).expect("save ep1");
        storage.save_watch_progress(&ep2).expect("save ep2");

        let progress_list = storage.get_episode_progress("series_1").expect("get ep progress");
        assert_eq!(progress_list.len(), 2);
        assert_eq!(progress_list[0].season, 1);
        assert_eq!(progress_list[0].episode, 1);
        assert_eq!(progress_list[0].position_sec, 120.0);
        assert_eq!(progress_list[1].season, 1);
        assert_eq!(progress_list[1].episode, 2);
        assert_eq!(progress_list[1].position_sec, 300.0);

        // Update ep1 progress
        let mut ep1_updated = ep1;
        ep1_updated.position_sec = 2350.0;
        storage.save_watch_progress(&ep1_updated).expect("update ep1");
        let updated_list = storage.get_episode_progress("series_1").expect("get ep progress");
        assert_eq!(updated_list.len(), 2);
        assert_eq!(updated_list[0].position_sec, 2350.0);

        // Delete test
        storage.delete_watch_progress("series_1").expect("delete");
        let empty_list = storage.get_episode_progress("series_1").expect("get ep progress");
        assert!(empty_list.is_empty());
    }
}
