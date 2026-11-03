import React from "react";
import { Play, Star } from "lucide-react";
import type { MediaCard as MediaCardType } from "../types";
import { cn } from "../lib/utils";

interface MediaCardProps {
  card: MediaCardType;
  onSelect: (card: MediaCardType) => void;
  onPlayDirect?: (card: MediaCardType) => void;
  className?: string;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  card,
  onSelect,
  onPlayDirect,
  className,
}) => {
  // Determine badge type and color
  const entityType = card.entity_type?.toLowerCase() || "";
  let typeLabel = "Фільм";
  let typeBadgeClass = "bg-indigo-600/90 text-white border-indigo-400/30";

  if (entityType.includes("series") || entityType.includes("серіал") || card.series_info) {
    typeLabel = "Серіал";
    typeBadgeClass = "bg-rose-600/90 text-white border-rose-400/30";
  } else if (entityType.includes("anime") || entityType.includes("аніме")) {
    typeLabel = "Аніме";
    typeBadgeClass = "bg-purple-600/90 text-white border-purple-400/30";
  } else if (entityType.includes("cartoon") || entityType.includes("мульт")) {
    typeLabel = "Мультфільм";
    typeBadgeClass = "bg-emerald-600/90 text-white border-emerald-400/30";
  }

  return (
    <div
      onClick={() => onSelect(card)}
      className={cn(
        "group relative flex flex-col cursor-pointer select-none focus:outline-none transition-all duration-300",
        className
      )}
    >
      {/* Poster 2:3 container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-zinc-900/90 border border-white/10 shadow-lg transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-[0_0_28px_rgba(225,29,72,0.3)] group-hover:border-rose-500/40">
        <img
          src={card.poster}
          alt={card.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          onError={(e) => {
            // fallback placeholder if image fails
            (e.currentTarget as HTMLImageElement).src =
              "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22200%22%20height%3D%22300%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20fill%3D%22%2318181b%22%20width%3D%22200%22%20height%3D%22300%22%2F%3E%3Ctext%20fill%3D%22%2371717a%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%3ERDX%3C%2Ftext%3E%3C%2Fsvg%3E";
          }}
        />

        {/* Subtle Vignette Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/40 opacity-80 group-hover:opacity-60 transition-opacity" />

        {/* Top-Left Badge: Entity Type */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span
            className={cn(
              "px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide uppercase shadow-md backdrop-blur-md border",
              typeBadgeClass
            )}
          >
            {typeLabel}
          </span>
        </div>

        {/* Top-Right Badges: Series info */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
          {card.series_info && (
            <span className="bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-md text-[11px] font-semibold text-zinc-200 border border-white/15 shadow-sm max-w-[120px] truncate">
              {card.series_info}
            </span>
          )}
        </div>

        {/* Center Hover Action */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 z-10 pointer-events-none">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onPlayDirect) {
                onPlayDirect(card);
              } else {
                onSelect(card);
              }
            }}
            className="w-12 h-12 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-xl shadow-rose-900/50 backdrop-blur-sm pointer-events-auto hover:bg-rose-500 hover:scale-110 active:scale-95 transition-all"
            title="Дивитися зараз"
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
        </div>

        {/* Bottom-Right Badge: Rating or Year */}
        {(card.rating || card.misc_info) && (
          <div className="absolute bottom-2.5 right-2.5 z-10">
            {card.rating ? (
              <div className="flex items-center gap-1 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg text-xs font-bold text-amber-400 border border-white/10 shadow-md">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>{card.rating}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Metadata Below Poster */}
      <div className="mt-2.5 px-0.5 flex flex-col space-y-0.5">
        <h3 className="font-semibold text-sm text-zinc-100 leading-snug line-clamp-1 group-hover:text-rose-400 transition-colors">
          {card.title}
        </h3>
        <p className="text-xs text-zinc-400 line-clamp-1">
          {card.misc_info || "HDRezka"}
        </p>
      </div>
    </div>
  );
};
