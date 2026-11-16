import { useState, useEffect } from "react";
import { api } from "./api";

export interface LocalizedCardMeta {
  title: string | null;
  poster: string | null;
}

export interface LocalizationQuery {
  id: string;
  title: string;
  orig_title?: string | null;
  year?: string | null;
  media_type?: "movie" | "tv" | null;
}

const MAX_MEM_CACHE = 600;
const memoryCache = new Map<string, LocalizedCardMeta>();
const pendingQueries = new Map<string, LocalizationQuery>();
const listeners = new Map<string, Set<(meta: LocalizedCardMeta) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushQueue() {
  flushTimer = null;
  if (pendingQueries.size === 0) return;

  const allItems = Array.from(pendingQueries.values());
  pendingQueries.clear();

  // Process in chunks of 25 (matching backend limit)
  for (let i = 0; i < allItems.length; i += 25) {
    const chunk = allItems.slice(i, i + 25);
    const resultMap = await api.localizeMediaCards(chunk);

    for (const q of chunk) {
      const resolved: LocalizedCardMeta = resultMap[q.id] || { title: null, poster: null };
      if (memoryCache.size >= MAX_MEM_CACHE) {
        const firstKey = memoryCache.keys().next().value;
        if (firstKey !== undefined) memoryCache.delete(firstKey);
      }
      memoryCache.set(q.id, resolved);

      const subs = listeners.get(q.id);
      if (subs) {
        subs.forEach((cb) => cb(resolved));
      }
    }
  }
}

function scheduleLocalization(query: LocalizationQuery) {
  if (!query.id || !query.title) return;
  if (memoryCache.has(query.id) || pendingQueries.has(query.id)) return;

  pendingQueries.set(query.id, query);
  if (!flushTimer) {
    flushTimer = setTimeout(flushQueue, 40);
  }
}

export function useCardLocalization(query: LocalizationQuery | null): LocalizedCardMeta | null {
  const id = query?.id || "";
  const [meta, setMeta] = useState<LocalizedCardMeta | null>(() =>
    id ? memoryCache.get(id) ?? null : null
  );

  useEffect(() => {
    if (!query || !query.id || !query.title) return;

    const cached = memoryCache.get(query.id);
    if (cached) {
      setMeta(cached);
      return;
    }

    let subs = listeners.get(query.id);
    if (!subs) {
      subs = new Set();
      listeners.set(query.id, subs);
    }
    subs.add(setMeta);
    scheduleLocalization(query);

    return () => {
      subs?.delete(setMeta);
      if (subs && subs.size === 0) {
        listeners.delete(query.id);
      }
    };
  }, [query?.id, query?.title, query?.orig_title, query?.year, query?.media_type]);

  return meta;
}
