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
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_mirror: "https://rezka-tv.org".to_string(),
            custom_mirrors: vec![
                "https://rezka-tv.org".to_string(),
                "https://hdrezka.me".to_string(),
                "https://rezka.ag".to_string(),
            ],
            proxy_url: "".to_string(),
            preferred_quality: "720p".to_string(),
            preferred_translator: "".to_string(),
            startup_sound: true,
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

pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn new<P: AsRef<Path>>(path: P) -> SqlResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
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

            CREATE INDEX IF NOT EXISTS idx_watch_progress_updated_at ON watch_progress (updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks (category);
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
                _ => {}
            }
        }

        Ok(defaults)
    }

    pub fn update_settings(&self, settings: &AppSettings) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let custom_mirrors_json = serde_json::to_string(&settings.custom_mirrors)
            .unwrap_or_else(|_| "[]".to_string());
        let sound_str = if settings.startup_sound { "true" } else { "false" };

        let pairs = [
            ("active_mirror", settings.active_mirror.as_str()),
            ("custom_mirrors", custom_mirrors_json.as_str()),
            ("proxy_url", settings.proxy_url.as_str()),
            ("preferred_quality", settings.preferred_quality.as_str()),
            ("preferred_translator", settings.preferred_translator.as_str()),
            ("startup_sound", sound_str),
        ];

        for (key, val) in pairs {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
                params![key, val],
            )?;
        }

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
        let rows = conn.execute("DELETE FROM watch_progress WHERE media_id = ?1", params![media_id])?;
        Ok(rows > 0)
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
        assert_eq!(settings.active_mirror, "https://rezka-tv.org");

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
}
