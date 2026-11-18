import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { useDebouncedCallback, useEventStream } from "../lib/hooks";
import { useT } from "../i18n";
import type { Overview, Settings, Stats, SystemInfo } from "../lib/types";
import { useToast } from "../components/Toast";

export type ModalName = "add-project" | "share" | "profile" | "palette";

interface AppContextValue {
  overview: Overview | null;
  systemInfo: SystemInfo | null;
  settings: Settings;
  stats: Stats | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  openModal: (name: ModalName) => void;
  closeModal: () => void;
  activeModal: ModalName | null;
  authorName: string;
}

const defaultSettings: Settings = { userName: "", defaultAuthor: "" };

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ModalName | null>(null);
  const [authorName, setAuthorName] = useState("");
  const { pushToast } = useToast();
  const t = useT();
  const hasLoaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [overviewData, systemData] = await Promise.all([api.overview(), api.system()]);
      setOverview(overviewData);
      setSystemInfo(systemData.system);
      setSettings(systemData.settings);
      setStats(systemData.stats);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t("dashboard.networkError"));
    } finally {
      if (!hasLoaded.current) {
        hasLoaded.current = true;
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("vercio:author");
      if (stored) setAuthorName(stored);
    } catch {}
  }, []);

  useEffect(() => {
    if (settings.userName) setAuthorName(settings.userName);
  }, [settings.userName]);

  const refreshDebounced = useDebouncedCallback(() => {
    refresh();
  }, 260);

  useEventStream(
    useCallback(
      (type, data) => {
        if (type === "settings.updated") return;
        refreshDebounced();
        window.dispatchEvent(new CustomEvent("vercio:event", { detail: { type, data } }));
      },
      [refreshDebounced]
    )
  );

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const result = await api.settings(patch);
      setSettings(result.settings);
      if (patch.userName !== undefined) {
        setAuthorName(patch.userName);
        try {
          window.localStorage.setItem("vercio:author", patch.userName);
        } catch {}
      }
      pushToast(t("profile.toast"), "success");
    },
    [pushToast, t]
  );

  const openModal = useCallback((name: ModalName) => setActiveModal(name), []);
  const closeModal = useCallback(() => setActiveModal(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      overview,
      systemInfo,
      settings,
      stats,
      loading,
      error,
      refresh,
      saveSettings,
      openModal,
      closeModal,
      activeModal,
      authorName,
    }),
    [
      overview,
      systemInfo,
      settings,
      stats,
      loading,
      error,
      refresh,
      saveSettings,
      openModal,
      closeModal,
      activeModal,
      authorName,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
