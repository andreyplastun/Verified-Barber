import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

const STORAGE_KEY = "rateus-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(theme));

  const applyTheme = useCallback((r: "light" | "dark") => {
    const root = document.documentElement;
    root.classList.add("theme-transition");
    if (r === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    setTimeout(() => root.classList.remove("theme-transition"), 250);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    const r = resolve(t);
    setResolved(r);
    applyTheme(r);
  }, [applyTheme]);

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyTheme(r);
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const r = e.matches ? "dark" : "light";
      setResolved(r);
      applyTheme(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
