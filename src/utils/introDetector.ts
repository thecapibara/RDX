/**
 * RDX Labs — Smart Intro / Opening Detector (Zero External Dependency)
 *
 * Works in two complementary ways:
 * 1. Automatic WebVTT Sprite Perceptual Hashing (64-bit dHash):
 *    Hashes thumbnail cues in the first 7 minutes of the current episode onto a 9x8
 *    offscreen canvas (< 4ms total), caches compact signatures per episode, and compares
 *    against any cached or neighbor episode in the same season to locate shared opening
 *    sequences (25s .. 130s, even after cold opens!).
 * 2. Manual 1-Click Season Memory:
 *    Users can mark or adjust intro start/end once on Episode 1 and RDX remembers it
 *    for the entire season.
 */

import { api } from "../services/api";

export interface IntroCueInput {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IntroSegment {
  start: number;
  end: number;
  source: "auto" | "manual";
}

interface CueHashEntry {
  s: number; // start sec
  e: number; // end sec
  h1: number; // upper 32 bits of dHash
  h2: number; // lower 32 bits of dHash
}

const SEASON_INTRO_STORAGE_KEY = "rdx_labs_season_intros_v1";
const EPISODE_HASH_PREFIX = "rdx_labs_ep_dhash_v1:";
const MAX_SCAN_SEC = 450; // Scan first 7.5 minutes (covers cold open + 90s anime/series OP)
const MIN_INTRO_DURATION_SEC = 24;
const MAX_INTRO_DURATION_SEC = 135;

function seasonKey(mediaId: string, season: number): string {
  return `${mediaId}:s${season}`;
}

function episodeHashKey(mediaId: string, season: number, episode: number): string {
  return `${EPISODE_HASH_PREFIX}${mediaId}:s${season}:e${episode}`;
}

export function getSavedSeasonIntro(mediaId: string, season: number): IntroSegment | null {
  try {
    const raw = localStorage.getItem(SEASON_INTRO_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, IntroSegment>;
    const seg = map[seasonKey(mediaId, season)];
    if (
      seg &&
      Number.isFinite(seg.start) &&
      Number.isFinite(seg.end) &&
      seg.end - seg.start >= 10
    ) {
      return seg;
    }
  } catch {}
  return null;
}

export function saveSeasonIntro(
  mediaId: string,
  season: number,
  segment: IntroSegment
): void {
  try {
    const raw = localStorage.getItem(SEASON_INTRO_STORAGE_KEY);
    const map: Record<string, IntroSegment> = raw ? JSON.parse(raw) : {};
    map[seasonKey(mediaId, season)] = {
      start: Math.max(0, Math.round(segment.start)),
      end: Math.round(segment.end),
      source: segment.source,
    };
    localStorage.setItem(SEASON_INTRO_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function clearSeasonIntro(mediaId: string, season: number): void {
  try {
    const raw = localStorage.getItem(SEASON_INTRO_STORAGE_KEY);
    if (!raw) return;
    const map: Record<string, IntroSegment> = JSON.parse(raw);
    delete map[seasonKey(mediaId, season)];
    localStorage.setItem(SEASON_INTRO_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

function popcount32(x: number): number {
  let n = x >>> 0;
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hammingDistance64(a1: number, a2: number, b1: number, b2: number): number {
  return popcount32(a1 ^ b1) + popcount32(a2 ^ b2);
}

function parseVttCuesMinimal(vttText: string, baseUrl: string): IntroCueInput[] {
  const cues: IntroCueInput[] = [];
  const lines = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let start = -1;
  let end = -1;

  const parseSec = (str: string): number => {
    const parts = str.trim().split(":");
    if (parts.length === 3) {
      return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
    }
    if (parts.length === 2) {
      return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
    }
    return 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE")) continue;
    if (line.includes("-->")) {
      const [sStr, eStr] = line.split("-->").map((p) => p.trim().split(" ")[0]);
      if (sStr && eStr) {
        start = parseSec(sStr);
        end = parseSec(eStr);
      }
      continue;
    }
    if (start >= 0 && end > start) {
      if (start <= MAX_SCAN_SEC) {
        let cueUrl = line;
        let x = 0, y = 0, w = 160, h = 90;
        const idx = cueUrl.indexOf("#xywh=");
        if (idx !== -1) {
          const coords = cueUrl.slice(idx + 6).split(",").map((v) => parseInt(v, 10));
          cueUrl = cueUrl.slice(0, idx);
          if (!Number.isNaN(coords[0])) x = coords[0];
          if (!Number.isNaN(coords[1])) y = coords[1];
          if (!Number.isNaN(coords[2])) w = coords[2];
          if (!Number.isNaN(coords[3])) h = coords[3];
        }
        try {
          if (!cueUrl.startsWith("http://") && !cueUrl.startsWith("https://") && !cueUrl.startsWith("data:")) {
            cueUrl = new URL(cueUrl, baseUrl).href;
          }
        } catch {}
        cues.push({ start, end, url: cueUrl, x, y, w, h });
      }
      start = -1;
      end = -1;
    }
  }
  return cues;
}

function loadSpriteImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Sprite load failed"));
    img.src = url;
  });
}

async function computeEpisodeCueHashes(cues: IntroCueInput[]): Promise<CueHashEntry[]> {
  const earlyCues = cues.filter((c) => c.start <= MAX_SCAN_SEC && c.w > 8 && c.h > 8);
  if (earlyCues.length < 6) return [];

  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  const spriteCache = new Map<string, HTMLImageElement>();
  const results: CueHashEntry[] = [];

  for (const cue of earlyCues) {
    let img = spriteCache.get(cue.url);
    if (!img) {
      try {
        img = await loadSpriteImage(cue.url);
        spriteCache.set(cue.url, img);
      } catch {
        break; // CORS or network blocked sprite
      }
    }

    try {
      ctx.drawImage(img, cue.x, cue.y, cue.w, cue.h, 0, 0, 9, 8);
      const data = ctx.getImageData(0, 0, 9, 8).data;

      // Skip near-uniform black/fade cues so black screens don't false-match
      let minL = 255;
      let maxL = 0;
      const gray = new Float32Array(72);
      for (let i = 0; i < 72; i++) {
        const p = i * 4;
        const l = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
        gray[i] = l;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
      }
      if (maxL - minL < 14) {
        continue;
      }

      let h1 = 0;
      let h2 = 0;
      let bitIdx = 0;
      for (let row = 0; row < 8; row++) {
        const rowBase = row * 9;
        for (let col = 0; col < 8; col++) {
          const bit = gray[rowBase + col] > gray[rowBase + col + 1] ? 1 : 0;
          if (bitIdx < 32) {
            h1 = (h1 | (bit << bitIdx)) >>> 0;
          } else {
            h2 = (h2 | (bit << (bitIdx - 32))) >>> 0;
          }
          bitIdx++;
        }
      }

      results.push({
        s: Math.round(cue.start),
        e: Math.round(cue.end),
        h1,
        h2,
      });
    } catch {
      break;
    }
  }

  canvas.width = 0;
  canvas.height = 0;
  return results;
}

function getCachedEpisodeHashes(
  mediaId: string,
  season: number,
  episode: number
): CueHashEntry[] | null {
  try {
    const raw = localStorage.getItem(episodeHashKey(mediaId, season, episode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length >= 6) return parsed;
  } catch {}
  return null;
}

function setCachedEpisodeHashes(
  mediaId: string,
  season: number,
  episode: number,
  hashes: CueHashEntry[]
): void {
  if (hashes.length < 6) return;
  try {
    localStorage.setItem(episodeHashKey(mediaId, season, episode), JSON.stringify(hashes));
  } catch {}
}

/**
 * Finds the longest matching visual sequence between current episode hashes `curr`
 * and reference episode hashes `other` (supports cold opens where start times differ!).
 */
function matchIntroBetweenEpisodes(
  curr: CueHashEntry[],
  other: CueHashEntry[]
): IntroSegment | null {
  let bestStart = -1;
  let bestEnd = -1;
  let bestDuration = 0;

  for (let i = 0; i < curr.length; i++) {
    for (let j = 0; j < other.length; j++) {
      // Intros in two episodes of the same season usually start within 4 minutes of each other
      if (Math.abs(curr[i].s - other[j].s) > 240) continue;
      if (hammingDistance64(curr[i].h1, curr[i].h2, other[j].h1, other[j].h2) > 11) {
        continue;
      }

      let ci = i;
      let oj = j;
      let misses = 0;
      let matchedFrames = 0;
      let lastMatchedCi = i;

      while (ci < curr.length && oj < other.length) {
        const dist = hammingDistance64(
          curr[ci].h1,
          curr[ci].h2,
          other[oj].h1,
          other[oj].h2
        );
        if (dist <= 12) {
          matchedFrames++;
          lastMatchedCi = ci;
          misses = 0;
        } else {
          misses++;
          // Allow 1 brief title-card difference inside an opening sequence
          if (misses > 2) break;
        }
        ci++;
        oj++;
      }

      const segStart = curr[i].s;
      const segEnd = curr[lastMatchedCi].e;
      const duration = segEnd - segStart;

      if (
        matchedFrames >= 5 &&
        duration >= MIN_INTRO_DURATION_SEC &&
        duration <= MAX_INTRO_DURATION_SEC &&
        duration > bestDuration
      ) {
        bestDuration = duration;
        bestStart = segStart;
        bestEnd = segEnd;
      }
    }
  }

  if (bestStart >= 0 && bestEnd > bestStart) {
    return { start: bestStart, end: bestEnd, source: "auto" };
  }
  return null;
}

export async function detectSeriesIntro(params: {
  mediaId: string;
  mediaUrl: string;
  season: number;
  episode: number;
  translatorId?: string;
  availableEpisodesInSeason: number[];
  currentCues: IntroCueInput[];
}): Promise<IntroSegment | null> {
  const {
    mediaId,
    mediaUrl,
    season,
    episode,
    translatorId,
    availableEpisodesInSeason,
    currentCues,
  } = params;

  // 1. Manual override always wins immediately
  const saved = getSavedSeasonIntro(mediaId, season);
  if (saved && saved.source === "manual") {
    return saved;
  }

  if (currentCues.length < 6) {
    return saved;
  }

  // 2. Hash current episode's early cues (or read from cache)
  let currHashes = getCachedEpisodeHashes(mediaId, season, episode);
  if (!currHashes) {
    currHashes = await computeEpisodeCueHashes(currentCues);
    setCachedEpisodeHashes(mediaId, season, episode, currHashes);
  }
  if (currHashes.length < 6) {
    return saved;
  }

  // 3. Try matching against any already-cached sibling episode of this season first (0 network requests!)
  const otherEpisodes = availableEpisodesInSeason.filter((ep) => ep !== episode);
  for (const candEp of otherEpisodes) {
    const cachedOther = getCachedEpisodeHashes(mediaId, season, candEp);
    if (cachedOther && cachedOther.length >= 6) {
      const match = matchIntroBetweenEpisodes(currHashes, cachedOther);
      if (match) return match;
    }
  }

  // 4. If no sibling episode is cached yet, softly fetch ONE neighbor episode's VTT thumbnails
  const neighborEp =
    otherEpisodes.find((ep) => ep === episode - 1) ??
    otherEpisodes.find((ep) => ep === episode + 1) ??
    otherEpisodes[0];

  if (neighborEp === undefined) {
    return saved;
  }

  try {
    const neighborStream = await api.getStream(
      mediaId,
      mediaUrl,
      true,
      translatorId,
      season,
      neighborEp
    );
    if (!neighborStream?.thumbnails) {
      return saved;
    }
    const resp = await fetch(neighborStream.thumbnails);
    const vttText = await resp.text();
    const neighborCues = parseVttCuesMinimal(vttText, neighborStream.thumbnails);
    const neighborHashes = await computeEpisodeCueHashes(neighborCues);
    if (neighborHashes.length >= 6) {
      setCachedEpisodeHashes(mediaId, season, neighborEp, neighborHashes);
      const match = matchIntroBetweenEpisodes(currHashes, neighborHashes);
      if (match) {
        saveSeasonIntro(mediaId, season, match);
        return match;
      }
    }
  } catch {
    // Network or CORS unavailable — fall back silently
  }

  return saved;
}
