use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

use crate::storage::{DownloadItem, Storage};

pub const MAX_CONCURRENT_DOWNLOADS: usize = 3;

pub fn get_downloads_dir() -> PathBuf {
    if let Some(dir) = dirs::data_local_dir() {
        let target = dir.join("rdx").join("downloads");
        let _ = std::fs::create_dir_all(&target);
        target
    } else {
        let target = PathBuf::from("downloads");
        let _ = std::fs::create_dir_all(&target);
        target
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveDownloadProgress {
    pub id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_sec: u64,
    pub status: String,
}

pub struct DownloadManager {
    storage: Arc<Storage>,
    active_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    active_progress: Arc<Mutex<HashMap<String, ActiveDownloadProgress>>>,
    client: reqwest::Client,
}

impl DownloadManager {
    pub fn new(storage: Arc<Storage>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();

        // On startup: reset any stuck "downloading" tasks from previous session to "queued"
        let _ = storage.reset_interrupted_downloads();

        Self {
            storage,
            active_tokens: Arc::new(Mutex::new(HashMap::new())),
            active_progress: Arc::new(Mutex::new(HashMap::new())),
            client,
        }
    }

    pub fn get_all_active_progress(&self) -> HashMap<String, ActiveDownloadProgress> {
        self.active_progress.lock().unwrap().clone()
    }

    pub async fn start_download(
        &self,
        item: DownloadItem,
        app: AppHandle,
    ) -> Result<DownloadItem, String> {
        let id = item.id.clone();
        let mut initial_item = item.clone();

        let active_count = {
            let guard = self.active_tokens.lock().unwrap();
            guard.len()
        };

        // If concurrency limit reached, mark as queued and let the worker queue pick it up
        if active_count >= MAX_CONCURRENT_DOWNLOADS {
            initial_item.status = "queued".to_string();
            initial_item.error_message = None;

            self.storage
                .add_or_update_download(&initial_item)
                .map_err(|e| format!("DB error: {e}"))?;

            {
                let mut p_guard = self.active_progress.lock().unwrap();
                p_guard.insert(
                    id.clone(),
                    ActiveDownloadProgress {
                        id: id.clone(),
                        downloaded_bytes: initial_item.downloaded_bytes,
                        total_bytes: initial_item.total_bytes,
                        speed_bytes_sec: 0,
                        status: "queued".to_string(),
                    },
                );
            }

            let _ = app.emit(
                "download://progress",
                serde_json::json!({
                    "id": &id,
                    "downloaded_bytes": initial_item.downloaded_bytes,
                    "total_bytes": initial_item.total_bytes,
                    "speed_bytes_sec": 0,
                    "status": "queued",
                }),
            );

            return Ok(initial_item);
        }

        // Slot is available: start downloading!
        initial_item.status = "downloading".to_string();
        initial_item.error_message = None;

        self.storage
            .add_or_update_download(&initial_item)
            .map_err(|e| format!("DB error: {e}"))?;

        // Set up cancellation / pause watch channel
        let (tx, rx) = watch::channel(false);
        {
            let mut guard = self.active_tokens.lock().unwrap();
            guard.insert(id.clone(), tx);
        }

        // Register initial active progress
        {
            let mut p_guard = self.active_progress.lock().unwrap();
            p_guard.insert(
                id.clone(),
                ActiveDownloadProgress {
                    id: id.clone(),
                    downloaded_bytes: initial_item.downloaded_bytes,
                    total_bytes: initial_item.total_bytes,
                    speed_bytes_sec: 0,
                    status: "downloading".to_string(),
                },
            );
        }

        let _ = app.emit(
            "download://progress",
            serde_json::json!({
                "id": &id,
                "downloaded_bytes": initial_item.downloaded_bytes,
                "total_bytes": initial_item.total_bytes,
                "speed_bytes_sec": 0,
                "status": "downloading",
            }),
        );

        // Spawn background download worker task
        let storage = self.storage.clone();
        let tokens = self.active_tokens.clone();
        let progress = self.active_progress.clone();
        let client = self.client.clone();

        tokio::spawn(async move {
            Self::run_download_task(initial_item, client, storage, tokens, progress, rx, app).await;
        });

        Ok(item)
    }

    pub fn pause_download(&self, id: &str, app: AppHandle) -> Result<(), String> {
        let mut guard = self.active_tokens.lock().unwrap();
        if let Some(tx) = guard.remove(id) {
            let _ = tx.send(true);
        }

        {
            let mut p_guard = self.active_progress.lock().unwrap();
            if let Some(p) = p_guard.get_mut(id) {
                p.status = "paused".to_string();
                p.speed_bytes_sec = 0;
            }
        }

        let _ = self.storage.update_download_progress(
            id,
            0,
            0,
            "paused",
            None,
        );

        let _ = app.emit(
            "download://progress",
            serde_json::json!({
                "id": id,
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "speed_bytes_sec": 0,
                "status": "paused",
            }),
        );

        // Check if there are queued downloads waiting for this freed slot
        Self::spawn_check_next(
            self.storage.clone(),
            self.active_tokens.clone(),
            self.active_progress.clone(),
            self.client.clone(),
            app,
        );

        Ok(())
    }

    pub async fn resume_download(&self, id: &str, app: AppHandle) -> Result<(), String> {
        let item = self
            .storage
            .get_download_by_id(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Download not found".to_string())?;

        self.start_download(item, app).await?;
        Ok(())
    }

    pub async fn cancel_download(&self, id: &str, app: AppHandle) -> Result<(), String> {
        // Stop active task
        {
            let mut guard = self.active_tokens.lock().unwrap();
            if let Some(tx) = guard.remove(id) {
                let _ = tx.send(true);
            }
        }

        {
            let mut p_guard = self.active_progress.lock().unwrap();
            p_guard.remove(id);
        }

        // Remove .part file if exists
        if let Ok(Some(item)) = self.storage.get_download_by_id(id) {
            let temp_path = PathBuf::from(&item.temp_path);
            if temp_path.exists() {
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
        }

        // Delete from database
        self.storage
            .delete_download(id)
            .map_err(|e| format!("DB delete error: {e}"))?;

        // Slot freed: start next queued
        Self::spawn_check_next(
            self.storage.clone(),
            self.active_tokens.clone(),
            self.active_progress.clone(),
            self.client.clone(),
            app,
        );

        Ok(())
    }

    pub async fn delete_download(&self, id: &str, app: AppHandle) -> Result<(), String> {
        {
            let mut guard = self.active_tokens.lock().unwrap();
            if let Some(tx) = guard.remove(id) {
                let _ = tx.send(true);
            }
        }

        {
            let mut p_guard = self.active_progress.lock().unwrap();
            p_guard.remove(id);
        }

        if let Ok(Some(item)) = self.storage.get_download_by_id(id) {
            let file_path = PathBuf::from(&item.file_path);
            if file_path.exists() {
                let _ = tokio::fs::remove_file(&file_path).await;
            }
            let temp_path = PathBuf::from(&item.temp_path);
            if temp_path.exists() {
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
        }

        self.storage
            .delete_download(id)
            .map_err(|e| format!("DB delete error: {e}"))?;

        Self::spawn_check_next(
            self.storage.clone(),
            self.active_tokens.clone(),
            self.active_progress.clone(),
            self.client.clone(),
            app,
        );

        Ok(())
    }

    fn spawn_check_next(
        storage: Arc<Storage>,
        tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
        progress: Arc<Mutex<HashMap<String, ActiveDownloadProgress>>>,
        client: reqwest::Client,
        app: AppHandle,
    ) {
        tokio::spawn(async move {
            Self::check_and_start_next(storage, tokens, progress, client, app).await;
        });
    }

    pub async fn check_and_start_next(
        storage: Arc<Storage>,
        tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
        progress: Arc<Mutex<HashMap<String, ActiveDownloadProgress>>>,
        client: reqwest::Client,
        app: AppHandle,
    ) {
        loop {
            let active_count = {
                let guard = tokens.lock().unwrap();
                guard.len()
            };

            if active_count >= MAX_CONCURRENT_DOWNLOADS {
                break;
            }

            // Find next queued download in DB
            let next_item = match storage.get_next_queued_download() {
                Ok(Some(item)) => item,
                _ => break,
            };

            let id = next_item.id.clone();
            let mut initial_item = next_item;
            initial_item.status = "downloading".to_string();
            initial_item.error_message = None;

            let _ = storage.add_or_update_download(&initial_item);

            let (tx, rx) = watch::channel(false);
            {
                let mut guard = tokens.lock().unwrap();
                guard.insert(id.clone(), tx);
            }

            {
                let mut p_guard = progress.lock().unwrap();
                p_guard.insert(
                    id.clone(),
                    ActiveDownloadProgress {
                        id: id.clone(),
                        downloaded_bytes: initial_item.downloaded_bytes,
                        total_bytes: initial_item.total_bytes,
                        speed_bytes_sec: 0,
                        status: "downloading".to_string(),
                    },
                );
            }

            let _ = app.emit(
                "download://progress",
                serde_json::json!({
                    "id": &id,
                    "downloaded_bytes": initial_item.downloaded_bytes,
                    "total_bytes": initial_item.total_bytes,
                    "speed_bytes_sec": 0,
                    "status": "downloading",
                }),
            );

            let s = storage.clone();
            let t = tokens.clone();
            let p = progress.clone();
            let c = client.clone();
            let a = app.clone();

            tokio::spawn(async move {
                Self::run_download_task(initial_item, c, s, t, p, rx, a).await;
            });
        }
    }

    async fn run_download_task(
        item: DownloadItem,
        client: reqwest::Client,
        storage: Arc<Storage>,
        tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
        progress: Arc<Mutex<HashMap<String, ActiveDownloadProgress>>>,
        abort_rx: watch::Receiver<bool>,
        app: AppHandle,
    ) {
        let id = item.id.clone();
        let temp_path = PathBuf::from(&item.temp_path);
        let final_path = PathBuf::from(&item.file_path);

        if let Some(parent) = temp_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        // Check existing .part bytes for HTTP Range request resume
        let mut existing_bytes = tokio::fs::metadata(&temp_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let mut retry_count = 0;
        const MAX_RETRIES: u32 = 3;

        let success = loop {
            if *abort_rx.borrow() {
                {
                    let mut p_guard = progress.lock().unwrap();
                    if let Some(p) = p_guard.get_mut(&id) {
                        p.status = "paused".to_string();
                        p.speed_bytes_sec = 0;
                        p.downloaded_bytes = existing_bytes;
                    }
                }
                let _ = storage.update_download_progress(
                    &id,
                    existing_bytes,
                    item.total_bytes,
                    "paused",
                    None,
                );
                let _ = app.emit(
                    "download://progress",
                    serde_json::json!({
                        "id": &id,
                        "downloaded_bytes": existing_bytes,
                        "total_bytes": item.total_bytes,
                        "speed_bytes_sec": 0,
                        "status": "paused",
                    }),
                );
                break false;
            }

            let mut req = client.get(&item.stream_url);
            if existing_bytes > 0 {
                req = req.header("Range", format!("bytes={}-", existing_bytes));
            }

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
                        if retry_count < MAX_RETRIES {
                            retry_count += 1;
                            tokio::time::sleep(Duration::from_secs(retry_count as u64 * 2)).await;
                            continue;
                        }
                        let msg = format!("HTTP error: {}", status);
                        {
                            let mut p_guard = progress.lock().unwrap();
                            if let Some(p) = p_guard.get_mut(&id) {
                                p.status = "error".to_string();
                                p.speed_bytes_sec = 0;
                            }
                        }
                        let _ = storage.update_download_progress(
                            &id,
                            existing_bytes,
                            item.total_bytes,
                            "error",
                            Some(&msg),
                        );
                        let _ = app.emit(
                            "download://progress",
                            serde_json::json!({
                                "id": &id,
                                "downloaded_bytes": existing_bytes,
                                "total_bytes": item.total_bytes,
                                "speed_bytes_sec": 0,
                                "status": "error",
                            }),
                        );
                        break false;
                    }

                    // Content length resolution
                    let content_len = resp.content_length().unwrap_or(0);
                    let total_bytes = if status == reqwest::StatusCode::PARTIAL_CONTENT {
                        existing_bytes + content_len
                    } else {
                        // Server doesn't support Range, starts from 0
                        existing_bytes = 0;
                        content_len
                    };

                    {
                        let mut p_guard = progress.lock().unwrap();
                        if let Some(p) = p_guard.get_mut(&id) {
                            p.total_bytes = total_bytes;
                            p.downloaded_bytes = existing_bytes;
                            p.status = "downloading".to_string();
                        }
                    }

                    let _ = app.emit(
                        "download://progress",
                        serde_json::json!({
                            "id": &id,
                            "downloaded_bytes": existing_bytes,
                            "total_bytes": total_bytes,
                            "speed_bytes_sec": 0,
                            "status": "downloading",
                        }),
                    );

                    let open_res = OpenOptions::new()
                        .create(true)
                        .append(true)
                        .write(true)
                        .open(&temp_path)
                        .await;

                    let mut file = match open_res {
                        Ok(f) => f,
                        Err(e) => {
                            let msg = format!("File open error: {e}");
                            {
                                let mut p_guard = progress.lock().unwrap();
                                if let Some(p) = p_guard.get_mut(&id) {
                                    p.status = "error".to_string();
                                    p.speed_bytes_sec = 0;
                                }
                            }
                            let _ = storage.update_download_progress(
                                &id,
                                existing_bytes,
                                total_bytes,
                                "error",
                                Some(&msg),
                            );
                            break false;
                        }
                    };

                    let mut resp = resp;
                    let mut speed_calc_time = Instant::now();
                    let mut bytes_since_calc: u64 = 0;
                    let mut current_speed: u64;
                    let mut last_db_save = Instant::now();

                    let mut stream_err = false;
                    let mut was_paused = false;

                    loop {
                        // Check if paused or cancelled by user
                        if *abort_rx.borrow() {
                            let _ = file.flush().await;
                            {
                                let mut p_guard = progress.lock().unwrap();
                                if let Some(p) = p_guard.get_mut(&id) {
                                    p.status = "paused".to_string();
                                    p.speed_bytes_sec = 0;
                                    p.downloaded_bytes = existing_bytes;
                                }
                            }
                            let _ = storage.update_download_progress(
                                &id,
                                existing_bytes,
                                total_bytes,
                                "paused",
                                None,
                            );
                            let _ = app.emit(
                                "download://progress",
                                serde_json::json!({
                                    "id": &id,
                                    "downloaded_bytes": existing_bytes,
                                    "total_bytes": total_bytes,
                                    "speed_bytes_sec": 0,
                                    "status": "paused",
                                }),
                            );
                            was_paused = true;
                            break;
                        }

                        match resp.chunk().await {
                            Ok(Some(chunk)) => {
                                if let Err(e) = file.write_all(&chunk).await {
                                    eprintln!("Download write error: {e}");
                                    stream_err = true;
                                    break;
                                }

                                let len = chunk.len() as u64;
                                existing_bytes += len;
                                bytes_since_calc += len;

                                // Update speed measurement every 400ms
                                let elapsed = speed_calc_time.elapsed();
                                if elapsed >= Duration::from_millis(400) {
                                    current_speed = (bytes_since_calc as f64
                                        / elapsed.as_secs_f64())
                                        as u64;
                                    speed_calc_time = Instant::now();
                                    bytes_since_calc = 0;

                                    {
                                        let mut p_guard = progress.lock().unwrap();
                                        if let Some(p) = p_guard.get_mut(&id) {
                                            p.downloaded_bytes = existing_bytes;
                                            p.total_bytes = total_bytes;
                                            p.speed_bytes_sec = current_speed;
                                            p.status = "downloading".to_string();
                                        }
                                    }

                                    let _ = app.emit(
                                        "download://progress",
                                        serde_json::json!({
                                            "id": &id,
                                            "downloaded_bytes": existing_bytes,
                                            "total_bytes": total_bytes,
                                            "speed_bytes_sec": current_speed,
                                            "status": "downloading",
                                        }),
                                    );
                                }

                                // Persist progress to SQLite every 2 seconds
                                if last_db_save.elapsed() >= Duration::from_secs(2) {
                                    last_db_save = Instant::now();
                                    let _ = storage.update_download_progress(
                                        &id,
                                        existing_bytes,
                                        total_bytes,
                                        "downloading",
                                        None,
                                    );
                                }
                            }
                            Ok(None) => {
                                // End of stream
                                break;
                            }
                            Err(e) => {
                                eprintln!("Download stream chunk error: {e}");
                                stream_err = true;
                                break;
                            }
                        }
                    }

                    let _ = file.flush().await;

                    if was_paused {
                        break false;
                    }

                    if stream_err {
                        if retry_count < MAX_RETRIES {
                            retry_count += 1;
                            tokio::time::sleep(Duration::from_secs(retry_count as u64 * 2)).await;
                            continue;
                        }
                        {
                            let mut p_guard = progress.lock().unwrap();
                            if let Some(p) = p_guard.get_mut(&id) {
                                p.status = "error".to_string();
                                p.speed_bytes_sec = 0;
                            }
                        }
                        let _ = storage.update_download_progress(
                            &id,
                            existing_bytes,
                            total_bytes,
                            "error",
                            Some("Network dropout"),
                        );
                        break false;
                    }

                    // Completed successfully
                    break true;
                }
                Err(e) => {
                    if retry_count < MAX_RETRIES {
                        retry_count += 1;
                        tokio::time::sleep(Duration::from_secs(retry_count as u64 * 2)).await;
                        continue;
                    }
                    let msg = format!("Connection error: {e}");
                    {
                        let mut p_guard = progress.lock().unwrap();
                        if let Some(p) = p_guard.get_mut(&id) {
                            p.status = "error".to_string();
                            p.speed_bytes_sec = 0;
                        }
                    }
                    let _ = storage.update_download_progress(
                        &id,
                        existing_bytes,
                        item.total_bytes,
                        "error",
                        Some(&msg),
                    );
                    break false;
                }
            }
        };

        // Always remove token on task exit
        {
            let mut guard = tokens.lock().unwrap();
            guard.remove(&id);
        }

        if success {
            {
                let mut p_guard = progress.lock().unwrap();
                p_guard.remove(&id);
            }

            // Rename .part file to final .mp4
            if let Err(e) = tokio::fs::rename(&temp_path, &final_path).await {
                eprintln!("Failed to rename part file: {e}");
                let _ = storage.update_download_progress(
                    &id,
                    existing_bytes,
                    existing_bytes,
                    "error",
                    Some("Failed to rename completed file"),
                );
            } else {
                let _ = storage.update_download_progress(
                    &id,
                    existing_bytes,
                    existing_bytes,
                    "completed",
                    None,
                );

                let _ = app.emit(
                    "download://complete",
                    serde_json::json!({
                        "id": &id,
                        "file_path": final_path.to_string_lossy().to_string(),
                    }),
                );

                let _ = app.emit(
                    "download://progress",
                    serde_json::json!({
                        "id": &id,
                        "downloaded_bytes": existing_bytes,
                        "total_bytes": existing_bytes,
                        "speed_bytes_sec": 0,
                        "status": "completed",
                    }),
                );
            }
        }

        // Trigger next queued download!
        Self::spawn_check_next(storage, tokens, progress, client, app);
    }
}
