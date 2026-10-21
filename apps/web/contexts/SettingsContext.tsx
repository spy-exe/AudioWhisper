"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/types";

interface SettingsContextValue {
  settings: AppSettings | null;
  loading: boolean;
  update: (values: Partial<AppSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const publicPage = usePathname().startsWith("/shared/");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (publicPage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicPage]);

  const update = useCallback(async (values: Partial<AppSettings>) => {
    const updated = await api.updateSettings(values);
    setSettings((prev) => (prev ? { ...prev, ...updated } : prev));
  }, []);

  const value = useMemo(
    () => ({ settings, loading, update }),
    [settings, loading, update],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
