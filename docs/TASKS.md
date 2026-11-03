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
