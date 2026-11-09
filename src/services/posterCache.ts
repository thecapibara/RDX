import { useState, useEffect } from "react";

type PosterListener = () => void;

// In-memory poster registry (seeded with localStorage if available)
const STORAGE_KEY = "rdx_poster_cache_v1";

function loadInitialCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function persistCacheDebounced(cache: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    // Keep only the most recent 500 entries to prevent localStorage bloat
    const entries = Object.entries(cache);
    const toSave = entries.length > 500 ? Object.fromEntries(entries.slice(-500)) : cache;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

let saveTimeout: any = null;
const cache: Record<string, string> = loadInitialCache();
const listeners = new Set<PosterListener>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn("Poster listener error:", e);
    }
  });
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => persistCacheDebounced(cache), 1500);
}

export const posterCache = {
  get: (mediaId: string): string | undefined => {
    if (!mediaId) return undefined;
    return cache[mediaId];
  },

  set: (mediaId: string, url: string | null | undefined) => {
    if (!mediaId || !url || typeof url !== "string") return;
    if (cache[mediaId] === url) return;
    cache[mediaId] = url;
    notify();
  },

  setMany: (entries: Record<string, string>) => {
    let changed = false;
    for (const [id, url] of Object.entries(entries)) {
      if (id && url && cache[id] !== url) {
        cache[id] = url;
        changed = true;
      }
    }
    if (changed) {
      notify();
    }
  },

  subscribe: (listener: PosterListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * React hook that returns high-resolution poster if known,
 * or dynamically updates when the high-res poster is discovered.
 */
export function usePoster(mediaId: string | undefined | null, fallbackUrl: string): string {
  const [posterUrl, setPosterUrl] = useState(() => {
    if (mediaId && cache[mediaId]) {
      return cache[mediaId];
    }
    return fallbackUrl;
  });

  useEffect(() => {
    if (!mediaId) {
      setPosterUrl(fallbackUrl);
      return;
    }

    const currentCached = cache[mediaId];
    if (currentCached && currentCached !== posterUrl) {
      setPosterUrl(currentCached);
    } else if (!currentCached && fallbackUrl !== posterUrl) {
      setPosterUrl(fallbackUrl);
    }

    const unsub = posterCache.subscribe(() => {
      const updated = cache[mediaId];
      if (updated && updated !== posterUrl) {
        setPosterUrl(updated);
      }
    });

    return unsub;
  }, [mediaId, fallbackUrl, posterUrl]);

  return posterUrl || fallbackUrl;
}
