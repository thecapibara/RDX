import React, { useState, useEffect, useRef } from "react";
import { Search, Maximize, Minimize, ChevronDown, Settings, Download } from "lucide-react";
import type { MirrorStatus } from "../types";
import { cn } from "../lib/utils";
import { playButtonClickSound } from "../services/sound";

export type NavTab =
  | "home"
  | "films"
  | "series"
  | "downloads"
  | "bookmarks"
  | "cartoons"
  | "animation"
  | "new";

interface TopBarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenSearch: () => void;
  onOpenMirrorModal: () => void;
  onOpenSettings?: () => void;
  mirrorStatus: MirrorStatus | null;
  activeMirrorUrl: string;
  activeDownloadsCount?: number;
}

const PRIMARY_TABS: { id: NavTab; label: string }[] = [
  { id: "home", label: "Головна" },
  { id: "films", label: "Фільми" },
  { id: "series", label: "Серіали" },
  { id: "cartoons", label: "Мультфільми" },
  { id: "animation", label: "Аніме" },
  { id: "bookmarks", label: "Закладки" },
];

const SECONDARY_TABS: { id: NavTab; label: string }[] = [
  { id: "new", label: "Новинки" },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  onOpenSearch,
  onOpenMirrorModal,
  onOpenSettings,
  mirrorStatus,
  activeMirrorUrl,
  activeDownloadsCount = 0,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeString, setTimeString] = useState("");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isMoreOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMoreOpen]);

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

  const isSecondaryActive = SECONDARY_TABS.some((t) => t.id === activeTab);
  const activeSecondaryLabel = SECONDARY_TABS.find((t) => t.id === activeTab)?.label;

  return (
    <header className="sticky top-0 z-40 w-full px-4 sm:px-6 lg:px-10 py-3.5 bg-[var(--bg-base,#000000)] border-b border-white/[0.06] flex items-center justify-between gap-4 sm:gap-6 select-none">
      {/* Left: Brand Wordmark & Responsive Android TV Navigation */}
      <div className="flex items-center gap-4 sm:gap-7 lg:gap-8 min-w-0">
        {/* Brand Wordmark */}
        <div
          onClick={() => {
            playButtonClickSound();
            onTabChange("home");
          }}
          className="flex items-baseline cursor-pointer group flex-shrink-0"
        >
          <span className="text-xl sm:text-2xl font-black tracking-tighter text-white group-hover:text-zinc-200 transition-colors">
            RDX<span className="text-rose-500">.</span>
          </span>
        </div>

        {/* Navigation Tabs (Strictly no horizontal scrollbar or overflow) */}
        <nav className="flex items-center gap-3 sm:gap-5 lg:gap-6 py-0.5">
          {/* Primary Tabs (Always visible on all screen sizes) */}
          {PRIMARY_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  playButtonClickSound();
                  onTabChange(tab.id);
                }}
                className={cn(
                  "relative pb-1 text-xs sm:text-sm lg:text-[15px] tracking-wide transition-colors duration-200 whitespace-nowrap cursor-pointer",
                  isActive
                    ? "text-white font-semibold"
                    : "text-zinc-400 font-medium hover:text-zinc-100"
                )}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500 rounded-full transition-all" />
                )}
              </button>
            );
          })}

          {/* Secondary Tabs on Large Screens (>= 1280px) */}
          <div className="hidden xl:flex items-center gap-6">
            {SECONDARY_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    playButtonClickSound();
                    onTabChange(tab.id);
                  }}
                  className={cn(
                    "relative pb-1 text-xs sm:text-sm lg:text-[15px] tracking-wide transition-colors duration-200 whitespace-nowrap cursor-pointer",
                    isActive
                      ? "text-white font-semibold"
                      : "text-zinc-400 font-medium hover:text-zinc-100"
                  )}
                >
                  <span>{tab.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500 rounded-full transition-all" />
                  )}
                </button>
              );
            })}
          </div>

          {/* "Ще" Dropdown on Compact / Half-Screen (< 1280px) */}
          <div ref={dropdownRef} className="relative xl:hidden">
            <button
              onClick={() => {
                playButtonClickSound();
                setIsMoreOpen((prev) => !prev);
              }}
              className={cn(
                "relative flex items-center gap-1 pb-1 text-xs sm:text-sm tracking-wide transition-colors duration-200 whitespace-nowrap cursor-pointer",
                isSecondaryActive
                  ? "text-white font-semibold"
                  : "text-zinc-400 font-medium hover:text-zinc-100"
              )}
            >
              <span>{isSecondaryActive ? activeSecondaryLabel : "Ще"}</span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-200",
                  isMoreOpen && "rotate-180"
                )}
              />
              {isSecondaryActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500 rounded-full transition-all" />
              )}
            </button>

            {/* Dropdown Menu */}
            {isMoreOpen && (
              <div className="absolute left-0 mt-2 w-40 py-1.5 rounded-2xl bg-zinc-950/95 border border-white/10 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                {SECONDARY_TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        playButtonClickSound();
                        onTabChange(tab.id);
                        setIsMoreOpen(false);
                      }}
                      className={cn(
                        "w-full px-4 py-2 text-left text-xs sm:text-sm font-medium transition-colors flex items-center justify-between cursor-pointer",
                        isActive
                          ? "text-white bg-rose-600/20 font-semibold"
                          : "text-zinc-300 hover:text-white hover:bg-white/5"
                      )}
                    >
                      <span>{tab.label}</span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Right: Actions, Network Status & Clock */}
      <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
        {/* Quick Downloads Button */}
        <button
          onClick={() => {
            playButtonClickSound();
            onTabChange("downloads");
          }}
          title={
            activeDownloadsCount && activeDownloadsCount > 0
              ? `Завантаження: ${activeDownloadsCount} активних`
              : "Завантаження"
          }
          className={cn(
            "relative transition-colors cursor-pointer p-1",
            activeTab === "downloads"
              ? "text-rose-500"
              : activeDownloadsCount && activeDownloadsCount > 0
              ? "text-amber-400 animate-pulse"
              : "text-zinc-300 hover:text-white"
          )}
        >
          <Download className="w-5 h-5" />
          {activeDownloadsCount && activeDownloadsCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center font-mono shadow-sm">
              {activeDownloadsCount}
            </span>
          ) : null}
        </button>

        {/* Minimal Search Button */}
        <button
          onClick={() => {
            playButtonClickSound();
            onOpenSearch();
          }}
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
              "w-2 h-2 rounded-full flex-shrink-0",
              mirrorStatus?.online
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                : mirrorStatus
                ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                : "bg-emerald-400"
            )}
          />
          <span className="hidden xl:inline text-[13px]">{mirrorHost}</span>
        </button>

        {/* Settings Gear Button */}
        <button
          onClick={onOpenSettings || onOpenMirrorModal}
          title="Налаштування програми"
          className="text-zinc-300 hover:text-white transition-colors cursor-pointer p-1"
        >
          <Settings className="w-5 h-5" />
        </button>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Вийти з повного екрану" : "На весь екран"}
          className="hidden sm:inline-flex text-zinc-300 hover:text-white transition-colors cursor-pointer p-1"
        >
          {isFullscreen ? (
            <Minimize className="w-5 h-5" />
          ) : (
            <Maximize className="w-5 h-5" />
          )}
        </button>

        {/* Android TV Clock */}
        <span className="hidden lg:inline text-base sm:text-lg font-medium text-zinc-100 tracking-tight tabular-nums font-mono pl-1">
          {timeString}
        </span>
      </div>
    </header>
  );
};
