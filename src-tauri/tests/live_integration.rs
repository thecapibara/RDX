use std::sync::Arc;
use rdx_lib::client::{HttpClient, PersistentCookieStore};
use rdx_lib::mirror::MirrorManager;
use rdx_lib::parser::RezkaParser;
use rdx_lib::storage::Storage;

#[tokio::test]
async fn test_live_mirror_and_catalog() {
    let cookie_store = Arc::new(PersistentCookieStore::in_memory());
    let client = HttpClient::new(cookie_store.clone(), None).expect("client creation");

    let mirror_url = "https://rezka-tv.org";
    let status = MirrorManager::check_mirror_status(&client, mirror_url).await;
    println!("Mirror check status: {:?}", status);
    assert!(status.online, "Expected mirror to be online");

    // Fetch live home catalog items
    let catalog = RezkaParser::get_home_catalog(&client, mirror_url, Some("last"), None, Some(1))
        .await
        .expect("fetch catalog");

    println!("Successfully parsed {} items from live catalog!", catalog.len());
    assert!(!catalog.is_empty(), "Expected at least 1 catalog item");

    let first = &catalog[0];
    println!(
        "First item: id={}, title='{}', url='{}', entity_type='{}'",
        first.id, first.title, first.url, first.entity_type
    );
    assert!(!first.id.is_empty());
    assert!(!first.title.is_empty());
    assert!(!first.url.is_empty());
}

#[tokio::test]
async fn test_storage_lifecycle_in_test() {
    let storage = Storage::in_memory().expect("in memory");
    let settings = storage.get_settings().expect("settings");
    assert_eq!(settings.active_mirror, "https://hdrezka.me");
    assert_eq!(settings.custom_mirrors.len(), 3);
}


