import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Server,
  ShieldCheck,
  Plus,
  RefreshCw,
  ExternalLink,
  Check,
  Loader2,
  Zap,
  Shield,
  Shuffle,
  Trash2,
  Settings,
  Film,
  Info,
  Crown,
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
  "https://rezka.ag",
  "https://hdrezka.me",
  "https://hdrezka.sh",
  "https://hdrezka.kim",
  "https://rezka.pub",
];

export const MirrorModal: React.FC<MirrorModalProps> = ({
  isOpen,
  onClose,
  onMirrorChanged,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeModalTab, setActiveModalTab] = useState<"network" | "playback" | "about">("network");
  const [preferredQuality, setPreferredQuality] = useState<string>("720p");
  const [preferredTranslator, setPreferredTranslator] = useState<string>("");
  const [customInput, setCustomInput] = useState("");
  const [proxyInput, setProxyInput] = useState("");
  const [testingStatus, setTestingStatus] = useState<Record<string, MirrorStatus>>({});
  const [testing, setTesting] = useState(false);
  const [smartRotating, setSmartRotating] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [captchaOpening, setCaptchaOpening] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAndProbeAll();
    }
  }, [isOpen]);

  const loadAndProbeAll = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setProxyInput(s.proxy_url || "");
      setPreferredQuality(s.preferred_quality || "720p");
      setPreferredTranslator(s.preferred_translator || "");

      const urls = Array.from(
        new Set([
          s.active_mirror,
          ...PRESET_MIRRORS,
          ...(s.custom_mirrors || []).filter((m) => m !== "https://hdrezka.ac" && m !== "https://hdrezka.ag"),
        ])
      );

      setTesting(true);
      const statuses = await api.checkAllMirrors(urls);
      const map: Record<string, MirrorStatus> = {};
      for (const st of statuses) {
        map[st.mirror_url] = st;
      }
      setTestingStatus((prev) => ({ ...prev, ...map }));
    } catch (err) {
      console.error("Failed to load settings or probe mirrors:", err);
    } finally {
      setTesting(false);
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
    try {
      const allUrls = Array.from(
        new Set([
          settings.active_mirror,
          ...PRESET_MIRRORS,
          ...settings.custom_mirrors.filter((m) => m !== "https://hdrezka.ac" && m !== "https://hdrezka.ag"),
        ])
      );
      const statuses = await api.checkAllMirrors(allUrls);
      const map: Record<string, MirrorStatus> = {};
      for (const st of statuses) {
        map[st.mirror_url] = st;
      }
      setTestingStatus((prev) => ({ ...prev, ...map }));
    } catch (err) {
      console.error("Parallel mirror check failed:", err);
    } finally {
      setTesting(false);
    }
  };

  const handleSmartSelect = async (forceRotate = false) => {
    setSmartRotating(true);
    try {
      const res = await api.smartSelectMirror(forceRotate);
      const map: Record<string, MirrorStatus> = {};
      for (const st of res.statuses) {
        map[st.mirror_url] = st;
      }
      setTestingStatus((prev) => ({ ...prev, ...map }));

      const updated = await api.getSettings();
      setSettings(updated);

      if (res.selected_mirror) {
        onMirrorChanged(res.selected_mirror);
      }
    } catch (err) {
      console.error("Smart mirror rotation failed:", err);
    } finally {
      setSmartRotating(false);
    }
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

  const handleRemoveCustomMirror = async (urlToRemove: string) => {
    if (!settings) return;
    const updatedCustom = settings.custom_mirrors.filter((u) => u !== urlToRemove);
    const updatedSettings: AppSettings = {
      ...settings,
      custom_mirrors: updatedCustom,
    };
    try {
      await api.updateSettings(updatedSettings);
      setSettings(updatedSettings);
    } catch (err) {
      console.error("Failed to remove custom mirror:", err);
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

  const handleSelectDefaultQuality = async (q: string) => {
    if (!settings) return;
    setPreferredQuality(q);
    try {
      localStorage.setItem("rdx_preferred_quality", q);
    } catch {}
    const updatedSettings: AppSettings = { ...settings, preferred_quality: q };
    setSettings(updatedSettings);
    await api.updateSettings(updatedSettings).catch(console.warn);
  };

  const handleSaveTranslator = async (t: string) => {
    if (!settings) return;
    setPreferredTranslator(t);
    const updatedSettings: AppSettings = { ...settings, preferred_translator: t.trim() };
    setSettings(updatedSettings);
    await api.updateSettings(updatedSettings).catch(console.warn);
  };

  const allMirrors = useMemo(() => {
    const raw = Array.from(
      new Set([
        ...(settings?.active_mirror ? [settings.active_mirror] : []),
        ...PRESET_MIRRORS,
        ...(settings?.custom_mirrors || []).filter(
          (m) => m !== "https://hdrezka.ac" && m !== "https://hdrezka.ag"
        ),
      ])
    );

    // Sort: active mirror first, then online by latency, then untested/offline
    return raw.sort((a, b) => {
      if (a === settings?.active_mirror) return -1;
      if (b === settings?.active_mirror) return 1;
      const sa = testingStatus[a];
      const sb = testingStatus[b];
      if (sa?.online && sb?.online) return sa.latency_ms - sb.latency_ms;
      if (sa?.online && !sb?.online) return -1;
      if (!sa?.online && sb?.online) return 1;
      return 0;
    });
  }, [settings, testingStatus]);

  const fastestUrl = useMemo(() => {
    let bestUrl: string | null = null;
    let bestMs = Infinity;
    for (const [url, st] of Object.entries(testingStatus)) {
      if (st.online && st.latency_ms > 0 && st.latency_ms < bestMs) {
        bestMs = st.latency_ms;
        bestUrl = url;
      }
    }
    return bestUrl;
  }, [testingStatus]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-rose-950/50">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">
                Налаштування RDX
              </h2>
              <p className="text-xs text-zinc-400">
                Дзеркала HDRezka, DoH-обхід блокувань, проксі та відтворення
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

        {/* Modal Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-2 border-b border-white/10 bg-zinc-950">
          <button
            onClick={() => setActiveModalTab("network")}
            className={cn(
              "px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-xl transition-colors cursor-pointer flex items-center gap-2",
              activeModalTab === "network"
                ? "bg-white/10 text-white border-b-2 border-rose-500"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Server className="w-4 h-4" />
            <span>Мережа та Дзеркала</span>
          </button>
          <button
            onClick={() => setActiveModalTab("playback")}
            className={cn(
              "px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-xl transition-colors cursor-pointer flex items-center gap-2",
              activeModalTab === "playback"
                ? "bg-white/10 text-white border-b-2 border-rose-500"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Film className="w-4 h-4" />
            <span>Відтворення</span>
          </button>
          <button
            onClick={() => setActiveModalTab("about")}
            className={cn(
              "px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-xl transition-colors cursor-pointer flex items-center gap-2",
              activeModalTab === "about"
                ? "bg-white/10 text-white border-b-2 border-rose-500"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Info className="w-4 h-4" />
            <span>Про програму</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {activeModalTab === "network" && (
            <>
              {/* Smart Mirror Rotator Hero Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-rose-950/30 to-zinc-900 border border-indigo-500/25 flex flex-col gap-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 flex-shrink-0 mt-0.5">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-white">
                      Smart Rotator + DNS-over-HTTPS (DoH)
                    </h4>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                      Активно без VPN
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Провайдери часто підміняють DNS для <span className="text-zinc-200 font-mono">rezka.ag</span> та <span className="text-zinc-200 font-mono">hdrezka.me</span> на <span className="text-rose-400 font-mono">127.0.0.1</span>. Вбудований DoH-резолвер RDX автоматично отримує реальні IP кластера та відкриває заблоковані дзеркала напряму.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                onClick={() => handleSmartSelect(false)}
                disabled={smartRotating || testing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 active:scale-95 text-white font-bold text-xs transition-all shadow-lg shadow-rose-950/40 cursor-pointer disabled:opacity-50"
              >
                {smartRotating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>Знайти та увімкнути найшвидше</span>
              </button>

              <button
                onClick={() => handleSmartSelect(true)}
                disabled={smartRotating || testing}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/8 hover:bg-white/14 active:scale-95 text-zinc-200 font-semibold text-xs border border-white/10 transition-all cursor-pointer disabled:opacity-50"
              >
                <Shuffle className="w-3.5 h-3.5 text-indigo-400" />
                <span>Перемкнути на інше робоче</span>
              </button>

              <button
                onClick={handleOpenCaptcha}
                disabled={captchaOpening}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-medium text-xs border border-white/10 transition-all cursor-pointer"
                title="Відкрити вікно перевірки Cloudflare / Captcha"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                <span>Captcha Bridge</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </button>
            </div>
          </div>

          {/* Mirrors List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                Пул дзеркал ({allMirrors.length})
              </h3>
              <button
                onClick={handleTestAll}
                disabled={testing || smartRotating}
                className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors font-medium cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", (testing || smartRotating) && "animate-spin")}
                />
                <span>{testing ? "Перевірка паралельно..." : "Перевірити всі"}</span>
              </button>
            </div>

            <div className="space-y-2">
              {allMirrors.map((url) => {
                const isActive = settings?.active_mirror === url;
                const status = testingStatus[url];
                const isFastest = fastestUrl === url && status?.online;
                const isCustomOnly = !PRESET_MIRRORS.includes(url) && !isActive;

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
                    <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                      <div
                        className={cn(
                          "w-3 h-3 rounded-full flex-shrink-0",
                          status?.online
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                            : status
                            ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
                            : "bg-zinc-600 animate-pulse"
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
                      {status?.doh_bypass && status.online && (
                        <span
                          title="Розблоковано через DNS-over-HTTPS (обхід блокування провайдера)"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                        >
                          <Shield className="w-2.5 h-2.5" />
                          DoH
                        </span>
                      )}
                      {isFastest && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <Zap className="w-2.5 h-2.5" />
                          Найшвидше
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      {status ? (
                        <div className="flex items-center gap-2 text-right">
                          <span
                            className={cn(
                              "text-xs font-mono font-medium",
                              status.online ? "text-emerald-400" : "text-rose-400"
                            )}
                          >
                            {status.online
                              ? `${status.latency_ms} ms`
                              : status.status_message || "Помилка"}
                          </span>
                        </div>
                      ) : testing ? (
                        <span className="text-[11px] text-zinc-500 font-mono">Пінг...</span>
                      ) : null}

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

                      {isCustomOnly && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveCustomMirror(url);
                          }}
                          title="Видалити дзеркало"
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustomMirror();
                }}
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
            </>
          )}

          {/* ================= TAB: PLAYBACK ================= */}
          {activeModalTab === "playback" && (
            <div className="space-y-6">
              {/* Default Quality Card */}
              <div className="p-5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <Film className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Бажана якість відео за замовчуванням</h4>
                    <p className="text-xs text-zinc-400">
                      RDX автоматично обиратиме цю якість під час запуску будь-якого фільму чи серіалу
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  {[
                    { label: "1080p Ultra", isUltra: true },
                    { label: "1080p", isUltra: false },
                    { label: "720p", isUltra: false },
                    { label: "480p", isUltra: false },
                    { label: "360p", isUltra: false },
                  ].map((q) => {
                    const isSelected = preferredQuality === q.label;
                    return (
                      <button
                        key={q.label}
                        onClick={() => handleSelectDefaultQuality(q.label)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                          isSelected
                            ? "bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-950/40"
                            : "bg-zinc-800/60 border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        )}
                      >
                        {q.isUltra && <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30 flex-shrink-0" />}
                        <span>{q.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Default Translation / Studio Card */}
              <div className="p-5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Пріоритетна озвучка</h4>
                    <p className="text-xs text-zinc-400">
                      Плеєр спробує автоматично вибрати озвучку, якщо її назва збігається
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={preferredTranslator}
                    onChange={(e) => handleSaveTranslator(e.target.value)}
                    placeholder="Наприклад: Український, HDRezka Studio"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Quick Suggestion Chips */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-zinc-500">Швидкі пресети:</span>
                  {["Український", "HDRezka Studio", "Оригінал"].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handleSaveTranslator(preset)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer",
                        preferredTranslator === preset
                          ? "bg-rose-600/30 border-rose-500/50 text-rose-300"
                          : "bg-white/5 border-white/10 text-zinc-400 hover:text-white"
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multimedia Engine Card */}
              <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-2">
                <div className="text-xs font-semibold text-zinc-300">Апаратне декодування та буферизація</div>
                <div className="text-[11px] text-zinc-400 leading-relaxed">
                  Відеоплеєр RDX використовує ядро <span className="text-zinc-200 font-mono">WebKitGTK 2.4x</span> на базі системного <span className="text-zinc-200 font-mono">GStreamer</span> (VAAPI/NVDEC) та розширення <span className="text-zinc-200 font-mono">HLS.js MSE</span> зі збільшеним буфером 120 секунд для плавного мотання.
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB: ABOUT ================= */}
          {activeModalTab === "about" && (
            <div className="space-y-6">
              {/* Brand Card */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-rose-950/40 via-zinc-900 to-indigo-950/40 border border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-black tracking-tight text-white flex items-baseline">
                    RDX<span className="text-rose-500">.</span>
                    <span className="text-xs font-semibold text-zinc-400 ml-2 tracking-normal">v0.1.0 (Beta)</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Сучасний кросплатформний клієнт для HDRezka у стилі Android TV / Spotify Desktop
                  </p>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs font-mono text-zinc-300">
                  Rust + Tauri v2
                </div>
              </div>

              {/* Shortcuts Grid */}
              <div className="p-5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Гарячі клавіші плеєра</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Відтворення / Пауза</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">Space / K</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Перемотка назад / вперед</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">← / → (±5с)</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Велика перемотка</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">Shift + ← / → (±30с)</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Гучність</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">↑ / ↓ (±5%)</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Без звуку (Mute)</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">M</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Повний екран</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">F</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Повтор відрізка A–B</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">L</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Зробити скріншот кадру</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">S</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Статистика потоку</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">I</kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                    <span className="text-zinc-400">Швидкий пошук</span>
                    <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">Ctrl + K</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
