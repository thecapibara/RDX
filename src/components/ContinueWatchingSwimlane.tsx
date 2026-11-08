import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import type { WatchProgress, MediaCard } from "../types";
import { ContinueWatchingCard } from "./ContinueWatchingCard";
import { cn } from "../lib/utils";
import { playButtonClickSound } from "../services/sound";

interface ContinueWatchingSwimlaneProps {
  items: WatchProgress[];
  onResume: (item: WatchProgress) => void;
  onRemove: (mediaId: string) => void;
  onOpenDetails?: (card: MediaCard) => void;
  className?: string;
}

export const ContinueWatchingSwimlane: React.FC<ContinueWatchingSwimlaneProps> = React.memo(({
  items,
  onResume,
  onRemove,
  onOpenDetails,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(() => (items ? items.length > 3 : false));

  // Mouse Drag-and-Scroll & Wheel tracking
  const isMouseDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Zero-overhead boundary tracking via IntersectionObserver (no synchronous layout thrashing)
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

    return () => {
      observer.disconnect();
    };
  }, [items]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = Math.max(320, scrollRef.current.clientWidth * 0.75);
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isMouseDownRef.current = true;
    startXRef.current = e.pageX;
    scrollLeftRef.current = scrollRef.current?.scrollLeft || 0;
    isDraggingRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current || !scrollRef.current) return;
    const dx = e.pageX - startXRef.current;
    if (!isDraggingRef.current && Math.abs(dx) > 6) {
      isDraggingRef.current = true;
      setIsDragging(true);
    }
    if (isDraggingRef.current) {
      e.preventDefault();
      scrollRef.current.scrollLeft = scrollLeftRef.current - dx;
    }
  };

  const handleMouseUp = () => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    if (isDraggingRef.current) {
      setTimeout(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
      }, 50);
    }
  };

  const handleMouseLeave = () => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    if (isDraggingRef.current) {
      setTimeout(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
      }, 50);
    }
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    if ((e.shiftKey && e.deltaY !== 0) || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      scrollRef.current.scrollLeft += e.deltaY || e.deltaX;
    }
  };

  const handleChevronWheel = (e: React.WheelEvent) => {
    if (scrollRef.current && Math.abs(e.deltaY) > 0) {
      scrollRef.current.scrollLeft += e.deltaY;
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
        {/* Left Edge Vignette Fade */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-4 w-16 sm:w-24 lg:w-28 z-20 pointer-events-none bg-gradient-to-r from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/80 to-transparent transition-opacity duration-200" />
        )}

        {/* Left Floating Chevron (Spotify style) */}
        {canScrollLeft && (
          <button
            onClick={() => {
              playButtonClickSound();
              scroll("left");
            }}
            onWheel={handleChevronWheel}
            aria-label="Прокрутити вліво"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full flex items-center justify-center bg-zinc-950/90 hover:bg-zinc-800 border border-white/20 text-white shadow-2xl backdrop-blur-md transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Right Edge Vignette Fade */}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-4 w-16 sm:w-24 lg:w-28 z-20 pointer-events-none bg-gradient-to-l from-[var(--bg-base,#000000)] via-[var(--bg-base,#000000)]/80 to-transparent transition-opacity duration-200" />
        )}

        {/* Right Floating Chevron (Spotify style) */}
        {canScrollRight && (
          <button
            onClick={() => {
              playButtonClickSound();
              scroll("right");
            }}
            onWheel={handleChevronWheel}
            aria-label="Прокрутити вправо"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full flex items-center justify-center bg-zinc-950/90 hover:bg-zinc-800 border border-white/20 text-white shadow-2xl backdrop-blur-md transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer"
          >
            <ChevronRight className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Horizontal Carousel Track */}
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClickCapture={handleClickCapture}
          className={cn(
            "flex gap-4 overflow-x-auto px-[clamp(1.25rem,4vw,4rem)] pb-4 pt-1 no-scrollbar cursor-grab active:cursor-grabbing",
            isDragging ? "cursor-grabbing select-none" : "scroll-smooth"
          )}
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            scrollBehavior: isDragging ? "auto" : undefined,
          }}
        >
          <div ref={startSentinelRef} className="w-px h-1 shrink-0 -mr-4 pointer-events-none opacity-0" aria-hidden="true" />
          {items.map((item) => (
            <ContinueWatchingCard
              key={item.media_id}
              item={item}
              onResume={onResume}
              onRemove={onRemove}
              onOpenDetails={onOpenDetails}
            />
          ))}
          <div ref={endSentinelRef} className="w-px h-1 shrink-0 -ml-4 pointer-events-none opacity-0" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
});
