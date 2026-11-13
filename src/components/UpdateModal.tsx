import React, { useState, useEffect } from "react";
import { Sparkles, Download, Clock, X, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import type { UpdateInfo, ReleaseAsset } from "../services/updater";
import { postponeUpdate, dismissUpdate } from "../services/updater";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import { check } from "@tauri-apps/plugin-updater";

interface UpdateModalProps {
  update: UpdateInfo | null;
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  update,
  isOpen,
  onClose,
}) => {
  const [selectedAsset, setSelectedAsset] = useState<ReleaseAsset | undefined>(update?.asset);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [downloadedBytes, setDownloadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [isReadyToRestart, setIsReadyToRestart] = useState(false);
  const [statusText, setStatusText] = useState<string>("");

  useEffect(() => {
    if (update?.asset) {
      setSelectedAsset(update.asset);
    }
  }, [update]);

  // Parse markdown changelog into clean formatted lines (Hook called unconditionally at top)
  const cleanChangelogItems = React.useMemo(() => {
    if (!update?.changelog) return [];

    let text = update.changelog;

    // If bilingual release notes, prioritize Ukrainian section
    if (text.includes("### 🇺🇦")) {
      const parts = text.split("### 🇬🇧");
      text = parts[0];
    }

    // Split and filter out raw markdown table, headers, hr
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false;
        if (l.startsWith("##") || l.startsWith("###") || l.startsWith("---") || l.startsWith("|")) return false;
        if (l.toLowerCase().includes("cross-platform native desktop")) return false;
        return true;
      })
      .map((line) => line.replace(/^[•\-\*]\s*/, ""));
  }, [update?.changelog]);

  // Classify available assets into user-friendly packages
  const allAssets = update?.allAssets || (update?.asset ? [update.asset] : []);
  const installablePackages = allAssets
    .filter((asset) => {
      const n = asset.name.toLowerCase();
      return (
        n.endsWith(".appimage") ||
        n.endsWith(".rpm") ||
        n.endsWith(".deb") ||
        n.endsWith(".exe") ||
        n.endsWith(".msi") ||
        n.endsWith(".dmg")
      );
    })
    .map((asset) => {
      const n = asset.name.toLowerCase();
      if (n.endsWith(".appimage")) return { id: "appimage", label: "AppImage", sub: "Універсальний", badge: "⚡", asset };
      if (n.endsWith(".rpm")) return { id: "rpm", label: ".rpm", sub: "Fedora / RHEL", badge: "📦", asset };
      if (n.endsWith(".deb")) return { id: "deb", label: ".deb", sub: "Ubuntu / Debian", badge: "📦", asset };
      if (n.endsWith(".exe")) return { id: "exe", label: "Setup.exe", sub: "Windows", badge: "🪟", asset };
      if (n.endsWith(".msi")) return { id: "msi", label: ".msi", sub: "Windows MSI", badge: "🪟", asset };
      if (n.endsWith(".dmg")) return { id: "dmg", label: ".dmg", sub: "macOS", badge: "🍎", asset };
      return { id: "other", label: asset.name, sub: "", badge: "📦", asset };
    });

  const activeAsset = selectedAsset || update?.asset || installablePackages[0]?.asset;

  if (!isOpen || !update) return null;

  const handleInstallNow = async () => {
    // If ready to restart, trigger instant native app restart
    if (isReadyToRestart) {
      await api.restartApp();
      return;
    }

    const targetUrl = activeAsset?.browser_download_url || update.releaseUrl;

    // Check if the user selected a custom/foreign package (e.g. .deb or .rpm manually)
    const isCustomNonNative = selectedAsset && update.asset && selectedAsset.name !== update.asset.name;
    if (isCustomNonNative) {
      await api.openUrl(targetUrl);
      onClose();
      return;
    }

    // Try silent In-App OTA Update via Tauri plugin
    try {
      setIsUpdating(true);
      setStatusText("Перевірка та підготовка оновлення...");
      setUpdateProgress(0);

      const tauriUpdate = await check();
      if (tauriUpdate) {
        setStatusText("Завантаження оновлення...");
        let total = 0;
        let downloaded = 0;

        await tauriUpdate.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength || 0;
            setTotalBytes(total);
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            setDownloadedBytes(downloaded);
            if (total > 0) {
              const pct = Math.min(100, Math.round((downloaded / total) * 100));
              setUpdateProgress(pct);
            }
          } else if (event.event === "Finished") {
            setUpdateProgress(100);
            setStatusText("Оновлення встановлено! Потрібен перезапуск.");
            setIsReadyToRestart(true);
          }
        });

        setIsReadyToRestart(true);
        setStatusText("Оновлення готове! Натисніть для перезапуску.");
      } else {
        // Fallback: If updater plugin returns no update or latest.json is unavailable
        await api.openUrl(targetUrl);
        onClose();
      }
    } catch (err) {
      console.warn("[Updater] Silent update failed, falling back to direct browser download:", err);
      await api.openUrl(targetUrl);
      onClose();
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePostpone = () => {
    postponeUpdate(24);
    onClose();
  };

  const handleDismiss = () => {
    dismissUpdate(update.version);
    onClose();
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-3xl bg-zinc-950 border border-rose-500/30 shadow-2xl shadow-rose-950/60 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner Hero: Clean Graphic Without Text Clutter */}
        <div className="relative h-36 sm:h-40 w-full overflow-hidden shrink-0 select-none">
          <img
            src="/banner.jpg"
            alt="RDX"
            className="w-full h-full object-cover object-center filter brightness-95"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

          {/* Close button top right */}
          <button
            onClick={onClose}
            className="absolute top-3.5 right-3.5 p-2 rounded-full bg-black/60 hover:bg-black/90 text-zinc-400 hover:text-white transition-all cursor-pointer backdrop-blur-md border border-white/10 active:scale-95 shadow-lg"
            title="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 pt-3 space-y-4 overflow-y-auto flex-1 text-sm text-zinc-300">
          {/* Header Info Bar */}
          <div className="space-y-2 border-b border-white/10 pb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/35 text-[11px] font-bold text-rose-300">
                  <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                  <span>Доступне оновлення</span>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono">
                  <span className="text-zinc-400">v{update.currentVersion}</span>
                  <ArrowRight className="w-3 h-3 text-rose-400" />
                  <span className="font-bold text-rose-300">v{update.version}</span>
                </div>
              </div>

              {update.publishedAt && (
                <span className="text-xs text-zinc-400 font-medium">
                  {update.publishedAt}
                </span>
              )}
            </div>

            <div>
              <h3 className="font-black text-white text-lg tracking-tight">
                {update.releaseName}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Рекомендоване оновлення для стабільної роботи та нового функціоналу.
              </p>
            </div>
          </div>

          {/* Package Selector */}
          {installablePackages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-400 uppercase tracking-wider">
                  Пакет для вашої системи:
                </span>
                <span className="text-zinc-500 text-[11px]">
                  {installablePackages.length} доступно
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {installablePackages.map((pkg) => {
                  const isSelected = activeAsset?.name === pkg.asset.name;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      disabled={isUpdating}
                      onClick={() => setSelectedAsset(pkg.asset)}
                      className={cn(
                        "relative p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 group",
                        isSelected
                          ? "bg-rose-500/10 border-rose-500/60 shadow-lg shadow-rose-950/40"
                          : "bg-white/[0.03] border-white/5 hover:border-white/15 hover:bg-white/[0.06]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>{pkg.badge}</span>
                          <span className="truncate">{pkg.label}</span>
                        </span>
                        {isSelected && (
                          <span className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[10px] shrink-0 font-black">
                            ✓
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 truncate">
                        {pkg.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Download & Install Progress Bar (if in-app update in progress) */}
          {(isUpdating || isReadyToRestart) && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-rose-200 flex items-center gap-1.5">
                  {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" /> : <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />}
                  <span>{statusText || "Оновлення..."}</span>
                </span>
                <span className="font-mono text-zinc-300 font-bold">
                  {totalBytes > 0
                    ? `${(downloadedBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB (${updateProgress}%)`
                    : `${updateProgress}%`}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-rose-600 via-rose-500 to-emerald-400 transition-all duration-200"
                  style={{ width: `${Math.max(5, updateProgress)}%` }}
                />
              </div>
            </div>
          )}

          {/* Active Asset Info Pill */}
          {activeAsset && !isUpdating && !isReadyToRestart ? (
            <div className="flex items-center justify-between text-xs px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/5">
              <span className="text-zinc-300 truncate max-w-[70%] font-mono text-[11px]">
                {activeAsset.name}
              </span>
              {activeAsset.size ? (
                <span className="text-zinc-400 font-mono shrink-0">
                  {formatFileSize(activeAsset.size)}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Changelog Section: Formatted & Styled */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Що нового:
            </span>
            <div className="p-4 rounded-2xl bg-zinc-900/90 border border-white/10 max-h-48 overflow-y-auto space-y-2.5 select-text">
              {cleanChangelogItems.length > 0 ? (
                cleanChangelogItems.map((line, idx) => {
                  const parts = line.split(/\*\*(.*?)\*\*/);
                  return (
                    <div key={idx} className="flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0 shadow-sm shadow-rose-500/50" />
                      <div className="flex-1">
                        {parts.length >= 3 ? (
                          <>
                            <span className="font-bold text-rose-200">{parts[1]}</span>
                            <span>{parts.slice(2).join("")}</span>
                          </>
                        ) : (
                          <span>{line}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-zinc-400 leading-relaxed">
                  {update.changelog}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-5 border-t border-white/10 bg-zinc-950/80 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            onClick={handleDismiss}
            disabled={isUpdating}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer order-3 sm:order-1 disabled:opacity-50"
          >
            Пропустити цю версію
          </button>

          <div className="flex items-center gap-2.5 w-full sm:w-auto order-1 sm:order-2">
            {!isReadyToRestart && (
              <button
                onClick={handlePostpone}
                disabled={isUpdating}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                <span>Нагадати завтра</span>
              </button>
            )}

            <button
              onClick={handleInstallNow}
              disabled={isUpdating}
              className={cn(
                "flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl font-bold text-xs shadow-xl active:scale-95 transition-all cursor-pointer disabled:opacity-50",
                isReadyToRestart
                  ? "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-950/60"
                  : "bg-gradient-to-r from-rose-700 via-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-400 text-white shadow-rose-950/60"
              )}
            >
              {isReadyToRestart ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin-reverse" />
                  <span>Перезапустити зараз</span>
                </>
              ) : isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Завантаження...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Встановити оновлення</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
