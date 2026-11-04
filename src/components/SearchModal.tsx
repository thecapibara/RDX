import React, { useState, useEffect, useRef } from "react";
import { Search, X, Loader2 } from "lucide-react";
import type { MediaCard } from "../types";
import { api } from "../services/api";
import { MediaCard as MediaCardComponent } from "./MediaCard";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMedia: (card: MediaCard) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectMedia,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaCard[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, [isOpen]);

  // Live search debounced 350ms
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const items = await api.searchMedia(query.trim());
        setResults(items);
      } catch (err) {
        console.error("Search media error:", err);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      const prevBodyOverflow = document.body.style.overflow;
      const prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";

      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
      };
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#08090d]/95 flex flex-col overflow-y-auto select-none"
    >
      {/* Top Search Input Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="sticky top-0 z-20 w-full bg-[#08090d]/90 border-b border-white/10 px-[clamp(1.5rem,5vw,5rem)] py-6 flex items-center justify-between gap-6"
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Search className="w-6 h-6 text-rose-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Введіть назву фільму або серіалу..."
            className="w-full bg-transparent text-xl sm:text-2xl font-bold text-white placeholder-zinc-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {loading && <Loader2 className="w-5 h-5 text-rose-500 animate-spin" />}
          {query && !loading && (
            <button
              onClick={() => setQuery("")}
              className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Results Container with Fluid Responsive Grid */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full px-[clamp(1.5rem,5vw,5rem)] py-8 flex-1"
      >
        {results.length > 0 ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
                Результати пошуку ({results.length})
              </h2>
            </div>

            {/* Poster Cards Grid with Real Posters */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(185px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
              {results.map((card) => (
                <MediaCardComponent
                  key={card.id || card.url}
                  card={card}
                  onSelect={(c) => {
                    onSelectMedia(c);
                    onClose();
                  }}
                />
              ))}
            </div>
          </div>
        ) : query.trim().length >= 2 && !loading ? (
          <div className="py-24 text-center space-y-2">
            <h3 className="text-lg font-bold text-zinc-200">
              Нічого не знайдено
            </h3>
            <p className="text-xs text-zinc-400">
              За запитом «{query}» результатів не знайдено. Спробуйте іншу назву.
            </p>
          </div>
        ) : (
          <div className="py-28 text-center text-zinc-500 text-sm">
            Почніть вводити назву для миттєвого пошуку серед тисяч фільмів та серіалів
          </div>
        )}
      </div>
    </div>
  );
};
