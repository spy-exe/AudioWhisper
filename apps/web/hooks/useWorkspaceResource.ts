"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useWorkspaceResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  key: string,
  interval = 0,
) {
  const fetcher = useRef(loader);
  fetcher.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const loadedKey = useRef<string | null>(null);
  const hasData = useRef(false);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let disposed = false,
      busy = false;
    let controller: AbortController | undefined;
    const changed = loadedKey.current !== key;
    setLoading(changed || !hasData.current);
    if (changed) {
      setData(null);
      hasData.current = false;
    }
    setError("");
    loadedKey.current = key;
    const load = async () => {
      if (busy || disposed) return;
      busy = true;
      controller = new AbortController();
      let timeout = false;
      const timer = setTimeout(() => {
        timeout = true;
        controller?.abort();
      }, 30000);
      try {
        const result = await fetcher.current(controller.signal);
        if (!disposed && !controller.signal.aborted) {
          setData(result);
          hasData.current = true;
          setError("");
        }
      } catch (failure) {
        if (!disposed)
          setError(
            timeout
              ? "A consulta demorou demais. Tente novamente."
              : failure instanceof Error
                ? failure.message
                : "Não foi possível carregar. Tente novamente.",
          );
      } finally {
        clearTimeout(timer);
        busy = false;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = interval
      ? setInterval(() => {
          if (document.visibilityState !== "hidden") void load();
        }, interval)
      : undefined;
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, [key, revision, interval]);
  return { data, error, loading, refresh };
}

export function useWorkspaceMutation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const locked = useRef(false);
  const execute = async (
    operation: () => Promise<unknown>,
    success: string,
  ) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível salvar. Tente novamente.",
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { busy, error, message, execute };
}
