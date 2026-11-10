import React from "react";
import { Sparkles, Download, Clock, X, ArrowRight, Package } from "lucide-react";
import type { UpdateInfo } from "../services/updater";
import { postponeUpdate, dismissUpdate } from "../services/updater";
import { api } from "../services/api";

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
  if (!isOpen || !update) return null;

  const handleInstallNow = async () => {
    const targetUrl = update.asset?.browser_download_url || update.releaseUrl;
    await api.openUrl(targetUrl);
    onClose();
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
        {/* Banner Hero with Gradient Overlay */}
        <div className="relative h-44 sm:h-48 w-full overflow-hidden shrink-0 select-none">
          <img
            src="/banner.jpg"
            alt="RDX"
            className="w-full h-full object-cover object-center filter brightness-90"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

          {/* Close button top right */}
          <button
            onClick={onClose}
            className="absolute top-3.5 right-3.5 p-2 rounded-full bg-black/50 hover:bg-black/80 text-zinc-400 hover:text-white transition-all cursor-pointer backdrop-blur-sm border border-white/10"
            title="Закрити"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Hero Content */}
          <div className="absolute bottom-3 left-6 right-6 flex items-end justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-[11px] font-bold text-rose-300 backdrop-blur-sm">
                <Sparkles className="w-3 h-3 text-rose-400" />
                <span>Доступне оновлення RDX</span>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-xs font-mono text-zinc-400">v{update.currentVersion}</span>
                <ArrowRight className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-base sm:text-lg font-black text-rose-300 font-mono tracking-tight bg-rose-950/60 px-2 py-0.5 rounded-lg border border-rose-500/40">
                  v{update.version}
                </span>
              </div>
            </div>

            {update.publishedAt && (
              <span className="text-[11px] text-zinc-400 font-medium">
                {update.publishedAt}
              </span>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-sm text-zinc-300">
          {/* Release Name */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <h3 className="font-bold text-white text-base">
                {update.releaseName}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Рекомендоване оновлення для стабільної роботи та нового функціоналу.
              </p>
            </div>
          </div>

          {/* Platform Package Info Pill if asset detected */}
          {update.asset && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-zinc-300">
              <div className="flex items-center gap-2.5 min-w-0">
                <Package className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate font-mono font-medium text-zinc-200">
                  {update.asset.name}
                </span>
              </div>
              {update.asset.size > 0 && (
                <span className="text-zinc-400 font-mono shrink-0">
                  {formatFileSize(update.asset.size)}
                </span>
              )}
            </div>
          )}

          {/* Changelog Section */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Що нового:
            </span>
            <div className="p-3.5 rounded-2xl bg-zinc-900/90 border border-white/10 text-xs sm:text-sm text-zinc-300 leading-relaxed font-sans max-h-48 overflow-y-auto whitespace-pre-line space-y-1 select-text">
              {update.changelog}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-5 border-t border-white/10 bg-zinc-950/80 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            onClick={handleDismiss}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer order-3 sm:order-1"
          >
            Пропустити цю версію
          </button>

          <div className="flex items-center gap-2.5 w-full sm:w-auto order-1 sm:order-2">
            <button
              onClick={handlePostpone}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer active:scale-95"
            >
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Нагадати завтра</span>
            </button>

            <button
              onClick={handleInstallNow}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-rose-700 via-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-400 text-white font-bold text-xs shadow-xl shadow-rose-950/60 active:scale-95 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Встановити оновлення</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
