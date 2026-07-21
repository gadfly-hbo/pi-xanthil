import { useState, useCallback } from "react";

const DEFAULT_HIDDEN_TABS = [
  "zhuanti",
  "aggregate",
  "rule_memory",
  "xan_db",
  "knowledge_base",
  "onto_xanthil",
];
const DEFAULT_HIDDEN_TABS_MIGRATION_KEY = "xanthil-hidden-tabs-frontstage-v1";

function mergeDefaultHiddenTabs(current: string[]) {
  return Array.from(new Set([...current, ...DEFAULT_HIDDEN_TABS]));
}

export function useTabVisibility() {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("xanthil-hidden-tabs");
      const parsed = stored ? JSON.parse(stored) : [];
      if (localStorage.getItem(DEFAULT_HIDDEN_TABS_MIGRATION_KEY) === "1") return parsed;
      const migrated = mergeDefaultHiddenTabs(Array.isArray(parsed) ? parsed : []);
      localStorage.setItem("xanthil-hidden-tabs", JSON.stringify(migrated));
      localStorage.setItem(DEFAULT_HIDDEN_TABS_MIGRATION_KEY, "1");
      return migrated;
    } catch {
      return DEFAULT_HIDDEN_TABS;
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
