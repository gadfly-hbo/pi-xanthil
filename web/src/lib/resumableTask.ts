import { useCallback, useSyncExternalStore } from "react";

export type ResumableStatus = "idle" | "running" | "done" | "error";

interface Entry<T = unknown> {
  status: ResumableStatus;
  data?: T;
  error?: string;
  promise?: Promise<void>;
  listeners: Set<() => void>;
}

const store = new Map<string, Entry>();

function getOrCreate<T>(key: string): Entry<T> {
  let entry = store.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = { status: "idle", listeners: new Set() };
    store.set(key, entry);
  }
  return entry;
}

function notify(entry: Entry): void {
  entry.listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // listener errors must not break others
    }
  });
}

export function startResumableTask<T>(
  key: string,
  runner: () => Promise<T>,
): Promise<void> {
  const entry = getOrCreate<T>(key);
  if (entry.status === "running" && entry.promise) {
    return entry.promise;
  }
  entry.status = "running";
  entry.data = undefined;
  entry.error = undefined;
  const p = runner()
    .then((result) => {
      entry.data = result;
      entry.status = "done";
    })
    .catch((e) => {
      entry.error = e instanceof Error ? e.message : String(e);
      entry.status = "error";
    })
    .finally(() => {
      entry.promise = undefined;
      notify(entry);
    });
  entry.promise = p;
  notify(entry);
  return p;
}

export interface ResumableTaskState<T> {
  status: ResumableStatus;
  data: T | undefined;
  error: string | undefined;
  start: (runner: () => Promise<T>) => Promise<void>;
  reset: () => void;
}

const EMPTY_SNAPSHOT: { status: ResumableStatus; data: unknown; error: string | undefined } = {
  status: "idle",
  data: undefined,
  error: undefined,
};

const snapshotCache = new WeakMap<Entry, { status: ResumableStatus; data: unknown; error: string | undefined }>();

function getSnapshot<T>(key: string): { status: ResumableStatus; data: T | undefined; error: string | undefined } {
  const entry = store.get(key);
  if (!entry) return EMPTY_SNAPSHOT as { status: ResumableStatus; data: T | undefined; error: string | undefined };
  const cached = snapshotCache.get(entry);
  if (
    cached &&
    cached.status === entry.status &&
    cached.data === entry.data &&
    cached.error === entry.error
  ) {
    return cached as { status: ResumableStatus; data: T | undefined; error: string | undefined };
  }
  const next = { status: entry.status, data: entry.data, error: entry.error };
  snapshotCache.set(entry, next);
  return next as { status: ResumableStatus; data: T | undefined; error: string | undefined };
}

export function useResumableTask<T>(key: string): ResumableTaskState<T> {
  const subscribe = useCallback(
    (cb: () => void) => {
      const entry = getOrCreate<T>(key);
      entry.listeners.add(cb);
      return () => {
        entry.listeners.delete(cb);
      };
    },
    [key],
  );
  const snap = useSyncExternalStore(subscribe, () => getSnapshot<T>(key), () => getSnapshot<T>(key));
  const start = useCallback(
    (runner: () => Promise<T>) => startResumableTask<T>(key, runner),
    [key],
  );
  const reset = useCallback(() => {
    const entry = store.get(key);
    if (!entry) return;
    if (entry.status === "running") return;
    entry.status = "idle";
    entry.data = undefined;
    entry.error = undefined;
    notify(entry);
  }, [key]);
  return { status: snap.status, data: snap.data, error: snap.error, start, reset };
}
