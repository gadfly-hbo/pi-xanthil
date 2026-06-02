import { useState, useCallback } from "react";

export function useTabVisibility() {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("xanthil-hidden-tabs") || "[]");
    } catch {
      return [];
    }
  });

  const toggleTab = useCallback((id: string, isVisible: boolean) => {
    setHiddenTabs((prev) => {
      const next = isVisible ? prev.filter((t) => t !== id) : [...prev.filter((t) => t !== id), id];
      localStorage.setItem("xanthil-hidden-tabs", JSON.stringify(next));
      return next;
    });
  }, []);

  const isVisible = useCallback((id: string) => !hiddenTabs.includes(id), [hiddenTabs]);

  return { hiddenTabs, toggleTab, isVisible };
}
