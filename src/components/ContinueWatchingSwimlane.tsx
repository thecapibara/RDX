import React, { useRef, useState, useEffect, useCallback } from "react";
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
  const rafRef = useRef<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (scrollRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        if (clientWidth === 0) return;
        const nextLeft = scrollLeft > 10;
        const nextRight = scrollLeft + clientWidth < scrollWidth - 10;
        setCanScrollLeft((prev) => (prev !== nextLeft ? nextLeft : prev));
        setCanScrollRight((prev) => (prev !== nextRight ? nextRight : prev));
      }
    });
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => checkScroll());
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [items, checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative py-4 space-y-3 [contain:layout_style]", className)}>
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

        {(canScrollLeft || canScrollRight) && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              aria-label="Прокрутити вліво"
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center bg-zinc-900 border border-white/10 text-white transition-colors shadow-sm cursor-pointer",
                canScrollLeft
                  ? "hover:bg-rose-600 hover:border-rose-500 active:scale-95"
                  : "opacity-30 cursor-not-allowed"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              aria-label="Прокрутити вправо"
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center bg-zinc-900 border border-white/10 text-white transition-colors shadow-sm cursor-pointer",
                canScrollRight
                  ? "hover:bg-rose-600 hover:border-rose-500 active:scale-95"
                  : "opacity-30 cursor-not-allowed"
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Track */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex gap-4 overflow-x-auto px-[clamp(1.25rem,4vw,4rem)] pb-4 pt-1 no-scrollbar"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) => (
          <ContinueWatchingCard
            key={item.media_id}
            item={item}
            onResume={onResume}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
});
