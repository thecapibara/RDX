import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Play, Info, Bookmark as BookmarkIcon, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MediaCard } from "../types";
import { cn } from "../lib/utils";
import { api } from "../services/api";
import { ukrainizeMiscInfo, ukrainizeSeriesInfo } from "../utils/ukrainize";

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
  const [backdrops, setBackdrops] = useState<Record<string, string | null>>({});
  const bannerRef = useRef<HTMLDivElement>(null);

  // Preload high-res 1080p TMDB backdrops for hero slides
  useEffect(() => {
    if (!slides || slides.length === 0) return;

    let isMounted = true;
    slides.forEach((slide) => {
      const key = slide.id || slide.url;
      if (backdrops[key] !== undefined) return;

      const yearMatch = slide.misc_info?.match(/\b(19\d\d|20\d\d)\b/)?.[0];
      const slideMediaType: "movie" | "tv" =
        slide.entity_type === "series" || slide.url.includes("/series/") ? "tv" : "movie";
      api.getBackdrop(slide.title, (slide as any).orig_title, yearMatch, slideMediaType).then((url) => {
        if (isMounted) {
          setBackdrops((prev) => ({ ...prev, [key]: url || null }));
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, [slides]);

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
  const activeKey = currentMedia.id || currentMedia.url;
  const currentBackdrop = backdrops[activeKey];

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
      {/* 1. Backdrop Layer (Full-bleed 1080p TMDB Backdrop or Ambient Aurora Fallback) */}
      <AnimatePresence mode="wait">
        {currentBackdrop ? (
          <motion.div
            key={`backdrop-${activeKey}`}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute inset-0 pointer-events-none overflow-hidden"
          >
            <img
              src={currentBackdrop}
              alt={currentMedia.title}
              decoding="async"
              className="w-full h-full object-cover object-center sm:object-[center_20%] opacity-90 transition-transform duration-1000 ease-out group-hover:scale-105 transform-gpu"
            />
            {/* Cinematic Edge Blends */}
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/85 via-40% to-transparent w-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base,#000000)] via-transparent to-[var(--bg-base,#000000)]/30 pointer-events-none" />
            <div className="absolute inset-x-0 -bottom-px h-44 bg-gradient-to-t from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/90 to-transparent pointer-events-none" />
          </motion.div>
        ) : (
          /* 2. Fallback: Ambient Aurora Glow from poster (ZERO pixelation, smooth cinematic glow) */
          <motion.div
            key={`aurora-${activeKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="absolute inset-0 pointer-events-none overflow-hidden"
          >
            <img
              src={currentMedia.poster}
              alt=""
              aria-hidden="true"
              decoding="async"
              className="w-full h-full object-cover object-center opacity-40 blur-3xl scale-125 saturate-200 transform-gpu"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base,#000000)] via-transparent to-transparent opacity-95" />
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/80 to-transparent w-full" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Text Backdrop Gradient Layer (Ensures maximum legibility on left) */}
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/90 via-35% md:via-45% to-transparent w-full md:w-4/5 pointer-events-none z-[5]" />
      <div className="absolute inset-x-0 top-0 -bottom-px bg-gradient-to-t from-[var(--bg-base,#000000)] via-transparent to-transparent pointer-events-none z-[5]" />
      {/* Solid 2px bottom seam cover prevents subpixel GPU-layer bleed from transform-gpu backdrop during scroll */}
      <div className="absolute inset-x-0 -bottom-px h-[3px] bg-[var(--bg-base,#000000)] pointer-events-none z-[6]" />

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
                {ukrainizeSeriesInfo(currentMedia.series_info)}
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
                {ukrainizeMiscInfo(currentMedia.misc_info)}
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
