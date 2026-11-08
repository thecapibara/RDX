use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

use crate::storage::{DownloadItem, Storage};

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

pub struct DownloadManager {
    storage: Arc<Storage>,
    active_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    client: reqwest::Client,
}

impl DownloadManager {
    pub fn new(storage: Arc<Storage>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            storage,
            active_tokens: Arc::new(Mutex::new(HashMap::new())),
            client,
        }
    }

    pub async fn start_download(
        &self,
        item: DownloadItem,
        app: AppHandle,
    ) -> Result<DownloadItem, String> {
        let id = item.id.clone();

        // 1. Save or update record in database as queued/downloading
        let mut initial_item = item.clone();
        initial_item.status = "downloading".to_string();
        initial_item.error_message = None;

        self.storage
            .add_or_update_download(&initial_item)
            .map_err(|e| format!("DB error: {e}"))?;

        // 2. Set up cancellation / pause watch channel
        let (tx, rx) = watch::channel(false);
        {
            let mut guard = self.active_tokens.lock().unwrap();
            guard.insert(id.clone(), tx);
        }

        // 3. Spawn background download worker task
        let storage = self.storage.clone();
        let tokens = self.active_tokens.clone();
        let client = self.client.clone();

        tokio::spawn(async move {
            Self::run_download_task(initial_item, client, storage, tokens, rx, app).await;
        });

        Ok(item)
    }

    pub fn pause_download(&self, id: &str) -> Result<(), String> {
        let mut guard = self.active_tokens.lock().unwrap();
        if let Some(tx) = guard.remove(id) {
            let _ = tx.send(true);
        }

        let _ = self.storage.update_download_progress(
            id,
            0,
            0,
            "paused",
            None,
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

    pub async fn cancel_download(&self, id: &str) -> Result<(), String> {
        // Stop active task
        self.pause_download(id)?;

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

        Ok(())
    }

    pub async fn delete_download(&self, id: &str) -> Result<(), String> {
        self.pause_download(id).ok();

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

        Ok(())
    }

    async fn run_download_task(
        item: DownloadItem,
        client: reqwest::Client,
        storage: Arc<Storage>,
        tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
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
                return;
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

                    loop {
                        // Check if paused or cancelled by user
                        if *abort_rx.borrow() {
                            let _ = file.flush().await;
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
                            return;
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

                                // Update speed measurement every 500ms
                                let elapsed = speed_calc_time.elapsed();
                                if elapsed >= Duration::from_millis(500) {
                                    current_speed = (bytes_since_calc as f64
                                        / elapsed.as_secs_f64())
                                        as u64;
                                    speed_calc_time = Instant::now();
                                    bytes_since_calc = 0;

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

                                // Persist progress to SQLite every 3 seconds
                                if last_db_save.elapsed() >= Duration::from_secs(3) {
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

                    if stream_err {
                        if retry_count < MAX_RETRIES {
                            retry_count += 1;
                            tokio::time::sleep(Duration::from_secs(retry_count as u64 * 2)).await;
                            continue;
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

        // Cleanup active token
        {
            let mut guard = tokens.lock().unwrap();
            guard.remove(&id);
        }

        if success {
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
                return;
            }

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
}
