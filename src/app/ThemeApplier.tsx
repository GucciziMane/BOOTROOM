"use client";

import { useEffect } from "react";

export function ThemeApplier() {
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const applyTheme = (isDark: boolean) => {
      root.classList.toggle("dark", isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    };
    
    applyTheme(mediaQuery.matches);
    mediaQuery.addEventListener("change", (e) => applyTheme(e.matches));
    
    return () => mediaQuery.removeEventListener("change", (e) => applyTheme(e.matches));
  }, []);
  
  return null;
}
