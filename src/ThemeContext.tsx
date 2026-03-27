import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Appearance = "ocean" | "sunset" | "aurora" | "midnight";

export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: "ocean", label: "Ocean" },
  { id: "sunset", label: "Sunset" },
  { id: "aurora", label: "Aurora" },
  { id: "midnight", label: "Midnight" },
];

interface AppearanceCtx {
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceCtx>({
  appearance: "ocean",
  setAppearance: () => {},
});

const STORAGE_KEY = "raincast-appearance";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ocean" || saved === "sunset" || saved === "aurora" || saved === "midnight") return saved;
    return "ocean";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, appearance);
    const el = document.documentElement;
    el.classList.add("theme-transitioning");
    el.setAttribute("data-appearance", appearance);
    const timer = setTimeout(() => el.classList.remove("theme-transitioning"), 600);
    return () => clearTimeout(timer);
  }, [appearance]);

  const setAppearance = (a: Appearance) => setAppearanceState(a);

  return (
    <AppearanceContext.Provider value={{ appearance, setAppearance }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  return useContext(AppearanceContext);
}
