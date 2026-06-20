import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "system" | "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolve(t: Theme): "light" | "dark" {
  return t === "dark" || (t === "system" && systemDark()) ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("pb-theme") as Theme) || "system"
  );
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    resolve(theme)
  );

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    // HeroUI v3 keys themes off data-theme ("default" = light, "dark" = dark).
    document.documentElement.dataset.theme = r === "dark" ? "dark" : "default";
    localStorage.setItem("pb-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (theme === "system") {
        const r = resolve("system");
        setResolved(r);
        document.documentElement.dataset.theme = r === "dark" ? "dark" : "default";
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const cycle = useCallback(
    () =>
      setTheme((p) =>
        p === "system" ? "light" : p === "light" ? "dark" : "system"
      ),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
