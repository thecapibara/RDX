import React, { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import type { MediaCard as MediaCardType } from "../types";
import { MediaCard } from "./MediaCard";
import { cn } from "../lib/utils";

interface SwimlaneProps {
  title: string;
  subtitle?: string;
  badge?: string;
  items: MediaCardType[];
  onSelectCard: (card: MediaCardType) => void;
  onPlayDirect?: (card: MediaCardType) => void;
  onMoreClick?: () => void;
  className?: string;
}

export const Swimlane: React.FC<SwimlaneProps> = ({
  title,
  subtitle,
  badge,
  items,
  onSelectCard,
  onPlayDirect,
  onMoreClick,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [items]);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = scrollRef.current.clientWidth * 0.75;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      setTimeout(checkScroll, 350);
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative py-4 space-y-3", className)}>
      {/* Swimlane Header */}
      <div className="flex items-center justify-between px-[clamp(1.25rem,4vw,4rem)]">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            {title}
            {badge && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                {badge}
              </span>
            )}
          </h2>
          {subtitle && (
            <span className="hidden sm:inline-block text-xs text-zinc-400 font-medium">
              • {subtitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onMoreClick && (
            <button
              onClick={onMoreClick}
              className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all mr-2"
            >
              <span>Більше</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Navigation Scroll Chevrons */}
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            aria-label="Прокрутити вліво"
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center bg-zinc-900/80 border border-white/10 text-white transition-all shadow-md backdrop-blur-md",
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
              "w-8 h-8 rounded-full flex items-center justify-center bg-zinc-900/80 border border-white/10 text-white transition-all shadow-md backdrop-blur-md",
              canScrollRight
                ? "hover:bg-rose-600 hover:border-rose-500 active:scale-95"
                : "opacity-30 cursor-not-allowed"
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel Track */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="flex gap-4 overflow-x-auto px-[clamp(1.25rem,4vw,4rem)] pb-4 pt-1 no-scrollbar scroll-smooth"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((card) => (
          <div key={card.id || card.url} className="w-40 sm:w-44 md:w-48 flex-shrink-0">
            <MediaCard
              card={card}
              onSelect={onSelectCard}
              onPlayDirect={onPlayDirect}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
