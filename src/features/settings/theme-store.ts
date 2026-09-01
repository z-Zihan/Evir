import { create } from "zustand";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("evir-theme", theme);
  return resolved;
}

const initialTheme = (localStorage.getItem("evir-theme") as Theme | null) ?? "system";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  resolvedTheme: applyTheme(initialTheme),
  setTheme: (theme) => set({ theme, resolvedTheme: applyTheme(theme) }),
  cycleTheme: () => {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(get().theme) + 1) % order.length] ?? "system";
    get().setTheme(next);
  },
}));

// "system" must track OS appearance changes live: without this listener the
// resolved theme only updates after an app restart.
const systemThemeMedia = matchMedia("(prefers-color-scheme: dark)");
const syncSystemTheme = () => {
  const { theme } = useThemeStore.getState();
  if (theme === "system") {
    useThemeStore.setState({ resolvedTheme: applyTheme("system") });
  }
};
if (typeof systemThemeMedia.addEventListener === "function") {
  systemThemeMedia.addEventListener("change", syncSystemTheme);
} else {
  systemThemeMedia.addListener(syncSystemTheme);
}
