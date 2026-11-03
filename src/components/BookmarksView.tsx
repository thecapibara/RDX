import React, { useState, useEffect } from "react";
import { Bookmark as BookmarkIcon, FolderHeart } from "lucide-react";
import type { Bookmark, MediaCard as MediaCardType } from "../types";
import { api } from "../services/api";
import { MediaCard } from "./MediaCard";
import { cn } from "../lib/utils";

interface BookmarksViewProps {
  onSelectMedia: (card: MediaCardType) => void;
  onPlayDirect: (card: MediaCardType) => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  onSelectMedia,
  onPlayDirect,
}) => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const loadBookmarks = async () => {
    try {
      const items = await api.getBookmarks(
        activeCategory === "all" ? undefined : activeCategory
      );
      setBookmarks(items);
    } catch (err) {
      console.error("Failed to load bookmarks:", err);
    }
  };

  useEffect(() => {
    loadBookmarks();
  }, [activeCategory]);

  const categories = [
    { id: "all", label: "Усі" },
    { id: "favorites", label: "Улюблені" },
    { id: "watching", label: "Дивлюсь" },
    { id: "planned", label: "В планах" },
    { id: "completed", label: "Переглянуто" },
  ];

  return (
    <div className="w-full px-[clamp(1.25rem,4vw,4rem)] py-6 space-y-6">
      {/* Title & Category Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-600 flex items-center justify-center text-white shadow-lg shadow-amber-950/40">
            <BookmarkIcon className="w-5 h-5 fill-current" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Мої закладки
            </h1>
            <p className="text-xs text-zinc-400">
              Збережені фільми та серіали для швидкого доступу
            </p>
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-1.5 p-1 bg-zinc-900 rounded-2xl border border-white/5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                activeCategory === cat.id
                  ? "bg-rose-600 text-white shadow-md shadow-rose-950/50"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Bookmarks with Fluid Dynamic Auto-Fill */}
      {bookmarks.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(185px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
          {bookmarks.map((bm) => {
            const card: MediaCardType = {
              id: bm.media_id,
              url: bm.media_url,
              title: bm.title,
              poster: bm.poster_url,
              entity_type: bm.media_type,
              series_info: null,
              misc_info: bm.year_info || "",
              rating: bm.rating,
            };

            return (
              <MediaCard
                key={bm.media_id}
                card={card}
                onSelect={onSelectMedia}
                onPlayDirect={onPlayDirect}
              />
            );
          })}
        </div>
      ) : (
        <div className="py-24 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-500">
            <FolderHeart className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-zinc-200">
              Список закладок порожній
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm">
              Натисніть на значок закладки на сторінці фільму чи серіалу, щоб додати його сюди.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
