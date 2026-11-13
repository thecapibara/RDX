import React, { useState, useEffect } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/utils";

interface WindowControlsProps {
  className?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({ className }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  const isTauri =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

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
  );
};
