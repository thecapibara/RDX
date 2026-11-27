import React from "react";
import {
  FlaskConical,
  Zap,
  Sparkles,
  Sun,
  SkipForward,
  Mic,
  BatteryCharging,
  RotateCcw,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { playHoverSound } from "../services/sound";
import { unlockSharedAudioContext } from "../utils/dialogueEnhancer";
import {
  useLabsSettings,
  updateLabsSettings,
  applyRecommendedLabsPreset,
  resetLabsSettings,
  countActiveLabsFeatures,
  type FrameBoostMode,
  type SmartUpscaleMode,
  type IntroSkipMode,
  type EcoPowerMode,
} from "../services/labs";

export const LabsSettingsPanel: React.FC = () => {
  const labs = useLabsSettings();
  const { raw, isActive, ecoActive, batteryLevel, batteryCharging } = labs;
  const activeCount = countActiveLabsFeatures(labs);

  const toggleMaster = (enabled: boolean) => {
    updateLabsSettings({ enabled });
    playHoverSound();
  };

  return (
    <div className="space-y-5">
      {/* 1. Master RDX Labs Hero Banner & Kill-Switch */}
      <div
        className={cn(
          "p-5 rounded-2xl border transition-all duration-300 space-y-4 shadow-xl",
          isActive
            ? "bg-gradient-to-br from-rose-950/45 via-zinc-900/85 to-zinc-950 border-rose-500/35 shadow-rose-950/20"
            : "bg-gradient-to-br from-zinc-900/90 via-zinc-900/60 to-zinc-950 border-white/10 shadow-black/40"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={cn(
                "w-11 h-11 rounded-2xl flex items-center justify-center border flex-shrink-0 transition-colors",
                isActive
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-lg shadow-rose-950/40"
                  : "bg-white/5 border-white/10 text-zinc-400"
              )}
            >
              <FlaskConical className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                  Увімкнути експериментальний функціонал (RDX Labs)
                </h3>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : "bg-white/5 text-zinc-400 border-white/10"
                  )}
                >
                  {isActive ? `Активно (${activeCount})` : "Вимкнено (0% ресурсів)"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Головний вимикач (Master Switch): якщо вимкнути Лабораторію, абсолютно всі
                експериментальні шейдери, таймери та модулі миттєво зупиняються. Працює на
                інтегрованій графіці Intel UHD / Iris Xe, NVIDIA, AMD та Apple Silicon.
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => toggleMaster(!isActive)}
            className={cn(
              "relative inline-flex h-7 w-13 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
              isActive ? "bg-rose-600" : "bg-zinc-700"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                isActive ? "translate-x-6" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center justify-between gap-2.5 flex-wrap pt-1 border-t border-white/10">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                applyRecommendedLabsPreset();
                playHoverSound();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-200 text-xs font-semibold cursor-pointer transition-all active:scale-95"
            >
              <Wand2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Рекомендований набір для ПК/ноутбука</span>
            </button>

            <button
              type="button"
              onClick={() => {
                resetLabsSettings();
                playHoverSound();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-medium cursor-pointer transition-all active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
              <span>Скинути все</span>
            </button>
          </div>

          <div className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span>Авто-захист від просідання FPS увімкнено</span>
          </div>
        </div>
      </div>

      {/* Eco Mode Active Notice */}
      {isActive && ecoActive && (
        <div className="px-4 py-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/35 flex items-center justify-between gap-3 text-xs text-emerald-200">
          <div className="flex items-center gap-2.5">
            <BatteryCharging className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>
              <strong>Еко-режим активний:</strong> увімкнено чистий OLED #000000, авто-якість 720p,
              а важкі GPU-ефекти (Frame Boost / Upscaler / Ambilight) тимчасово поставлені на паузу
              для економії заряду.
            </span>
          </div>
        </div>
      )}

      {/* Locked State Hint when Master Switch is OFF */}
      {!isActive && (
        <div className="px-4 py-3 rounded-2xl bg-zinc-900/50 border border-white/5 text-xs text-zinc-400 flex items-center justify-between gap-3">
          <span>
            Увімкніть перемикач вище або натисніть «Рекомендований набір», щоб активувати модулі
            Лабораторії та швидке меню 🧪 Labs у відеоплеєрі.
          </span>
        </div>
      )}

      {/* 2. Experimental Feature Cards */}
      <div
        className={cn(
          "space-y-4 transition-opacity duration-200",
          !isActive && "opacity-45 pointer-events-none select-none"
        )}
      >
        {/* CARD 1: Frame Boost (24 -> 48/60 FPS) */}
        <div className="p-4.5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white">
                    Frame Boost (24 FPS → 48/60 FPS)
                  </h4>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-bold">
                    WebGL2
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Генерує проміжні кадри між 24-кадровим кіно/аніме в реальному часі для плавності
                  60 Гц без розмиття зміни сцен
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: "off",
                  title: "Вимкнено",
                  sub: "Оригінальні 24 FPS (0% GPU)",
                },
                {
                  id: "smooth",
                  title: "М'який Anti-Judder",
                  sub: "Для будь-яких ноутів та iGPU",
                },
                {
                  id: "flow",
                  title: "Motion Flow 2x (60 FPS)",
                  sub: "Оптичний потік піраміди 240p",
                },
              ] as { id: FrameBoostMode; title: string; sub: string }[]
            ).map((opt) => {
              const selected = raw.frameBoost === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    updateLabsSettings({ frameBoost: opt.id });
                    playHoverSound();
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer",
                    selected
                      ? "bg-rose-600/20 border-rose-500 text-white shadow-md shadow-rose-950/30"
                      : "bg-zinc-950/70 border-white/10 text-zinc-300 hover:bg-white/5"
                  )}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CARD 2: Vendor-Agnostic Smart Upscaler */}
        <div className="p-4.5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-white">
                  Smart Upscaler (720p → 1080p Full HD)
                </h4>
                <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] font-bold">
                  Intel / NVIDIA / AMD
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Універсальний просторовий апскейлер для потоків нижче 1080p (Edge-Adaptive для
                фільмів або Anime4K-Fast для чітких ліній аніме й мультфільмів)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { id: "off", title: "Вимкнено", sub: "Стандартний скейл" },
                { id: "auto", title: "Авто (Розумний)", sub: "Кіно vs Аніме <1080p" },
                { id: "cinema", title: "Кіно (Edge-HD)", sub: "Деталі та діагоналі" },
                { id: "anime", title: "Anime4K-Fast", sub: "Тонкі чіткі контури" },
              ] as { id: SmartUpscaleMode; title: string; sub: string }[]
            ).map((opt) => {
              const selected = raw.smartUpscale === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    updateLabsSettings({ smartUpscale: opt.id });
                    playHoverSound();
                  }}
                  className={cn(
                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    selected
                      ? "bg-rose-600/20 border-rose-500 text-white shadow-md shadow-rose-950/30"
                      : "bg-zinc-950/70 border-white/10 text-zinc-300 hover:bg-white/5"
                  )}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CARD 3 & 4: Cinema Ambilight + Clear Dialogue 2.0 (2-col row) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Cinema Ambilight */}
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/10 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 flex-shrink-0 mt-0.5">
                <Sun className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="text-xs font-bold text-white">Cinema Ambilight</h4>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold">
                    Легко (&lt;0.2%)
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                  М'яке атмосферне світіння кольорів кадру на чорних смугах 21:9 та 4:3
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={raw.ambilight}
              onClick={() => {
                updateLabsSettings({ ambilight: !raw.ambilight });
                playHoverSound();
              }}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 mt-0.5",
                raw.ambilight ? "bg-rose-600" : "bg-zinc-700"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200",
                  raw.ambilight ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* Dialogue Boost 2.0 */}
          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-white/10 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 flex-shrink-0 mt-0.5">
                <Mic className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="text-xs font-bold text-white">Чіткі діалоги 2.0</h4>
                  <span className="px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 text-[9px] font-bold">
                    Safe DSP
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                  Підсилює голоси акторів, приглушує різкі вибухи та має сторож проти тиші
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={raw.dialogueBoost}
              onClick={() => {
                const next = !raw.dialogueBoost;
                if (next) unlockSharedAudioContext();
                updateLabsSettings({ dialogueBoost: next });
                playHoverSound();
              }}
              className={cn(
                "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 mt-0.5",
                raw.dialogueBoost ? "bg-rose-600" : "bg-zinc-700"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200",
                  raw.dialogueBoost ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>
        </div>

        {/* CARD 5: Smart Intro Skip */}
        <div className="p-4.5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <SkipForward className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">
                Розумний пропуск заставки / інтро серіалів
              </h4>
              <p className="text-xs text-zinc-400 mt-0.5">
                Локально порівнює WebVTT спрайти сусідніх серій (dHash) та дозволяє одним кліком
                запам'ятати заставку на весь сезон
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: "off", title: "Вимкнено", sub: "Без пошуку заставок" },
                {
                  id: "button",
                  title: "Кнопка «Пропустити ⏭»",
                  sub: "Показувати під час інтро",
                },
                {
                  id: "auto",
                  title: "Автоматичний скіп",
                  sub: "Сам перемотує заставку",
                },
              ] as { id: IntroSkipMode; title: string; sub: string }[]
            ).map((opt) => {
              const selected = raw.introSkip === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    updateLabsSettings({ introSkip: opt.id });
                    playHoverSound();
                  }}
                  className={cn(
                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    selected
                      ? "bg-rose-600/20 border-rose-500 text-white shadow-md shadow-rose-950/30"
                      : "bg-zinc-950/70 border-white/10 text-zinc-300 hover:bg-white/5"
                  )}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CARD 6: Laptop Eco Battery Mode */}
        <div className="p-4.5 rounded-2xl bg-zinc-900/60 border border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 flex-shrink-0">
                <BatteryCharging className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white">
                    Еко-режим для ноутбука (Battery Saver)
                  </h4>
                  {batteryLevel !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-zinc-300">
                      {Math.round(batteryLevel * 100)}%{" "}
                      {batteryCharging ? "⚡ Зарядка" : "🔋 Від батареї"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Чистий OLED #000000, авто-обмеження якості до 720p, збільшений буфер сну Wi-Fi та
                  вимкнення важких шейдерів
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: "off", title: "Вимкнено", sub: "Повна потужність" },
                {
                  id: "auto_battery",
                  title: "Авто (< 30% без зарядки)",
                  sub: "Розумна економія в дорозі",
                },
                {
                  id: "on",
                  title: "Завжди активний",
                  sub: "Максимум часу роботи",
                },
              ] as { id: EcoPowerMode; title: string; sub: string }[]
            ).map((opt) => {
              const selected = raw.ecoMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    updateLabsSettings({ ecoMode: opt.id });
                    playHoverSound();
                  }}
                  className={cn(
                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                    selected
                      ? "bg-rose-600/20 border-rose-500 text-white shadow-md shadow-rose-950/30"
                      : "bg-zinc-950/70 border-white/10 text-zinc-300 hover:bg-white/5"
                  )}
                >
                  <div className="text-xs font-bold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
