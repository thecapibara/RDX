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
  Film,
  Info,
  Crown,
  Sparkles,
  Volume2,
  Sliders,
  Monitor,
  Eye,
} from "lucide-react";
import type { AppSettings, MirrorStatus } from "../types";
import { api } from "../services/api";
import { cn } from "../lib/utils";
import {
  getUiSoundsEnabled,
  setUiSoundsEnabled,
  playModalOpenSound,
} from "../services/sound";

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
  const [activeModalTab, setActiveModalTab] = useState<
    "network" | "playback" | "appearance" | "about"
  >("network");
  const [preferredQuality, setPreferredQuality] = useState<string>("720p");
  const [preferredTranslator, setPreferredTranslator] = useState<string>("");
  const [customInput, setCustomInput] = useState("");
  const [proxyInput, setProxyInput] = useState("");
  const [testingStatus, setTestingStatus] = useState<Record<string, MirrorStatus>>({});
  const [testing, setTesting] = useState(false);
  const [smartRotating, setSmartRotating] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [captchaOpening, setCaptchaOpening] = useState(false);

  // Appearance & Sound Settings
  const [startupSound, setStartupSound] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rdx_startup_sound") !== "false";
    } catch {
      return true;
    }
  });
  const [ambientGlow, setAmbientGlow] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rdx_ambient_glow") !== "false";
    } catch {
      return true;
    }
  });
  const [uiSounds, setUiSounds] = useState<boolean>(() => {
    return getUiSoundsEnabled();
  });
  const [motion60fps, setMotion60fps] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rdx_motion_60fps") !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (isOpen) {
      loadAndProbeAll();

      // Lock background document scrolling while modal is open
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

  const loadAndProbeAll = async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setProxyInput(s.proxy_url || "");
      setPreferredQuality(s.preferred_quality || "720p");
      setPreferredTranslator(s.preferred_translator || "");
      if (s.startup_sound !== undefined) {
        setStartupSound(s.startup_sound);
      }

      const urls = Array.from(
        new Set([
          s.active_mirror,
          ...PRESET_MIRRORS,
          ...(s.custom_mirrors || []).filter(
            (m) => m !== "https://hdrezka.ac" && m !== "https://hdrezka.ag"
          ),
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
          ...settings.custom_mirrors.filter(
            (m) => m !== "https://hdrezka.ac" && m !== "https://hdrezka.ag"
          ),
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

  const handleToggleStartupSound = async (enabled: boolean) => {
    setStartupSound(enabled);
    try {
      localStorage.setItem("rdx_startup_sound", enabled ? "true" : "false");
    } catch {}
    if (settings) {
      const updatedSettings: AppSettings = { ...settings, startup_sound: enabled };
      setSettings(updatedSettings);
      await api.updateSettings(updatedSettings).catch(console.warn);
    }
  };

  const handleToggleUiSounds = (enabled: boolean) => {
    setUiSounds(enabled);
    setUiSoundsEnabled(enabled);
    if (enabled) {
      playModalOpenSound();
    }
  };

  const handleToggleAmbientGlow = (enabled: boolean) => {
    setAmbientGlow(enabled);
    try {
      localStorage.setItem("rdx_ambient_glow", enabled ? "true" : "false");
    } catch {}
  };

  const handleToggleMotion60fps = (enabled: boolean) => {
    setMotion60fps(enabled);
    try {
      localStorage.setItem("rdx_motion_60fps", enabled ? "true" : "false");
    } catch {}
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
      onWheel={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-hidden select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-[#0c0d12]/95 border border-white/10 rounded-3xl shadow-2xl shadow-black/90 overflow-hidden flex flex-col max-h-[88vh] backdrop-blur-2xl"
      >
        {/* Obsidian Glass Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/8 bg-zinc-950/70">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-600 to-rose-950 border border-rose-500/30 flex items-center justify-center text-white shadow-lg shadow-rose-950/50 flex-shrink-0">
              <span className="font-black text-sm tracking-tighter">RDX</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-baseline">
                  Налаштування RDX<span className="text-rose-500 text-lg leading-none">.</span>
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/5 border border-white/10 text-zinc-400">
                  v0.2.0
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Дзеркала HDRezka, DoH-обхід, відтворення, вигляд та гарячі клавіші
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/12 text-zinc-400 hover:text-white transition-all cursor-pointer border border-white/5 hover:border-white/15"
            title="Закрити налаштування (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2-Column TV Layout: Sidebar + Main Content */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left Navigation Rail */}
          <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-white/8 bg-zinc-950/40 p-3 space-y-1.5 flex-shrink-0 flex md:flex-col overflow-x-auto md:overflow-x-visible">
            {/* Tab 1: Network & Mirrors */}
            <button
              onClick={() => setActiveModalTab("network")}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left transition-all cursor-pointer flex-shrink-0",
                activeModalTab === "network"
                  ? "bg-rose-600/15 text-white border-l-2 border-rose-500 shadow-inner font-bold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 font-medium"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                  activeModalTab === "network"
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/5 text-zinc-400"
                )}
              >
                <Server className="w-4 h-4" />
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-bold leading-tight">Мережа та Дзеркала</div>
                <div className="text-[10px] text-zinc-500 font-normal mt-0.5">DoH, кластери, проксі</div>
              </div>
              <span className="md:hidden text-xs font-bold">Мережа</span>
            </button>

            {/* Tab 2: Playback */}
            <button
              onClick={() => setActiveModalTab("playback")}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left transition-all cursor-pointer flex-shrink-0",
                activeModalTab === "playback"
                  ? "bg-rose-600/15 text-white border-l-2 border-rose-500 shadow-inner font-bold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 font-medium"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                  activeModalTab === "playback"
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/5 text-zinc-400"
                )}
              >
                <Film className="w-4 h-4" />
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-bold leading-tight">Відтворення</div>
                <div className="text-[10px] text-zinc-500 font-normal mt-0.5">Якість, озвучка, буфер</div>
              </div>
              <span className="md:hidden text-xs font-bold">Відтворення</span>
            </button>

            {/* Tab 3: Appearance & Sound (NEW) */}
            <button
              onClick={() => setActiveModalTab("appearance")}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left transition-all cursor-pointer flex-shrink-0",
                activeModalTab === "appearance"
                  ? "bg-rose-600/15 text-white border-l-2 border-rose-500 shadow-inner font-bold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 font-medium"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                  activeModalTab === "appearance"
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/5 text-zinc-400"
                )}
              >
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-bold leading-tight">Вигляд та Звук</div>
                <div className="text-[10px] text-zinc-500 font-normal mt-0.5">Заставка, заставки, анімації</div>
              </div>
              <span className="md:hidden text-xs font-bold">Вигляд</span>
            </button>

            {/* Tab 4: About & Shortcuts */}
            <button
              onClick={() => setActiveModalTab("about")}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left transition-all cursor-pointer flex-shrink-0",
                activeModalTab === "about"
                  ? "bg-rose-600/15 text-white border-l-2 border-rose-500 shadow-inner font-bold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 font-medium"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                  activeModalTab === "about"
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-white/5 text-zinc-400"
                )}
              >
                <Info className="w-4 h-4" />
              </div>
              <div className="hidden md:block">
                <div className="text-xs font-bold leading-tight">Про програму</div>
                <div className="text-[10px] text-zinc-500 font-normal mt-0.5">Гарячі клавіші • justgl</div>
              </div>
              <span className="md:hidden text-xs font-bold">Про нас</span>
            </button>
          </div>

          {/* Right Content Pane */}
          <div className="flex-1 p-5 sm:p-6 overflow-y-auto space-y-6">
            {/* ================= TAB 1: NETWORK & MIRRORS ================= */}
            {activeModalTab === "network" && (
              <div className="space-y-6">
                {/* Smart Mirror Rotator Card */}
                <div className="p-4.5 rounded-2xl bg-gradient-to-br from-zinc-900/90 via-zinc-900/50 to-zinc-950 border border-rose-500/20 flex flex-col gap-3.5 shadow-xl shadow-black/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 flex-shrink-0 mt-0.5">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-white tracking-tight">
                            Smart Rotator + DNS-over-HTTPS (DoH)
                          </h4>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                            АКТИВНО БЕЗ VPN
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                          Провайдери часто підміняють DNS для{" "}
                          <span className="text-zinc-200 font-mono">rezka.ag</span> та{" "}
                          <span className="text-zinc-200 font-mono">hdrezka.me</span> на{" "}
                          <span className="text-rose-400 font-mono">127.0.0.1</span>. Вбудований
                          DoH-резолвер RDX автоматично отримує реальні IP кластера та відкриває
                          заблоковані дзеркала напряму.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      onClick={() => handleSmartSelect(false)}
                      disabled={smartRotating || testing}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 active:scale-95 text-white font-bold text-xs transition-all shadow-lg shadow-rose-950/40 cursor-pointer disabled:opacity-50"
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
                      className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-200 font-semibold text-xs border border-white/10 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Shuffle className="w-3.5 h-3.5 text-zinc-300" />
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
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
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
                      <span>{testing ? "Перевірка..." : "Перевірити всі"}</span>
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
                              ? "bg-rose-950/20 border-rose-500/40 text-white shadow-lg shadow-rose-950/20"
                              : "bg-zinc-900/40 border-white/5 hover:border-white/15 text-zinc-300 hover:bg-zinc-900/70"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all",
                                status?.online
                                  ? "bg-emerald-500 shadow-md shadow-emerald-500/50"
                                  : status
                                    ? "bg-rose-500 shadow-md shadow-rose-500/50"
                                    : "bg-zinc-600"
                              )}
                            />
                            <span className="text-xs sm:text-sm font-mono font-medium">{url}</span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-600 text-white uppercase tracking-wider">
                                АКТИВНЕ
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                              DoH
                            </span>
                            {isFastest && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                <Zap className="w-2.5 h-2.5" />
                                Найшвидше
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {status && (
                              <span
                                className={cn(
                                  "text-xs font-mono font-semibold",
                                  status.online
                                    ? status.latency_ms < 500
                                      ? "text-emerald-400"
                                      : "text-amber-400"
                                    : "text-rose-400"
                                )}
                              >
                                {status.online ? `${status.latency_ms} ms` : "Офлайн"}
                              </span>
                            )}

                            {isCustomOnly && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveCustomMirror(url);
                                }}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                title="Видалити це дзеркало"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                testMirror(url);
                              }}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                              title="Оновити пінґ"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add Custom Mirror Input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCustomMirror()}
                      placeholder="https://нове-дзеркало.com"
                      className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500 transition-colors"
                    />
                    <button
                      onClick={handleAddCustomMirror}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Додати</span>
                    </button>
                  </div>
                </div>

                {/* Proxy Settings Card */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/8 space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                      HTTP / SOCKS5 Проксі-сервер (Опціонально)
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={proxyInput}
                      onChange={(e) => setProxyInput(e.target.value)}
                      placeholder="socks5://127.0.0.1:9050 або http://user:pass@host:port"
                      className="flex-1 px-4 py-2 rounded-xl bg-zinc-950 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500"
                    />
                    <button
                      onClick={handleSaveProxy}
                      disabled={savingProxy}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {savingProxy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Зберегти</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 2: PLAYBACK ================= */}
            {activeModalTab === "playback" && (
              <div className="space-y-6">
                {/* Default Video Quality */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0">
                      <Film className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Бажана якість відео за замовчуванням</h4>
                      <p className="text-xs text-zinc-400">
                        RDX автоматично обиратиме цю роздільну здатність при старті фільму чи серії
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                    {[
                      { key: "1080p Ultra", label: "1080p Ultra", vip: true },
                      { key: "1080p", label: "1080p" },
                      { key: "720p", label: "720p" },
                      { key: "480p", label: "480p" },
                      { key: "360p", label: "360p" },
                    ].map((q) => {
                      const isSelected = preferredQuality === q.key;
                      return (
                        <button
                          key={q.key}
                          onClick={() => handleSelectDefaultQuality(q.key)}
                          className={cn(
                            "flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border",
                            isSelected
                              ? "bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-950/50"
                              : "bg-zinc-950/80 border-white/5 text-zinc-300 hover:bg-zinc-900 hover:border-white/15"
                          )}
                        >
                          {q.vip && <Crown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                          <span>{q.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Priority Voiceover / Translator */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Пріоритетна озвучка</h4>
                      <p className="text-xs text-zinc-400">
                        Плеєр спробує автоматично обрати цю озвучку, якщо її назва збігається
                      </p>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={preferredTranslator}
                    onChange={(e) => handleSaveTranslator(e.target.value)}
                    placeholder="Наприклад: Український, HDRezka Studio"
                    className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-white/10 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-rose-500"
                  />

                  {/* Suggestion Chips */}
                  <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                    <span className="text-zinc-500 text-[11px]">Швидкі пресети:</span>
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

                {/* Hardware Engine Card */}
                <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/8 space-y-2">
                  <div className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-zinc-400" />
                    <span>Апаратне декодування та буферизація</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 leading-relaxed">
                    Відеоплеєр RDX використовує ядро{" "}
                    <span className="text-zinc-200 font-mono">WebKitGTK 2.4x</span> на базі
                    системного <span className="text-zinc-200 font-mono">GStreamer</span>{" "}
                    (VAAPI/NVDEC) та розширення{" "}
                    <span className="text-zinc-200 font-mono">HLS.js MSE</span> зі збільшеним
                    буфером 120 секунд для плавного мотання.
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 3: APPEARANCE & SOUND (NEW) ================= */}
            {activeModalTab === "appearance" && (
              <div className="space-y-6">
                {/* Startup Sound Chime Card */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0">
                        <Volume2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Звуковий сигнал заставки (RDX Chime)</h4>
                        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                          Відтворювати фірмовий кінематографічний звук при запуску додатку
                        </p>
                      </div>
                    </div>

                    {/* Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={startupSound}
                        onChange={(e) => handleToggleStartupSound(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                </div>

                {/* System UI Feedback Sounds Card */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0">
                        <Sliders className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Звуки інтерфейсу (TV UI Feedback)</h4>
                        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                          М'який тактильний відгук при наведенні та відкритті карток
                        </p>
                      </div>
                    </div>

                    {/* Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={uiSounds}
                        onChange={(e) => handleToggleUiSounds(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                </div>

                {/* Ambient Glow Card */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0 mt-0.5">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Фоновий ефект розмиття (Ambient Backdrop Glow)</h4>
                        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                          М'яке розмите світіння під колір постера у стилі Apple TV на головній сторінці
                        </p>
                      </div>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={ambientGlow}
                        onChange={(e) => handleToggleAmbientGlow(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                </div>

                {/* 60fps Motion Animations */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/50 border border-white/8 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center text-rose-400 flex-shrink-0 mt-0.5">
                        <Eye className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Плавні анімації 60fps (Framer Motion)</h4>
                        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                          Апаратне прискорення переходів карток та плавний скрол без ривків
                        </p>
                      </div>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={motion60fps}
                        onChange={(e) => handleToggleMotion60fps(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 4: ABOUT & SHORTCUTS ================= */}
            {activeModalTab === "about" && (
              <div className="space-y-6">
                {/* Brand Hero Card */}
                <div className="p-5 rounded-2xl bg-gradient-to-r from-rose-950/40 via-zinc-900 to-zinc-950 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black tracking-tight text-white flex items-baseline">
                      RDX<span className="text-rose-500">.</span>
                      <span className="text-xs font-semibold text-zinc-400 ml-2 tracking-normal">
                        v0.2.0 (Beta)
                      </span>
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      Сучасний кросплатформний клієнт для HDRezka у стилі Android TV / Spotify Desktop
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs font-semibold text-zinc-300">Автор:</span>
                      <span className="px-2 py-0.5 rounded-md bg-rose-600/20 text-rose-300 font-mono text-xs font-bold border border-rose-500/30">
                        justgl
                      </span>
                    </div>
                  </div>

                  {/* Fixed Badges without awkward line wrapping */}
                  <div className="flex flex-col sm:items-end gap-1.5 flex-shrink-0">
                    <span className="whitespace-nowrap px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs font-mono font-bold text-zinc-200 shadow-sm">
                      Rust + Tauri v2
                    </span>
                    <span className="whitespace-nowrap px-3 py-1 rounded-lg bg-zinc-900 border border-white/8 text-[11px] font-mono text-zinc-400">
                      React 19 • Vite • Linux / Win / Mac
                    </span>
                  </div>
                </div>

                {/* Tech Stack Pills */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-zinc-500 text-[11px]">Технології:</span>
                  {[
                    "Tauri v2 (Rust)",
                    "React 19 + TypeScript",
                    "Tailwind CSS v4",
                    "Framer Motion",
                    "HLS.js MSE",
                    "Native MPRIS",
                    "DoH DNS Resolver",
                  ].map((tech) => (
                    <span
                      key={tech}
                      className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/8 text-zinc-300 text-[11px] font-medium"
                    >
                      {tech}
                    </span>
                  ))}
                </div>

                {/* Shortcuts Grid */}
                <div className="p-4.5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Гарячі клавіші плеєра
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Відтворення / Пауза</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        Space / K
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Перемотка назад / вперед</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        ← / → (±5с)
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Велика перемотка</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        Shift + ← / → (±30с)
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Гучність</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        ↑ / ↓ (±5%)
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Без звуку (Mute)</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        M
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Повний екран</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        F
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Повтор відрізка A–B</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        L
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Зробити скріншот кадру</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        S
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Статистика потоку</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        I
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-white/5">
                      <span className="text-zinc-400">Швидкий пошук</span>
                      <kbd className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-zinc-200">
                        Ctrl + K
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
