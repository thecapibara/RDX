import React, { useState, useEffect } from "react";
import { Search, Maximize, Minimize } from "lucide-react";
import type { MirrorStatus } from "../types";
import { cn } from "../lib/utils";

export type NavTab =
  | "home"
  | "films"
  | "series"
  | "cartoons"
  | "animation"
  | "new"
  | "bookmarks";

interface TopBarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenSearch: () => void;
  onOpenMirrorModal: () => void;
  mirrorStatus: MirrorStatus | null;
  activeMirrorUrl: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  onOpenSearch,
  onOpenMirrorModal,
  mirrorStatus,
  activeMirrorUrl,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeString, setTimeString] = useState("");

  // Live TV Clock (HH:MM e.g. 23:47)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString("uk-UA", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen state listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Keyboard shortcut Ctrl+K / Cmd+K for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenSearch]);

  const mirrorHost = (() => {
    try {
      return new URL(activeMirrorUrl).hostname;
    } catch {
      return activeMirrorUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  })();

  const tabs: { id: NavTab; label: string }[] = [
    { id: "home", label: "Головна" },
    { id: "films", label: "Фільми" },
    { id: "series", label: "Серіали" },
    { id: "cartoons", label: "Мультфільми" },
    { id: "animation", label: "Аніме" },
    { id: "new", label: "Новинки" },
    { id: "bookmarks", label: "Закладки" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full px-6 sm:px-8 lg:px-12 py-5 bg-gradient-to-b from-black/95 via-black/75 to-transparent flex items-center justify-between gap-6 select-none will-change-transform">
      {/* Left: Typographic Wordmark & Text-Only Android TV Navigation */}
      <div className="flex items-center gap-6 sm:gap-10 min-w-0">
        {/* Brand Wordmark */}
        <div
          onClick={() => onTabChange("home")}
          className="flex items-baseline cursor-pointer group flex-shrink-0"
        >
          <span className="text-2xl font-black tracking-tighter text-white group-hover:text-zinc-200 transition-colors">
            RDX<span className="text-rose-500">.</span>
          </span>
        </div>

        {/* Text-Only Navigation Tabs */}
        <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto no-scrollbar py-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "relative pb-1.5 text-[15px] tracking-wide transition-colors duration-200 whitespace-nowrap cursor-pointer",
                  isActive
                    ? "text-white font-semibold"
                    : "text-zinc-400 font-medium hover:text-zinc-100"
                )}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full transition-all" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right: Minimal Actions & TV Clock */}
      <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
        {/* Minimal Search Button */}
        <button
          onClick={onOpenSearch}
          title="Пошук (Ctrl+K)"
          className="text-zinc-300 hover:text-white transition-colors cursor-pointer p-1"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Minimal Mirror Status Button */}
        <button
          onClick={onOpenMirrorModal}
          title="Дзеркало HDRezka / Налаштування мережі"
          className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer p-1"
        >
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              mirrorStatus?.online
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                : mirrorStatus
                ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                : "bg-emerald-400"
            )}
          />
          <span className="hidden md:inline text-[13px]">{mirrorHost}</span>
        </button>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Вийти з повного екрану" : "На весь екран"}
          className="text-zinc-300 hover:text-white transition-colors cursor-pointer p-1"
        >
          {isFullscreen ? (
            <Minimize className="w-5 h-5" />
          ) : (
            <Maximize className="w-5 h-5" />
          )}
        </button>

        {/* Android TV Clock */}
        <span className="text-lg font-medium text-zinc-100 tracking-tight tabular-nums font-mono pl-1">
          {timeString}
        </span>
      </div>
    </header>
  );
};
