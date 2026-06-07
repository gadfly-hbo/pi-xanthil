import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ReportEntry } from "@/types";

export interface UseReportHistoryResult {
  entries: ReportEntry[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  scannedAt: number | null;
  allTags: Array<{ tag: string; count: number }>;
  refresh: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
}

export function useReportHistory(): UseReportHistoryResult {
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<number | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await api.scanReports();
      setEntries(data.entries);
      setScannedAt(data.scannedAt);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  const toggleFavorite = useCallback(async (id: string) => {
    const target = entries.find((e) => e.id === id);
    if (!target) return;
    const willFavorite = !target.isFavorite;
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, isFavorite: willFavorite } : e)));
    try {
      if (willFavorite) await api.addReportFavorite(id);
      else await api.removeReportFavorite(id);
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, isFavorite: !willFavorite } : e)));
      setError(String((err as Error)?.message ?? err));
    }
  }, [entries]);

  const addTag = useCallback(async (id: string, tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;
    const target = entries.find((e) => e.id === id);
    if (!target) return;
    if (target.tags.includes(cleaned)) return;
    const newTags = [...target.tags, cleaned].sort();
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, tags: newTags } : e)));
    try {
      await api.addReportTag(id, cleaned);
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, tags: target.tags } : e)));
      setError(String((err as Error)?.message ?? err));
    }
  }, [entries]);

  const removeTag = useCallback(async (id: string, tag: string) => {
    const target = entries.find((e) => e.id === id);
    if (!target) return;
    const newTags = target.tags.filter((t) => t !== tag);
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, tags: newTags } : e)));
    try {
      await api.removeReportTag(id, tag);
    } catch (err) {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, tags: target.tags } : e)));
      setError(String((err as Error)?.message ?? err));
    }
  }, [entries]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [entries]);

  return { entries, loading, refreshing, error, scannedAt, allTags, refresh, toggleFavorite, addTag, removeTag };
}
