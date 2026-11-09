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

#[tokio::test]
async fn test_dexter_and_spiderman_probe() {
    use std::time::Instant;

    let cookie_store = Arc::new(PersistentCookieStore::in_memory());
    let client = HttpClient::new(cookie_store.clone(), None).expect("client creation");

    let mirror_url = "https://rezka.ag";

    // 1. ensure_host_resolved
    let t0 = Instant::now();
    let host = mirror_url.trim_start_matches("https://").trim_start_matches("http://");
    client.ensure_host_resolved(host).await;
    let d_dns = t0.elapsed();
    println!("=== PROBE TIMINGS ===");
    println!("ensure_host_resolved for {}: {:?}", host, d_dns);

    // 2. Dexter details
    let t_details = Instant::now();
    let dexter_details = RezkaParser::get_media_details(
        &client,
        "https://rezka.ag/series/thriller/1743-dekster-2006-latest.html",
        "https://rezka.ag"
    ).await;
    println!("Dexter get_media_details took: {:?}", t_details.elapsed());
    if let Err(ref e) = dexter_details {
        println!("Dexter details error: {:?}", e);
    }
    let dexter_details = dexter_details.expect("dexter details");

    // 3. Dexter episodes
    let t_episodes = Instant::now();
    let _dexter_episodes = RezkaParser::get_episodes(
        &client,
        mirror_url,
        "1743",
        "359",
        &dexter_details.url
    ).await;
    println!("Dexter get_episodes took: {:?}", t_episodes.elapsed());

    // 4. Dexter stream S1E3 translator 359
    let t_stream = Instant::now();
    let dexter_stream = RezkaParser::get_stream(
        &client,
        mirror_url,
        "1743",
        Some("359"),
        Some(1),
        Some(3),
        true,
        &dexter_details.url
    ).await;
    println!("Dexter get_stream took: {:?}", t_stream.elapsed());
    match dexter_stream {
        Ok(s) => {
            println!("Dexter stream qualities count: {}", s.qualities.len());
            for q in &s.qualities {
                println!("  Dexter Quality {}: mp4={:?}, hls={:?}", q.label, q.mp4_url, q.hls_url);
            }
        }
        Err(e) => println!("Dexter stream ERROR: {:?}", e),
    }

    // 5. Spider-Man 87789 translator 358
    let t_sm_details = Instant::now();
    let sm_details = RezkaParser::get_media_details(
        &client,
        "https://rezka.ag/films/fiction/87789-chelovek-pauk-novyy-den-2026-latest.html",
        "https://rezka.ag"
    ).await;
    println!("Spider-Man get_media_details took: {:?}", t_sm_details.elapsed());
    let sm_details = sm_details.expect("sm details");

    let t_sm_stream = Instant::now();
    let sm_stream = RezkaParser::get_stream(
        &client,
        mirror_url,
        "87789",
        Some("358"),
        None,
        None,
        false,
        &sm_details.url
    ).await;
    println!("Spider-Man get_stream took: {:?}", t_sm_stream.elapsed());
    match sm_stream {
        Ok(s) => {
            println!("Spider-Man stream qualities count: {}", s.qualities.len());
            for q in &s.qualities {
                println!("  Spider-Man Quality {}: mp4={:?}, hls={:?}", q.label, q.mp4_url, q.hls_url);
            }
        }
        Err(e) => println!("Spider-Man stream ERROR: {:?}", e),
    }
}



