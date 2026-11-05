import React from "react";
import { Play, X } from "lucide-react";
import type { WatchProgress } from "../types";
import { playHoverSound } from "../services/sound";

interface ContinueWatchingCardProps {
  item: WatchProgress;
  onResume: (item: WatchProgress) => void;
  onRemove: (mediaId: string) => void;
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const ContinueWatchingCard: React.FC<ContinueWatchingCardProps> = React.memo(({
  item,
  onResume,
  onRemove,
}) => {
  const progressPercent =
    item.duration_sec > 0
      ? Math.min(100, Math.max(0, (item.position_sec / item.duration_sec) * 100))
      : 0;

  const episodeBadge =
    item.season !== null && item.episode !== null
      ? `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`
      : "Фільм";

  return (
    <div
      onMouseEnter={playHoverSound}
      className="group relative flex-shrink-0 w-64 cursor-pointer select-none [contain:layout_style]"
    >
      <div
        onClick={() => onResume(item)}
        className="relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 shadow-md transition-transform duration-200 ease-out transform-gpu group-hover:scale-[1.03] group-hover:border-rose-500/50"
      >
        <img
          src={item.poster_url}
          alt={item.title}
          draggable={false}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover pointer-events-none select-none"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22320%22%20height%3D%22180%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22%2318181b%22%20width%3D%22320%22%20height%3D%22180%22%2F%3E%3Ctext%20fill%3D%22%2371717a%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3ERDX%3C%2Ftext%3E%3C%2Fsvg%3E";
          }}
        />

        {/* Gradient shadow */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/40 pointer-events-none" />

        {/* Top Badges */}
        <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
          <span className="bg-rose-600/95 text-white font-bold text-xs px-2 py-0.5 rounded-md border border-rose-400/30 shadow-sm">
            {episodeBadge}
          </span>
        </div>

        {/* Remove Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.media_id);
          }}
          title="Видалити з продовження перегляду"
          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-zinc-950/90 hover:bg-rose-600 text-zinc-300 hover:text-white flex items-center justify-center border border-white/10 transition-opacity duration-150 opacity-0 group-hover:opacity-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Center Resume Play Button on Hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg pointer-events-auto hover:bg-rose-500 hover:scale-110 active:scale-95 transition-transform duration-150">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </div>
        </div>

        {/* Bottom Time & Translator */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-medium text-zinc-300 z-10 pointer-events-none">
          <span className="truncate max-w-[120px] text-zinc-300">
            {item.translator_name || "Стандартне"}
          </span>
          <span className="font-mono text-zinc-400">
            {formatDuration(item.position_sec)} / {formatDuration(item.duration_sec)}
          </span>
        </div>

        {/* Progress Bar at the bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800/90 overflow-hidden pointer-events-none">
          <div
            className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-400"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 px-1">
        <h4 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-rose-400 transition-colors duration-150">
          {item.title}
        </h4>
      </div>
    </div>
  );
});
