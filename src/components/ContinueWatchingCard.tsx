import React from "react";
import { Play, X } from "lucide-react";
import type { WatchProgress } from "../types";

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

export const ContinueWatchingCard: React.FC<ContinueWatchingCardProps> = ({
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
    <div className="group relative flex-shrink-0 w-64 cursor-pointer select-none">
      <div
        onClick={() => onResume(item)}
        className="relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:border-rose-500/50 group-hover:shadow-[0_0_25px_rgba(225,29,72,0.3)]"
      >
        <img
          src={item.poster_url}
          alt={item.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22320%22%20height%3D%22180%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22%2318181b%22%20width%3D%22320%22%20height%3D%22180%22%2F%3E%3Ctext%20fill%3D%22%2371717a%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3ERDX%3C%2Ftext%3E%3C%2Fsvg%3E";
          }}
        />

        {/* Gradient shadow */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/40" />

        {/* Top Badges */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <span className="bg-rose-600/90 text-white font-bold text-xs px-2 py-0.5 rounded-md border border-rose-400/30 shadow-md">
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
          className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-black/60 hover:bg-rose-600/90 text-zinc-300 hover:text-white flex items-center justify-center backdrop-blur-md border border-white/10 transition-all opacity-0 group-hover:opacity-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Center Resume Play Button on Hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 z-10 pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-xl shadow-rose-950/60 backdrop-blur-sm pointer-events-auto hover:bg-rose-500 hover:scale-110 active:scale-95 transition-all">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </div>
        </div>

        {/* Bottom Time & Translator */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-medium text-zinc-300 z-10">
          <span className="truncate max-w-[120px] text-zinc-300">
            {item.translator_name || "Стандартне"}
          </span>
          <span className="font-mono text-zinc-400">
            {formatDuration(item.position_sec)} / {formatDuration(item.duration_sec)}
          </span>
        </div>

        {/* Glowing Progress Bar at the bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800/80 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-400 transition-all shadow-[0_0_8px_rgba(244,63,94,0.7)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 px-1">
        <h4 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-rose-400 transition-colors">
          {item.title}
        </h4>
      </div>
    </div>
  );
};
