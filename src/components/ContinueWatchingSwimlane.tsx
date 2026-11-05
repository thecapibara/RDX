import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import type { WatchProgress } from "../types";
import { ContinueWatchingCard } from "./ContinueWatchingCard";
import { cn } from "../lib/utils";

interface ContinueWatchingSwimlaneProps {
  items: WatchProgress[];
  onResume: (item: WatchProgress) => void;
  onRemove: (mediaId: string) => void;
  className?: string;
}

export const ContinueWatchingSwimlane: React.FC<ContinueWatchingSwimlaneProps> = React.memo(({
  items,
  onResume,
  onRemove,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(() => (items ? items.length > 3 : false));

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (clientWidth === 0) return;

    const nextLeft = scrollLeft > 15;
    const maxScroll = scrollWidth - clientWidth;
    const nextRight = maxScroll > 20 && scrollLeft < maxScroll - 50;

    setCanScrollLeft(nextLeft);
    setCanScrollRight(nextRight);
  }, []);

  useEffect(() => {
    checkScroll();
    const t1 = setTimeout(checkScroll, 80);
    const t2 = setTimeout(checkScroll, 300);
    const t3 = setTimeout(checkScroll, 700);

    const el = scrollRef.current;
    if (!el) {
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    // IntersectionObserver for 100% boundary accuracy
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === startSentinelRef.current) {
            setCanScrollLeft(!entry.isIntersecting);
          } else if (entry.target === endSentinelRef.current) {
            setCanScrollRight(!entry.isIntersecting);
          }
        }
      },
      {
        root: el,
        threshold: 0.1,
      }
    );

    if (startSentinelRef.current) observer.observe(startSentinelRef.current);
    if (endSentinelRef.current) observer.observe(endSentinelRef.current);

    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      observer.disconnect();
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [items, checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = Math.max(320, scrollRef.current.clientWidth * 0.75);
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      setTimeout(checkScroll, 100);
      setTimeout(checkScroll, 250);
      setTimeout(checkScroll, 450);
      setTimeout(checkScroll, 700);
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative py-4 space-y-3 group/swimlane [contain:layout_style]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-[clamp(1.25rem,4vw,4rem)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-sm">
            <History className="w-4 h-4" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Продовжити перегляд
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
              {items.length}
            </span>
          </h2>
        </div>
      </div>

      {/* Track with Spotify-style Floating Navigation */}
      <div className="relative">
        {/* Left Floating Chevron (Spotify style) */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            aria-label="Прокрутити вліво"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full flex items-center justify-center bg-zinc-950/90 hover:bg-zinc-800 border border-white/20 text-white shadow-2xl backdrop-blur-md transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Right Floating Chevron (Spotify style) */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            aria-label="Прокрутити вправо"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full flex items-center justify-center bg-zinc-950/90 hover:bg-zinc-800 border border-white/20 text-white shadow-2xl backdrop-blur-md transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronRight className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Horizontal Carousel Track */}
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex gap-4 overflow-x-auto px-[clamp(1.25rem,4vw,4rem)] pb-4 pt-1 no-scrollbar scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <div ref={startSentinelRef} className="w-px h-1 shrink-0 -mr-4 pointer-events-none opacity-0" aria-hidden="true" />
          {items.map((item) => (
            <ContinueWatchingCard
              key={item.media_id}
              item={item}
              onResume={onResume}
              onRemove={onRemove}
            />
          ))}
          <div ref={endSentinelRef} className="w-px h-1 shrink-0 -ml-4 pointer-events-none opacity-0" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
});
