# RDX — Desktop Streaming Client (Rust + Tauri v2)

## Project Overview
**RDX** is a cross-platform desktop streaming application (Windows, Linux, macOS) built with **Rust (Tauri v2)** and a modern **Android TV / Smart TV** inspired interface (like Spotify Desktop meets Apple TV / Google TV). It serves as a native-feeling client for HDRezka (`https://rezka-tv.org/` and configurable mirrors).

Always read [`docs/SPEC.md`](docs/SPEC.md) for full architecture, feature specifications, and the current implementation roadmap.

## Tech Stack
- **Core / Backend**: Rust (Tauri v2), `reqwest` (with cookie store & custom headers/TLS), `scraper` (HTML parsing), `rusqlite` / `sqlx` (local SQLite state).
- **Frontend / UI**: React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion (smooth 60fps TV-style animations, focus/hover spatial navigation, ambient hero backdrops) + Lucide Icons.
- **Video Player**: `hls.js` + custom Android TV OSD overlay + Dual Mini-Player support (Tauri Always-on-Top frameless PiP window & Web PiP).
- **Target Platforms**: Linux, Windows, macOS.

## Core Modules (Rust Backend `src-tauri/src/`)
1. `mirror/` — **Mirror Manager**: dynamic base URL switching (default `https://rezka-tv.org/`, presets + custom URLs), health/latency checker, persistent mirror config.
2. `client/` — **HTTP & Anti-Bot Session**: persistent User-Agent + Cookie jar (`cf_clearance`, `dle_user_id`, `PHPSESSID`). Includes an on-demand **Captcha Bridge Window** (opens a Tauri WebView to the active mirror when Cloudflare/reCAPTCHA triggers, extracts solved cookies back to Rust).
3. `parser/` — **HDRezka Scraper & Stream Decryptor**:
   - Home rows (Trending, Continue Watching, Movies, Series, Cartoons, Anime), Search, Catalog filters, Media Details.
   - AJAX endpoints (`/ajax/get_cdn_series/`) and `#h` stream URL deobfuscation (`bk0..bk4` trash string stripping + Base64 decoding).
4. `storage/` — **Local SQLite Database**:
   - Watch progress (`media_id`, `translator_id`, `season`, `episode`, `position_sec`, `duration_sec`, `updated_at`).
   - Bookmarks / Favorites & Mirror settings.
5. `window/` — **Mini-Player & Window Controller**:
   - Switches main window into a compact Always-on-Top frameless PiP window or spawns a dedicated PiP overlay window across workspaces.

## Workflow & Multi-Agent Continuity Rules
- **Single Source of Truth**: Keep [`docs/SPEC.md`](docs/SPEC.md) and [`docs/TASKS.md`](docs/TASKS.md) updated after completing each milestone so any new session, subagent, or model switch has full context immediately.
- **Verification**: Always verify Rust changes with `cargo check` / `cargo test` inside `src-tauri` and frontend changes with `npm run build` before marking a task complete.
