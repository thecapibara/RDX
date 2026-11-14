import React, { useState, useEffect } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/utils";

export type WindowControlsMode = "auto" | "always" | "never";

let tilingWmPromise: Promise<boolean> | null = null;
function detectTilingWm(): Promise<boolean> {
  if (!tilingWmPromise) {
    tilingWmPromise = invoke<boolean>("is_tiling_wm").catch(() => false);
  }
  return tilingWmPromise;
}

interface WindowControlsProps {
  className?: string;
  showDivider?: boolean;
}

export const WindowControls: React.FC<WindowControlsProps> = ({ className, showDivider }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTiling, setIsTiling] = useState(false);
  const [mode, setMode] = useState<WindowControlsMode>(() => {
    try {
      const saved = localStorage.getItem("rdx_window_controls");
      if (saved === "always" || saved === "never" || saved === "auto") {
        return saved;
      }
    } catch {}
    return "auto";
  });

  const isTauri =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  useEffect(() => {
    const onModeChanged = () => {
      try {
        const saved = localStorage.getItem("rdx_window_controls");
        setMode(
          saved === "always" || saved === "never" || saved === "auto"
            ? saved
            : "auto"
        );
      } catch {}
    };
    window.addEventListener("rdx:window-controls-changed", onModeChanged);
    return () =>
      window.removeEventListener("rdx:window-controls-changed", onModeChanged);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    detectTilingWm().then(setIsTiling);
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();

    win.isMaximized().then(setIsMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setIsMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [isTauri]);

  if (!isTauri) return null;
  if (mode === "never" || (mode === "auto" && isTiling)) return null;

  const handleMinimize = () => {
    getCurrentWindow().minimize().catch(() => {});
  };

  const handleToggleMaximize = () => {
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  const handleClose = () => {
    getCurrentWindow().close().catch(() => {});
  };

  return (
    <>
      {showDivider && <div className="h-5 w-px bg-white/10 hidden sm:block" />}
      <div className={cn("flex items-center gap-1 flex-shrink-0", className)}>
      <button
        type="button"
        onClick={handleMinimize}
        title="Згорнути"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={handleToggleMaximize}
        title={isMaximized ? "Відновити" : "Розгорнути"}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
      >
        {isMaximized ? (
          <Copy className="w-3.5 h-3.5" />
        ) : (
          <Square className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={handleClose}
        title="Закрити"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-rose-600/90 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
      </div>
    </>
  );
};
