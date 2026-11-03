import React from "react";
import { Play, Info, Bookmark as BookmarkIcon, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MediaCard } from "../types";
import { cn } from "../lib/utils";

interface HeroBannerProps {
  media: MediaCard | null;
  onPlay: (media: MediaCard) => void;
  onOpenDetails: (media: MediaCard) => void;
  onToggleBookmark?: (media: MediaCard) => void;
  isBookmarked?: boolean;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media,
  onPlay,
  onOpenDetails,
  onToggleBookmark,
  isBookmarked,
}) => {
  if (!media) {
    return null;
  }

  const isSeries =
    media.entity_type?.toLowerCase().includes("series") ||
    media.entity_type?.toLowerCase().includes("серіал") ||
    Boolean(media.series_info);

  return (
    <div className="relative w-full h-[52vh] min-h-[380px] max-h-[580px] overflow-hidden select-none">
      {/* Background Poster & Ambient Glow */}
      <AnimatePresence mode="wait">
        <motion.div
          key={media.id || media.url}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <img
            src={media.poster}
            alt={media.title}
            className="w-full h-full object-cover object-center filter blur-[2px] brightness-[0.45] scale-105"
          />
          {/* Radial & Linear gradient overlays for true Android TV cinema depth */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#090a0f] via-[#090a0f]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#090a0f] via-[#090a0f]/80 to-transparent w-full md:w-3/4" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#090a0f]" />
        </motion.div>
      </AnimatePresence>

      {/* Content Container */}
      <div className="relative z-10 h-full flex flex-col justify-end px-[clamp(1.5rem,5vw,5rem)] pb-10 max-w-5xl space-y-4">
        {/* Badges Row */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-rose-600/90 text-white shadow-md shadow-rose-950/50 border border-rose-400/30">
            {isSeries ? "Серіал" : "Фільм"}
          </span>

          {media.series_info && (
            <span className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-white/10 backdrop-blur-md text-zinc-200 border border-white/15">
              {media.series_info}
            </span>
          )}

          {media.rating && (
            <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span>{media.rating}</span>
            </div>
          )}

          {media.misc_info && (
            <span className="text-xs text-zinc-300 font-medium">
              {media.misc_info}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white line-clamp-2 drop-shadow-xl">
          {media.title}
        </h1>

        {/* Actions Row */}
        <div className="flex items-center gap-3 pt-2">
          {/* Watch Now */}
          <button
            onClick={() => onPlay(media)}
            className="flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-rose-500 hover:from-red-500 hover:to-rose-400 text-white font-bold text-sm shadow-xl shadow-rose-900/40 hover:shadow-rose-900/60 active:scale-95 transition-all cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Дивитися зараз</span>
          </button>

          {/* Details */}
          <button
            onClick={() => onOpenDetails(media)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold text-sm backdrop-blur-xl border border-white/15 transition-all cursor-pointer"
          >
            <Info className="w-4 h-4 text-zinc-300" />
            <span>Детальніше</span>
          </button>

          {/* Bookmark Toggle */}
          {onToggleBookmark && (
            <button
              onClick={() => onToggleBookmark(media)}
              title={isBookmarked ? "Видалити із закладок" : "Додати в закладки"}
              className={cn(
                "p-3 rounded-2xl backdrop-blur-xl border transition-all cursor-pointer active:scale-95",
                isBookmarked
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-white/10 text-zinc-300 border-white/15 hover:bg-white/20 hover:text-white"
              )}
            >
              <BookmarkIcon
                className={cn("w-5 h-5", isBookmarked && "fill-amber-400")}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
