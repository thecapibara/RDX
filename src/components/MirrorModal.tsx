import React, { useState, useEffect } from "react";
import {
  X,
  Server,
  ShieldCheck,
  Plus,
  RefreshCw,
  ExternalLink,
  Check,
  Loader2,
} from "lucide-react";
import type { AppSettings, MirrorStatus } from "../types";
import { api } from "../services/api";
import { cn } from "../lib/utils";

interface MirrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMirrorChanged: (newMirror: string) => void;
}

const PRESET_MIRRORS = [
  "https://rezka-tv.org",
  "https://hdrezka.me",
  "https://rezka.ag",
  "https://hdrezka.ag",
  "https://hdrezka.ac",
];

export const MirrorModal: React.FC<MirrorModalProps> = ({
  isOpen,
  onClose,
  onMirrorChanged,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [proxyInput, setProxyInput] = useState("");
  const [testingStatus, setTestingStatus] = useState<Record<string, MirrorStatus>>({});
  const [testing, setTesting] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [captchaOpening, setCaptchaOpening] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setProxyInput(s.proxy_url || "");
      // Probe active mirror
      testMirror(s.active_mirror);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const testMirror = async (url: string) => {
    try {
      const status = await api.checkMirrorStatus(url);
      setTestingStatus((prev) => ({ ...prev, [url]: status }));
      return status;
    } catch (err) {
      console.error("Test mirror failed:", err);
      return null;
    }
  };

  const handleTestAll = async () => {
    if (!settings) return;
    setTesting(true);
    const allUrls = Array.from(
      new Set([
        settings.active_mirror,
        ...PRESET_MIRRORS,
        ...settings.custom_mirrors,
      ])
    );

    for (const url of allUrls) {
      await testMirror(url);
    }
    setTesting(false);
  };

  const handleSelectMirror = async (mirrorUrl: string) => {
    try {
      await api.setActiveMirror(mirrorUrl);
      setSettings((prev) => (prev ? { ...prev, active_mirror: mirrorUrl } : null));
      onMirrorChanged(mirrorUrl);
    } catch (err) {
      console.error("Failed to set active mirror:", err);
    }
  };

  const handleAddCustomMirror = async () => {
    if (!customInput.trim() || !settings) return;
    let url = customInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    url = url.replace(/\/+$/, "");

    const updatedCustom = Array.from(new Set([...settings.custom_mirrors, url]));
    const updatedSettings: AppSettings = {
      ...settings,
      custom_mirrors: updatedCustom,
    };

    try {
      await api.updateSettings(updatedSettings);
      setSettings(updatedSettings);
      setCustomInput("");
      testMirror(url);
    } catch (err) {
      console.error("Failed to add custom mirror:", err);
    }
  };

  const handleSaveProxy = async () => {
    if (!settings) return;
    setSavingProxy(true);
    const updatedSettings: AppSettings = {
      ...settings,
      proxy_url: proxyInput.trim(),
    };
    try {
      await api.updateSettings(updatedSettings);
      setSettings(updatedSettings);
    } catch (err) {
      console.error("Failed to save proxy:", err);
    } finally {
      setSavingProxy(false);
    }
  };

  const handleOpenCaptcha = async () => {
    setCaptchaOpening(true);
    try {
      await api.openCaptchaWindow(settings?.active_mirror);
    } catch (err) {
      console.error("Failed to open captcha window:", err);
    } finally {
      setCaptchaOpening(false);
    }
  };

  if (!isOpen) return null;

  const allMirrors = Array.from(
    new Set([
      ...(settings?.active_mirror ? [settings.active_mirror] : []),
      ...PRESET_MIRRORS,
      ...(settings?.custom_mirrors || []),
    ])
  );

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-rose-950/50">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                Керування дзеркалами та мережею
              </h2>
              <p className="text-xs text-zinc-400">
                Виберіть робоче дзеркало HDRezka або налаштуйте проксі для обходу блокувань
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Captcha Bridge Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/40 via-zinc-900 to-zinc-900 border border-rose-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 text-rose-500 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-white">
                  Перевірка Cloudflare / "Я не робот"
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Якщо сайт вимагає проходження капчі або не завантажує каталог — відкрийте вбудоване вікно підтвердження.
                </p>
              </div>
            </div>
            <button
              onClick={handleOpenCaptcha}
              disabled={captchaOpening}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-semibold text-xs transition-all shadow-md shadow-rose-950/40 flex-shrink-0 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Вікно Captcha Bridge</span>
            </button>
          </div>

          {/* Mirrors List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                Доступні дзеркала
              </h3>
              <button
                onClick={handleTestAll}
                disabled={testing}
                className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors font-medium cursor-pointer"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", testing && "animate-spin")}
                />
                <span>Перевірити всі</span>
              </button>
            </div>

            <div className="space-y-2">
              {allMirrors.map((url) => {
                const isActive = settings?.active_mirror === url;
                const status = testingStatus[url];

                return (
                  <div
                    key={url}
                    onClick={() => handleSelectMirror(url)}
                    className={cn(
                      "flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer",
                      isActive
                        ? "bg-rose-950/20 border-rose-500/50 shadow-md"
                        : "bg-zinc-900/60 hover:bg-zinc-900 border-white/5 hover:border-white/10"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "w-3 h-3 rounded-full flex-shrink-0",
                          status?.online
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                            : status
                            ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
                            : "bg-zinc-600"
                        )}
                      />
                      <span className="font-mono text-xs sm:text-sm text-zinc-200 truncate">
                        {url}
                      </span>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-600/90 text-white uppercase tracking-wider">
                          Активне
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {status && (
                        <span
                          className={cn(
                            "text-xs font-mono font-medium",
                            status.online ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {status.online ? `${status.latency_ms} ms` : "Помилка"}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          testMirror(url);
                        }}
                        title="Перевірити пінг"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add Custom Mirror Input */}
            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="https://нове-дзеркало.com"
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500"
              />
              <button
                onClick={handleAddCustomMirror}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/15 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Додати</span>
              </button>
            </div>
          </div>

          {/* Proxy Configuration */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
              Налаштування проксі (опціонально)
            </h3>
            <p className="text-xs text-zinc-400">
              Підтримуються формати HTTP/HTTPS або SOCKS5 (наприклад: `http://127.0.0.1:8080` або `socks5://127.0.0.1:1080`).
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                placeholder="http://127.0.0.1:8080"
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500 font-mono"
              />
              <button
                onClick={handleSaveProxy}
                disabled={savingProxy}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                {savingProxy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Зберегти</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
