import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, X, Filter } from "lucide-react";
import {
  SORT_FILTERS,
  CATEGORY_GENRES,
} from "../constants/genres";
import { cn } from "../lib/utils";

interface CategoryFilterBarProps {
  category: string; // "films" | "series" | "cartoons" | "animation"
  activeSort: string;
  onSortChange: (sortId: string) => void;
  activeGenre: string | null;
  onGenreChange: (genreId: string | null) => void;
}

export const CategoryFilterBar: React.FC<CategoryFilterBarProps> = ({
  category,
  activeSort,
  onSortChange,
  activeGenre,
  onGenreChange,
}) => {
  const [isGenreDropdownOpen, setIsGenreDropdownOpen] = useState(false);
  const [genreSearch, setGenreSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const availableGenres = CATEGORY_GENRES[category] || [];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsGenreDropdownOpen(false);
      }
    };
    if (isGenreDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isGenreDropdownOpen]);

  // Reset genre when switching categories if the genre isn't valid for the new category
  useEffect(() => {
    if (activeGenre && !availableGenres.some((g) => g.id === activeGenre)) {
      onGenreChange(null);
    }
  }, [category, activeGenre, availableGenres, onGenreChange]);

  // Filtered genres for the dropdown popover
  const filteredGenres = availableGenres.filter((g) =>
    g.label.toLowerCase().includes(genreSearch.toLowerCase().trim())
  );

  // Top 6 genres for quick chips
  const quickGenres = availableGenres.slice(0, 6);
  const activeGenreLabel = availableGenres.find((g) => g.id === activeGenre)?.label;

  return (
    <div className="w-full space-y-4 pt-1 pb-3 select-none">
      {/* 1. Sort Filter Pills (Останні надходження / Популярні / Зараз дивляться / В очікуванні) */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {SORT_FILTERS.map((filter) => {
          const isActive = activeSort === filter.id;
          return (
            <button
              key={filter.id}
              onClick={() => onSortChange(filter.id)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer",
                isActive
                  ? "bg-rose-600 text-white shadow-lg shadow-rose-950/60 border border-rose-500"
                  : "bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10"
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* 2. Genre Chips & Full Dropdown */}
      {availableGenres.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {/* "Всі жанри" Chip */}
          <button
            onClick={() => onGenreChange(null)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              activeGenre === null
                ? "bg-white text-zinc-950 font-bold shadow-sm"
                : "bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-white/10"
            )}
          >
            Всі жанри
          </button>

          {/* Quick-Access Top Genre Chips */}
          {quickGenres.map((g) => {
            const isActive = activeGenre === g.id;
            return (
              <button
                key={g.id}
                onClick={() => onGenreChange(isActive ? null : g.id)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  isActive
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/50 font-semibold"
                    : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/5"
                )}
              >
                {g.label}
              </button>
            );
          })}

          {/* Full Genre Dropdown Button */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setIsGenreDropdownOpen((prev) => !prev)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer",
                activeGenre && !quickGenres.some((g) => g.id === activeGenre)
                  ? "bg-rose-600/30 text-rose-200 border-rose-500/60 font-semibold"
                  : "bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white border-white/10"
              )}
            >
              <Filter className="w-3.5 h-3.5 opacity-70" />
              <span>
                {activeGenre && !quickGenres.some((g) => g.id === activeGenre)
                  ? activeGenreLabel
                  : "Більше жанрів"}
              </span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-zinc-400 transition-transform duration-200",
                  isGenreDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {/* Dropdown Popover */}
            {isGenreDropdownOpen && (
              <div className="absolute left-0 mt-2 w-72 sm:w-80 max-h-96 overflow-hidden bg-zinc-950/95 border border-white/15 rounded-2xl shadow-2xl p-3 z-50 flex flex-col space-y-2 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                {/* Search input inside dropdown */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    autoFocus
                    type="text"
                    value={genreSearch}
                    onChange={(e) => setGenreSearch(e.target.value)}
                    placeholder="Пошук жанру..."
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                  {genreSearch && (
                    <button
                      onClick={() => setGenreSearch("")}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Genre List */}
                <div className="overflow-y-auto max-h-72 space-y-0.5 pr-1 divide-y divide-white/5 no-scrollbar">
                  {/* Reset to all */}
                  <button
                    onClick={() => {
                      onGenreChange(null);
                      setIsGenreDropdownOpen(false);
                      setGenreSearch("");
                    }}
                    className={cn(
                      "w-full px-3 py-2 rounded-xl text-left text-xs transition-colors flex items-center justify-between cursor-pointer",
                      activeGenre === null
                        ? "bg-rose-600/20 text-rose-300 font-semibold"
                        : "text-zinc-300 hover:bg-white/5"
                    )}
                  >
                    <span>Всі жанри</span>
                    {activeGenre === null && <Check className="w-3.5 h-3.5 text-rose-400" />}
                  </button>

                  {filteredGenres.map((g) => {
                    const isSelected = activeGenre === g.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => {
                          onGenreChange(g.id);
                          setIsGenreDropdownOpen(false);
                          setGenreSearch("");
                        }}
                        className={cn(
                          "w-full px-3 py-2 rounded-xl text-left text-xs transition-colors flex items-center justify-between cursor-pointer",
                          isSelected
                            ? "bg-rose-600 text-white font-semibold"
                            : "text-zinc-300 hover:bg-white/5"
                        )}
                      >
                        <span>{g.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Clear active genre pill if chosen */}
          {activeGenre && (
            <button
              onClick={() => onGenreChange(null)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 transition-colors cursor-pointer"
            >
              <span>{activeGenreLabel}</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
