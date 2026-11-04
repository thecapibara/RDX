# RDX — Implementation Roadmap & Task Tracker

> This file tracks implementation progress across sessions, subagents, and models. Always update checkboxes `[x]` as tasks are completed and verified.

## Phase 1: Project Scaffolding & Core Infrastructure
- [x] **1.1. Tauri v2 + React + TypeScript + Tailwind + Framer Motion Initialization**
  - Initialize Vite + React + TS frontend and `src-tauri` Rust workspace.
  - Generate cross-platform app icons (`.icns`, `.ico`, `.png`) from `assets/icon-preview.jpg`.
- [x] **1.2. Local SQLite Storage (`src-tauri/src/storage/`)**
  - Tables: `settings` (active mirror, proxy, preferred quality/translator), `watch_progress`, `bookmarks`.
  - Tauri commands: `get_settings`, `update_settings`, `save_watch_progress`, `get_watch_progress`, `get_continue_watching`, `toggle_bookmark`, `get_bookmarks`.

## Phase 2: Mirror Manager, Anti-Bot HTTP Client & Captcha Bridge
- [x] **2.1. Mirror Manager (`src-tauri/src/mirror/`)**
  - Default mirror `https://rezka-tv.org/` + preset list + user-defined custom mirrors.
  - Health & latency checker (`check_mirror_status`: measures ms ping, detects ISP block vs Cloudflare/Captcha challenge vs OK).
- [x] **2.2. Anti-Bot Session & Captcha Bridge (`src-tauri/src/client/`)**
  - Persistent cookie store on disk (`cookies.json`) shared across restarts.
  - Autonomous Anubis PoW challenge solver with 30-day JWT authentication cookie preservation.
  - `open_captcha_window` Tauri command: spawns an interactive WebView to the active mirror when a robot check is triggered, syncs solved cookies back into the Rust `reqwest` client.

## Phase 3: HDRezka Scraper & Stream Decryptor (`src-tauri/src/parser/`)
- [x] **3.1. Catalog & Search Scraper**
  - Parse Home page sections (Featured/Trending, Movies, Series, Cartoons, Anime).
  - Search endpoint (`/search/?do=search&subaction=search&q=...`) and live autocomplete.
  - HDRezka Category Sort Filters (`?filter=last`, `popular`, `watching`, `soon`) and full Genre directory mapping (`/{category}/{genre}/`) translated into Ukrainian.
- [x] **3.2. Media Details & Translators Parser**
  - Extract full backdrop/poster, description, IMDb/KP ratings, year, genres, cast, translator list (`data-translator_id`), and seasons/episodes matrix.
- [x] **3.3. Stream Extractor & `#h` Decryptor**
  - Call `/ajax/get_cdn_series/` for movies (`get_movie`) and series (`get_episodes`, `get_stream`).
  - Deobfuscate HDRezka `#h` stream payload into clean quality->URL maps (`360p`..`4K` HLS `.m3u8` / `.mp4`) and subtitle tracks.
  - Unit tests for `#h` stream decryption, HTML parsing, and live integration test against `https://rezka-tv.org/`.

## Phase 4: Android TV UI & Smooth Animations (`src/`)
- [x] **4.1. App Shell & Navigation**
  - Top Android TV glassmorphic navigation bar (`Пошук`, `Головна`, `Фільми`, `Серіали`, `Мультфільми`, `Аніме`, `Закладки`) + Mirror status pill + TV clock & date + Settings modal.
  - Spatial keyboard navigation (`Arrow` keys, `Enter`, `Escape`, `Space`) + mouse/scroll interactions.
- [x] **4.2. Dynamic Hero Banner & Swimlane Carousels**
  - Full-bleed ambient backdrop with smooth crossfade (`AnimatePresence`), metadata badges, and action buttons.
  - **"Продовжити перегляд" (Play Next)** swimlane with episode progress bars (`S01E03 • 24:10 / 48:00`), 1-click resume, and remove button.
  - Category horizontal carousels with smooth scroll controls and hover/focus card expansion.
- [x] **4.3. Media Detail Modal / View**
  - Cinematic detail view with translator (voiceover) selector highlighting Ukrainian dubbing (`🇺🇦`), season/episode grid with watched indicators, and instant playback button.
  - Ambient soft-focus blur (`blur-[12px] sm:blur-[18px]`, `scale-110`, `saturate-125`, `object-[center_20%] sm:object-[75%_20%]`) for backdrops eliminating stretched low-res poster pixelation and clashing text.
  - Responsive TopBar navigation with compact screen adaptive dropdown («Ще ▾»), preventing horizontal scrolling and tab clipping across all window sizes.

