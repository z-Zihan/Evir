import { create } from "zustand";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
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
