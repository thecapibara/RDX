/**
 * RDX Cinema Streaming - Dynamic Accent & Background Theme Engine
 * Controls dynamic Tailwind v4 CSS variables, OLED pure black mode,
 * and persistent user customization.
 */

export type AccentColor = "crimson" | "amethyst" | "sapphire" | "emerald" | "amber";
export type BgTheme = "oled" | "obsidian";

export interface AccentOption {
  id: AccentColor;
  name: string;
  tagline: string;
  hex: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  {
    id: "crimson",
    name: "Obsidian Crimson",
    tagline: "Фірмовий кінематографічний рубін RDX",
    hex: "#e11d48",
  },
  {
    id: "amethyst",
    name: "Neon Amethyst",
    tagline: "Кіберпанк-неон та глибокий пурпур",
    hex: "#a855f7",
  },
  {
    id: "sapphire",
    name: "Sapphire Cinema",
    tagline: "Шляхетний синій у стилі Prime Video",
    hex: "#3b82f6",
  },
  {
    id: "emerald",
    name: "Emerald Matrix",
    tagline: "Свіжий смарагдовий цифровий відтінок",
    hex: "#10b981",
  },
  {
    id: "amber",
    name: "Amber Gold",
    tagline: "Теплий бурштиновий у стилі преміум-кінозалу",
    hex: "#f59e0b",
  },
];

const ACCENT_MAP: Record<AccentColor, { c400: string; c500: string; c600: string; c950: string }> = {
  crimson: { c400: "#fb7185", c500: "#f43f5e", c600: "#e11d48", c950: "#4c0519" },
  amethyst: { c400: "#c084fc", c500: "#a855f7", c600: "#9333ea", c950: "#3b0764" },
  sapphire: { c400: "#60a5fa", c500: "#3b82f6", c600: "#2563eb", c950: "#172554" },
  emerald: { c400: "#34d399", c500: "#10b981", c600: "#059669", c950: "#022c22" },
  amber: { c400: "#fbbf24", c500: "#f59e0b", c600: "#d97706", c950: "#451a03" },
};

const BG_MAP: Record<BgTheme, { base: string; surface: string; elevated: string; card: string; border: string }> = {
  oled: {
    base: "#000000",
    surface: "#050507",
    elevated: "#0f0f13",
    card: "rgba(255, 255, 255, 0.03)",
    border: "rgba(255, 255, 255, 0.08)",
  },
  obsidian: {
    base: "#09090b",
    surface: "#111217",
    elevated: "#181920",
    card: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.10)",
  },
};

export const getAccentColor = (): AccentColor => {
  if (typeof window === "undefined") return "crimson";
  try {
    const val = localStorage.getItem("rdx_accent_color");
    if (val && ["crimson", "amethyst", "sapphire", "emerald", "amber"].includes(val)) {
      return val as AccentColor;
    }
  } catch {}
  return "crimson";
};

export const setAccentColor = (accent: AccentColor) => {
  try {
    localStorage.setItem("rdx_accent_color", accent);
    document.documentElement.setAttribute("data-accent", accent);
    const pal = ACCENT_MAP[accent] || ACCENT_MAP.crimson;
    document.documentElement.style.setProperty("--accent-400", pal.c400);
    document.documentElement.style.setProperty("--accent-500", pal.c500);
    document.documentElement.style.setProperty("--accent-600", pal.c600);
    document.documentElement.style.setProperty("--accent-950", pal.c950);
  } catch {}
};

export const getBgTheme = (): BgTheme => {
  if (typeof window === "undefined") return "oled";
  try {
    const val = localStorage.getItem("rdx_bg_theme");
    if (val === "oled" || val === "obsidian") {
      return val as BgTheme;
    }
  } catch {}
  return "oled";
};

export const setBgTheme = (theme: BgTheme) => {
  try {
    localStorage.setItem("rdx_bg_theme", theme);
    document.documentElement.setAttribute("data-bg", theme);
    const bg = BG_MAP[theme] || BG_MAP.oled;
    document.documentElement.style.setProperty("--bg-base", bg.base);
    document.documentElement.style.setProperty("--bg-surface", bg.surface);
    document.documentElement.style.setProperty("--bg-elevated", bg.elevated);
    document.documentElement.style.setProperty("--bg-card", bg.card);
    document.documentElement.style.setProperty("--border-subtle", bg.border);
    if (document.body) {
      document.body.style.backgroundColor = bg.base;
    }
  } catch {}
};

export const initThemes = () => {
  if (typeof window === "undefined") return;
  const accent = getAccentColor();
  const bg = getBgTheme();
  setAccentColor(accent);
  setBgTheme(bg);
};
