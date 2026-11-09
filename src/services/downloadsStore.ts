import { useState, useEffect } from "react";
import type { DownloadItem } from "../types";

export interface ActiveMediaDownload {
  status: "downloading" | "queued" | "paused";
  progress: number; // 0..100
  activeCount: number; // number of episodes/items downloading or in queue
  isSeries: boolean;
}

type DownloadListener = () => void;

let downloadsMap: Record<string, ActiveMediaDownload> = {};
const listeners = new Set<DownloadListener>();

export const OPEN_DOWNLOADS_EVENT = "rdx:open-downloads";

export function openDownloadsTab() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_DOWNLOADS_EVENT));
  }
}

export const downloadsStore = {
  get: (mediaId: string): ActiveMediaDownload | undefined => {
    if (!mediaId) return undefined;
    return downloadsMap[mediaId];
  },

  getAll: (): Record<string, ActiveMediaDownload> => downloadsMap,

  updateFromItems: (items: DownloadItem[]) => {
    const nextMap: Record<string, ActiveMediaDownload> = {};

    // Filter items that are actively in progress
    const activeItems = items.filter(
      (item) =>
        item.status === "downloading" ||
        item.status === "queued" ||
        item.status === "paused"
    );

    // Group by media_id
    const grouped = new Map<string, DownloadItem[]>();
    for (const item of activeItems) {
      if (!item.media_id) continue;
      const list = grouped.get(item.media_id) || [];
      list.push(item);
      grouped.set(item.media_id, list);
    }

    for (const [mediaId, list] of grouped.entries()) {
      const hasDownloading = list.some((i) => i.status === "downloading");
      const hasQueued = list.some((i) => i.status === "queued");

      const status: "downloading" | "queued" | "paused" = hasDownloading
        ? "downloading"
        : hasQueued
        ? "queued"
        : "paused";

      // Calculate progress based on downloaded_bytes / total_bytes
      let progress = 0;
      const targetList = hasDownloading ? list.filter((i) => i.status === "downloading") : list;
      const validItems = targetList.filter((i) => i.total_bytes > 0);

      if (validItems.length > 0) {
        const totalTargetBytes = validItems.reduce((acc, cur) => acc + (cur.total_bytes || 0), 0);
        const downloadedTargetBytes = validItems.reduce((acc, cur) => acc + (cur.downloaded_bytes || 0), 0);
        if (totalTargetBytes > 0) {
          progress = Math.round((downloadedTargetBytes / totalTargetBytes) * 100);
        }
      } else {
        // Fallback if total_bytes not yet known (initial chunk handshake)
        progress = hasDownloading ? 1 : 0;
      }

      nextMap[mediaId] = {
        status,
        progress: Math.min(100, Math.max(0, progress)),
        activeCount: list.length,
        isSeries: list.some((i) => (i.season || 0) > 0 || (i.episode || 0) > 0),
      };
    }

    downloadsMap = nextMap;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.warn("Download listener error:", e);
      }
    });
  },

  subscribe: (listener: DownloadListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * React hook to get download status for a media card
 */
export function useMediaDownload(mediaId: string | undefined | null): ActiveMediaDownload | undefined {
  const [info, setInfo] = useState<ActiveMediaDownload | undefined>(() =>
    mediaId ? downloadsStore.get(mediaId) : undefined
  );

  useEffect(() => {
    if (!mediaId) {
      setInfo(undefined);
      return;
    }

    setInfo(downloadsStore.get(mediaId));

    const unsub = downloadsStore.subscribe(() => {
      setInfo(downloadsStore.get(mediaId));
    });

    return unsub;
  }, [mediaId]);

  return info;
}
