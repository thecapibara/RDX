import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Play, Info, Bookmark as BookmarkIcon, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MediaCard } from "../types";
import { cn } from "../lib/utils";

interface HeroBannerProps {
  items?: MediaCard[];
  media?: MediaCard | null;
  onPlay: (media: MediaCard) => void;
  onOpenDetails: (media: MediaCard) => void;
  onToggleBookmark?: (media: MediaCard) => void;
  isBookmarked?: boolean;
}

const ROTATION_INTERVAL_MS = 8000;

export const HeroBanner: React.FC<HeroBannerProps> = ({
  items,
  media,
  onPlay,
  onOpenDetails,
  onToggleBookmark,
  isBookmarked = false,
}) => {
  const slides = useMemo(() => {
    if (items && items.length > 0) return items.slice(0, 8);
    if (media) return [media];
    return [];
  }, [items, media]);

  const [currentIndex, setCurrentIndex] = useState(() => {
    if (slides.length > 1) {
      return Math.floor(Math.random() * Math.min(slides.length, 5));
    }
    return 0;
  });

  const [isHovered, setIsHovered] = useState(false);
  const [slideKey, setSlideKey] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Pause heavy animations and timer when user scrolls down away from the hero banner
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (currentIndex >= slides.length && slides.length > 0) {
      setCurrentIndex(0);
    }
  }, [slides.length, currentIndex]);

  const handleNext = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % slides.length);
    setSlideKey((k) => k + 1);
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
    setSlideKey((k) => k + 1);
  }, [slides.length]);

  const handleSelect = useCallback((index: number) => {
    setCurrentIndex(index);
    setSlideKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (slides.length <= 1 || isHovered || !isVisible) return;

    const timer = setInterval(() => {
      handleNext();
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [slides.length, isHovered, isVisible, handleNext, slideKey]);

  if (slides.length === 0) {
    return null;
  }

  const currentMedia = slides[currentIndex] || slides[0];

  const isSeries =
    currentMedia.entity_type?.toLowerCase().includes("series") ||
    currentMedia.entity_type?.toLowerCase().includes("серіал") ||
    Boolean(currentMedia.series_info);

  return (
    <div
      ref={bannerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative w-full h-[58vh] min-h-[440px] max-h-[640px] overflow-hidden select-none group [contain:layout_paint]"
    >
      {/* Full-bleed Atmospheric Background Poster */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentMedia.id || currentMedia.url}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="absolute inset-0"
        >
          <img
            src={currentMedia.poster}
            alt={currentMedia.title}
            decoding="async"
            className="w-full h-full object-cover object-[center_20%] sm:object-[75%_20%] opacity-50 blur-[10px] scale-106 transform-gpu"
          />

          {/* Cinematic Vignette Overlays: Left gradient for text, bottom fade into pure black */}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/85 to-transparent w-full md:w-3/4" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-[var(--bg-base,#000000)]" />
        </motion.div>
      </AnimatePresence>

      {/* Content Container (Left-aligned text & actions) */}
      <div className="relative z-10 h-full flex flex-col justify-end px-[clamp(1.5rem,5vw,5rem)] pb-12 max-w-5xl space-y-4">
        {/* Badges Row */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`meta-${currentMedia.id || currentMedia.url}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="flex flex-wrap items-center gap-2.5"
          >
            <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-rose-600/90 text-white shadow-md shadow-rose-950/50 border border-rose-400/30">
              {isSeries ? "Серіал" : "Фільм"}
            </span>

            {currentMedia.series_info && (
              <span className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-white/10 text-zinc-200 border border-white/15">
                {currentMedia.series_info}
              </span>
            )}

            {currentMedia.rating && (
              <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{currentMedia.rating}</span>
              </div>
            )}

            {currentMedia.misc_info && (
              <span className="text-xs text-zinc-300 font-medium">
                {currentMedia.misc_info}
              </span>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Title */}
        <AnimatePresence mode="wait">
          <motion.h1
            key={`title-${currentMedia.id || currentMedia.url}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white line-clamp-2 drop-shadow-2xl"
          >
            {currentMedia.title}
          </motion.h1>
        </AnimatePresence>

        {/* Actions Row */}
        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            onClick={() => onPlay(currentMedia)}
            className="flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-700 via-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-400 text-white font-bold text-sm shadow-xl shadow-rose-900/40 hover:shadow-rose-900/60 active:scale-95 transition-all cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>Дивитися зараз</span>
          </button>

          <button
            onClick={() => onOpenDetails(currentMedia)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-zinc-900/90 hover:bg-zinc-800 active:scale-95 text-white font-semibold text-sm border border-white/15 transition-all cursor-pointer"
          >
            <Info className="w-4 h-4 text-zinc-300" />
            <span>Детальніше</span>
          </button>

          {onToggleBookmark && (
            <button
              onClick={() => onToggleBookmark(currentMedia)}
              title={isBookmarked ? "Видалити із закладок" : "Додати в закладки"}
              className={cn(
                "p-3 rounded-2xl border transition-all cursor-pointer active:scale-95",
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

      {/* Subtle Slide Navigation Controls at Bottom Right */}
      {slides.length > 1 && (
        <div className="absolute z-20 right-6 sm:right-10 bottom-10 flex items-center gap-3 transform-gpu">
          <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handlePrev}
              title="Попередній хіт"
              aria-label="Попередній хіт"
              className="w-8 h-8 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-white/15 flex items-center justify-center text-white active:scale-90 transition-all cursor-pointer shadow-md"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNext}
              title="Наступний хіт"
              aria-label="Наступний хіт"
              className="w-8 h-8 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-white/15 flex items-center justify-center text-white active:scale-90 transition-all cursor-pointer shadow-md"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Clean Apple TV / Cinema Indicators (Zero-artifact GPU layout) */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/90 border border-white/10 shadow-xl transform-gpu">
            {slides.map((s, idx) => {
              const isActive = idx === currentIndex;
              return (
                <button
                  key={s.id || s.url || idx}
                  onClick={() => handleSelect(idx)}
                  title={s.title}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300 cursor-pointer block p-0 border-0 outline-none",
                    isActive
                      ? "w-8 bg-gradient-to-r from-rose-600 to-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.7)]"
                      : "w-2 bg-white/25 hover:bg-white/50"
                  )}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
