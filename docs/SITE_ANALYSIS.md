# HDRezka Live Site Analysis (`https://rezka-tv.org/`)

> Date of probe: November 2026  
> Target Mirror: `https://rezka-tv.org/`  
> Purpose: Technical reference for Rust backend (`src-tauri/src/`) and React frontend (`src/`) in **RDX**.

---

## 1. Network & Anti-Bot Infrastructure

### 1.1 HTTP Headers & Server Identity
- **Server**: `nginx` (No Cloudflare headers like `cf-ray` or `Server: cloudflare` were present on `https://rezka-tv.org/`).
- **CMS**: DataLife Engine (DLE) based backend.
- **Cookies**:
  - `techaro.lol-anubis-cookie-verification-<salt>` (challenge verification ID)
  - `techaro.lol-anubis-auth-<salt>` (30-day JWT authentication token)
  - `PHPSESSID` (PHP session identifier)
  - `dle_user_token`, `dle_user_taken` (DLE session state)

### 1.2 Anti-Bot Mechanism: Anubis PoW (Proof-of-Work)
The mirror is protected by **Anubis v1.27.0** ([github.com/TecharoHQ/anubis](https://github.com/TecharoHQ/anubis)), an open-source client-side Proof-of-Work challenge system.

#### Challenge Lifecycle:
1. When visiting without auth cookie, the server responds with HTTP 200 containing:
   ```html
   <title>Проверяем, что вы не бот!</title>
   <script id="anubis_challenge" type="application/json">
   {
     "rules": {"algorithm": "fast", "difficulty": 2},
     "challenge": {
       "id": "01a19e08-...",
       "randomData": "<hex string>",
       "difficulty": 2
     }
   }
   </script>
   ```
   And sets cookie `techaro.lol-anubis-cookie-verification-<salt>=<challenge.id>`.

2. **PoW Algorithm**:
   - Computes `SHA256(challenge.randomData + nonce)` for integer nonces starting at 0.
   - For `difficulty = 2`, the first byte (2 hex nibbles) of the SHA-256 digest must be `0x00`.
   - On average, this requires **~256 hash iterations**, taking **< 1 ms** in native Rust/Python.

3. **Pass-Challenge Verification**:
   - The solved proof is sent via a GET request:
     ```
     GET /.within.website/x/cmd/anubis/api/pass-challenge?id=<id>&response=<hex_hash>&nonce=<nonce>&redir=<target_url>&elapsedTime=<ms>
     ```
   - Headers: standard `User-Agent` and `Cookie: techaro.lol-anubis-cookie-verification-...`.
   - The server validates the proof, responds with a 30-day JWT cookie `techaro.lol-anubis-auth-<salt>`, and redirects (`302` or `200`) to the target page.

> [!TIP]
> **Implication for RDX**: The Rust HTTP client (`src-tauri/src/client/`) can solve this Anubis PoW challenge autonomously in 1 ms without opening any WebView. The interactive Captcha Bridge window remains as a fallback for Cloudflare Turnstile or reCAPTCHA on other mirrors.

---

## 2. Catalog & Navigation Structure

### 2.1 Navigation URLs
| Section | URL Pattern | Description |
| :--- | :--- | :--- |
| **Головна** | `https://rezka-tv.org/` | Home page |
| **Фільми** | `/films/` | Full movies catalog |
| **Серіали** | `/series/` | TV series catalog |
| **Мультфільми** | `/cartoons/` | Animation / Cartoons |
| **Аніме** | `/animation/` | Anime catalog |
| **Новинки** | `/new/` | Newly added releases |
| **Підбірки** | `/collections/` | Themed collections |

### 2.2 Home Filters & Tabs
- Container: `ul.b-content__main_filters`
- Sub-filters:
  - `?filter=last` — Останні надходження (Latest)
  - `?filter=popular` — Популярні (Popular)
  - `?filter=soon` — В очікуванні (Upcoming)
  - `?filter=watching` — Зараз дивляться (Currently Watching)
- Type filter parameter (`genre`):
  - `genre=1` — Фільми
  - `genre=2` — Серіали
  - `genre=3` — Мультфільми
  - `genre=82` — Аніме

### 2.3 Pagination
- Container: `div.b-navigation`
- URL format: `/page/{num}/` (e.g. `/films/page/2/`, `/?filter=popular&page=3`)
- Pages list: `.b-navigation a` (number links) and `.b-navigation__next` (next page)

---

## 3. Search Engine

### 3.1 Live Instant Autocomplete
- **Endpoint**: `POST /engine/ajax/search.php`
- **Headers**: `X-Requested-With: XMLHttpRequest`, `Referer: https://rezka-tv.org/`
- **Form Data**: `q={search_query}`
- **Response**: HTML fragment containing:
  ```html
  <div class="b-search__live_section">
    <ul class="b-search__section_list">
      <li>
        <a href="{item_url}">
          <span class="enty">{Russian Title}</span>
          ({Original Title}, {Type}, {Year})
          <span class="rating"><i class="hd-tooltip rating-green-string">{Rating}</i></span>
        </a>
      </li>
    </ul>
  </div>
  ```

### 3.2 Full Search Page
- **URL**: `GET /search/?do=search&subaction=search&q={search_query}`
- Returns standard catalog card list matching `.b-content__inline_item`.

---

## 4. Media Card Selectors (Catalog & Search)

Each card in catalog views and search results is wrapped in `.b-content__inline_item`:

```html
<div class="b-content__inline_item" data-id="92807" data-url="/series/drama/92807-noktyurn-2026-latest.html">
  <div class="b-content__inline_item-cover">
    <a href="...">
      <img src="https://static.hdrezka.ac/..." alt="..." />
      <span class="cat series"><i class="entity">Сериал</i></span>
      <span class="info">1 сезон<br>2 серия</span>
    </a>
  </div>
  <div class="b-content__inline_item-link">
    <a href="...">Ноктюрн</a>
    <div class="misc">2026 - ..., США, Драмы</div>
  </div>
</div>
```

### Exact CSS Selectors:
| Field | CSS Selector | Notes |
| :--- | :--- | :--- |
| **Card Container** | `.b-content__inline_item` | `data-id` (ID), `data-url` (Path) |
| **Target URL** | `.b-content__inline_item-link > a` (or `data-url`) | Relative URL (e.g. `/films/...`) |
| **Title (RU)** | `.b-content__inline_item-link > a` | Text content |
| **Poster Image** | `.b-content__inline_item-cover img` | `src` attribute |
| **Entity / Type** | `.b-content__inline_item-cover .cat .entity` | "Фильм", "Сериал", "Мультфильм", "Аниме" |
| **Series Progress** | `.b-content__inline_item-cover .info` | e.g. "1 сезон 2 серия" (if series) |
| **Year / Country / Genres** | `.b-content__inline_item-link .misc` (or `div:nth-of-type(2)`) | Comma-separated metadata string |

---

## 5. Media Detail Page Selectors

### 5.1 Metadata
| Field | CSS Selector | Example Value |
| :--- | :--- | :--- |
| **Title (RU)** | `div.b-post__title > h1` or `.b-post__title` | `"Ноктюрн"` |
| **Original Title** | `div.b-post__origtitle` | `"Nocturne"` |
| **Poster (Normal)** | `div.b-sidecover img` | `src` attribute |
| **Poster (High-Res)** | `div.b-sidecover a` | `href` attribute |
| **IMDb Rating** | `.b-post__info_rates.imdb .bold` | `"7.5"` |
| **Kinopoisk Rating** | `.b-post__info_rates.kp .bold` | `"6.37"` |
| **Description** | `div.b-post__description_text` | Full synopsis |
| **Info Table** | `table.b-post__info tr` | Key-value rows (Director, Release Date, Age, Duration, Genres) |

### 5.2 Translators (Voice Acting Studios)
- Container: `ul#translators-list.b-translators__list`
- Items: `li .b-translator__item` or `li .b-translator__items`
- Attributes:
  - `data-translator_id` (e.g. `376`, `111`)
  - Studio name text (e.g. `"HDrezka Studio"`, `"Дубляж (18+)"`)
  - Language flag: `img[title]` (e.g. `"Украинский"`, `"Русский"`)
  - Active state: `.active` class

### 5.3 Seasons & Episodes (Series only)
- Seasons Tabs: `ul#simple-seasons-tabs.b-simple_seasons__list`
  - Item: `li.b-simple_season__item` or `a.b-simple_season__item` with `data-tab_id="{season_id}"`
- Episodes Tabs: `ul#simple-episodes-list-{season_id}.b-simple_episodes__list` or `ul#simple-episodes-tabs`
  - Item: `li.b-simple_episode__item` or `a.b-simple_episode__item`
  - Attributes: `data-id="{media_id}"`, `data-season_id="{season_id}"`, `data-episode_id="{episode_id}"`

---

## 6. Video Player & Stream Extraction

HDRezka uses an embedded **Playerjs** engine configured through custom JavaScript helpers (`sof.tv.initCDNMoviesEvents` / `sof.tv.initCDNSeriesEvents`).

### 6.1 Initial Stream Extraction (Embedded HTML)
On page load, the player parameters are embedded directly in an inline `<script>` tag:

```javascript
// Movies:
sof.tv.initCDNMoviesEvents(media_id, translator_id, is_camrip, is_ads, is_director, web_host, is_logged, is_fullmode, player_info);

// Series:
sof.tv.initCDNSeriesEvents(media_id, translator_id, season_id, episode_id, url, web_host, is_logged, is_fullmode, player_info, callback);
```

The `player_info` JSON parameter contains:
- `streams`: The Playerjs quality-stream string (see format below).
- `default_quality`: Default quality badge (e.g. `"480p"`, `"720p"`).
- `subtitle`: Subtitle file list or `false`.
- `thumbnails`: Scrubber thumbnail URL (e.g. `/ajax/get_cdn_tiles/...`).

### 6.2 Dynamic AJAX Streaming Endpoint (`/ajax/get_cdn_series/`)
When the user switches translator, season, or episode, the client executes a POST request:

- **URL**: `POST /ajax/get_cdn_series/?t={Date.now()}`
- **Headers**:
  - `Content-Type: application/x-www-form-urlencoded`
  - `X-Requested-With: XMLHttpRequest`
  - `Referer: {active_item_url}`
  - Cookie jar with Anubis & session cookies.

#### Actions:
1. **Fetch Series Episode Stream**:
   - Parameters:
     ```
     id = {media_id}
     translator_id = {translator_id}
     season = {season_id}
     episode = {episode_id}
     action = get_stream
     favs = 
     ```
   - JSON Response:
     ```json
     {
       "success": true,
       "url": "[360p]https://stream.voidboost.one/.../zrkms.mp4:hls:manifest.m3u8 or ...,[720p]...",
       "quality": "480p",
       "subtitle": false,
       "thumbnails": "/ajax/get_cdn_tiles/..."
     }
     ```

2. **Switch Translator on Series (Get Seasons & Episodes Matrix)**:
   - Parameters:
     ```
     id = {media_id}
     translator_id = {translator_id}
     action = get_episodes
     favs = 
     ```
   - JSON Response:
     ```json
     {
       "success": true,
       "seasons": "<li class=\"b-simple_season__item active\" data-tab_id=\"1\">Сезон 1</li>...",
       "episodes": "<ul id=\"simple-episodes-list-1\" class=\"b-simple_episodes__list clearfix\">...",
       "url": "[360p]...manifest.m3u8...",
       "quality": "480p"
     }
     ```

3. **Switch Translator on Movie**:
   - Parameters:
     ```
     id = {media_id}
     translator_id = {translator_id}
     is_camrip = 0
     is_ads = 0
     is_director = 0
     action = get_movie
     favs = 
     ```
   - JSON Response:
     ```json
     {
       "success": true,
       "url": "[360p]...",
       "quality": "720p",
       "subtitle": false
     }
     ```

### 6.3 Stream String Format & Voidboost CDN
The `url` field uses Playerjs multi-quality stream list syntax:
```
[360p]url1 or url2 or url3,[480p]url4 or url5,[720p]url6 or url7,[1080p]...
```

- **Qualities**:
  `[360p]`, `[480p]`, `[720p]`, `[1080p]`, `[<span class="pjs-prem-quality">1080p Ultra...</span>]`, `[2K]`, `[4K]`
- **Variants per quality** (separated by `" or "`):
  - Primary HLS stream: `https://stream.voidboost.one/<token>:<timestamp>:<sig>/.../zrkms.mp4:hls:manifest.m3u8`
  - Direct MP4 fallback: `https://stream.voidboost.one/<token>:<timestamp>:<sig>/.../zrkms.mp4`
- **Playback Compatibility**:
  - The master HLS manifest (`:hls:manifest.m3u8`) and `.ts` video segments return `HTTP 200` with `Content-Type: application/vnd.apple.mpegurl` / `video/mp2t`.
  - Can be fed directly into `hls.js` inside the RDX player.
  - No `#h` trash string decoding is needed for `rezka-tv.org` (plain URLs are provided directly in the JSON response).
