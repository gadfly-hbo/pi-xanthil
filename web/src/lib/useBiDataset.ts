import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { BiDatasetDetail, BiDatasetSlot, BiDatasetSummary } from "@/types";

export function useBiDataset(slot: BiDatasetSlot) {
  const [dataset, setDataset] = useState<BiDatasetDetail | null>(null);
  const [history, setHistory] = useState<BiDatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [active, all] = await Promise.all([
        api.getActiveBiDataset(slot),
        api.listBiDatasets(slot),
      ]);
      setDataset(active);
      setHistory(all);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [slot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      try {
        const res = await api.uploadBiDataset(slot, file);
        setDataset(res.dataset);
        setToast(`已导入 ${file.name}（${res.dataset.rowCount} 行 × ${res.dataset.columnCount} 列）`);
        void refresh();
      } catch (err) {
        setError(String(err));
      } finally {
        setImporting(false);
      }
    },
    [slot, refresh],
  );

  const switchTo = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        await api.activateBiDataset(id, slot);
        const detail = await api.getBiDataset(id);
        setDataset(detail);
        setHistory((prev) =>
          prev.map((s) => ({
            ...s,
            active: s.id === id ? 1 : 0,
          })),
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [slot],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteBiDataset(id);
        if (dataset?.id === id) {
          setDataset(null);
        }
        void refresh();
      } catch (err) {
        setError(String(err));
      }
    },
    [dataset?.id, refresh],
  );

  return {
    dataset,
    history,
    loading,
    importing,
    error,
    toast,
    clearToast: () => setToast(null),
    refresh,
    importFile,
    switchTo,
    remove,
  };
}