## Phase 5: Video Player & Always-on-Top Mini-Player
- [x] **5.1. Custom HLS/MP4 Cinema Player**
  - Custom OSD controls (timeline scrubbing, quality switcher keeping timestamp, audio translator switcher, subtitle switcher, next episode button).
  - Vayou-style right-click Context Menu (translators, seasons/episodes, quality, speed, aspect ratio, A-B loop, screenshot, stream info, sleep timer, window modes).
  - Custom interactive SeekBar with buffered progress bar, A-B loop shaded span and tick markers, and live hover time tooltip.
  - Clickable time display toggling remaining time (`-MM:SS`) vs elapsed time (`MM:SS`).
  - Extended keyboard shortcuts: `Shift + Arrow` (±30s), `KeyS` (screenshot), `KeyL` (A-B loop), `KeyI` (stream statistics overlay).
  - Auto-save progress every 5 seconds to SQLite.
- [x] **5.2. Dual Mini-Player (In-App & Always-on-Top OS Overlay)**
  - In-app docked mini-player when navigating back to the catalog during playback.
  - OS-level **Always-on-Top frameless Mini-Player** (`set_always_on_top(true)`, compact 16:9 floating window with drag-region and hover controls) + Web Picture-in-Picture toggle + MPV/VLC external player launcher.

## Phase 6: Smart Mirror Rotator, DoH Anti-Blocking & Player Polish
- [x] **6.1. Built-in DNS-over-HTTPS (DoH) Anti-Blocking & Smart Mirror Rotator (`src-tauri/src/client/`, `src-tauri/src/mirror/`)**
  - Universal DoH resolver (`https://1.1.1.1/dns-query`, `https://8.8.8.8/resolve`) bypassing ISP DNS spoofing (`127.0.0.1` / ISP block pages) via `reqwest::ClientBuilder::resolve`.
  - Parallel mirror health & catalog verification (`check_all_mirrors`, `smart_select_mirror`) with automatic startup failover and transparent URL mirror rewriting (`RezkaParser::rewrite_to_mirror`).
- [x] **6.2. MSE HLS Seeking, Quality Persistence & Premium Badges (`src/components/VideoPlayer.tsx`)**
  - Reliable `getEffectiveDuration()` + `Hls.Events.LEVEL_LOADED` total duration tracking + Pointer-captured SeekBar scrubbing.
  - Default `720p` quality, persistent user quality preference (`localStorage` + SQLite), and golden `<Crown />` badge for `1080p Ultra` / `2K` / `4K`.
- [x] **6.3. Smart TV Hero Carousel, Ambient Cinema Blur & Subpixel Artifact Fixes (`src/components/HeroBanner.tsx`, `src/App.tsx`)**
  - Multi-item dynamic rotating hero carousel with 8s timer, pause on hover, random start, and `< >` / indicator pill navigation.
  - Soft-focus ambient blur (`blur-[8px]` + `scale-108` + `saturate-115`) on full-bleed cover eliminating low-res thumbnail pixelation without performance overhead.
  - Fixed WebKitGTK Cairo subpixel dirty-rect pixel trails by migrating progress animation to GPU `transform: scaleX` with paint isolation.

## Phase 7: Linux Desktop Integration & Native MPRIS
- [x] **7.1. Native MPRIS Integration & WebKit Ghost Player Suppression (`src-tauri/src/mpris.rs`, `src-tauri/src/lib.rs`)**
  - Integrated `souvlaki` MPRIS service (`org.mpris.MediaPlayer2.rdx`) displaying media title, season/episode, translator, and poster art.
  - Suppressed phantom `localhost` player from WebKitGTK by isolating D-Bus for child web processes while keeping native Rust MPRIS intact.
  - Clean `MediaPlayback::Stopped` and metadata clearing when video is closed, removing player widget from Wayland/Niri panels.
- [ ] **7.2. MPRIS Interactive Controls & Position Scrubbing (TODO)**
  - Two-way binding for D-Bus `Play`, `Pause`, `PlayPause` toggle, `Seek`, and `SetPosition` commands from desktop widgets and media keys to HTML `<video>`.
- [ ] **7.3. Desktop Packaging & Icon Registration**
  - Wayland `app_id` desktop file and icon deployment for production builds (`.deb`, `.rpm`, `.AppImage`).

## Phase 8: Smart TV Settings, Startup Chime & v0.2.0 Polish
- [x] **8.1. Obsidian Crimson TV Settings Modal (`src/components/MirrorModal.tsx`)**
  - Revamped modal with 2-column sidebar navigation (Мережа, Відтворення, Вигляд, Про нас).
  - Fixed badge text wrap (`whitespace-nowrap` on `Rust + Tauri v2`).
  - Added author `justgl` and bumped project version to `v0.2.0`.
  - Added background document scroll-lock (`overflow: hidden` on body & html) and `onWheel` event isolation.
- [x] **8.2. Instant Boot Startup Chime (`public/startup.mp3`, `index.html`)**
  - Integrated `startup.mp3` playing immediately in `index.html` on first paint of `#rdx-splash`.
  - Tuned comfortable volume to ~55% (-5 dB) with settings toggle and sound preview button.
