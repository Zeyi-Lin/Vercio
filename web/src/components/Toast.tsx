import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useT } from "../i18n";

type Tone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastContextValue {
  pushToast: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastContextValue>({ pushToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const t = useT();

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: Tone = "info") => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      setTimeout(() => remove(id), tone === "error" ? 6500 : 3800);
    },
    [remove]
  );

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label={t("common.notifications")}>
        {toasts.map((toast) => (
          <div key={toast.id} className={"toast toast-" + toast.tone}>
            <span className="toast-icon">
              {toast.tone === "success" ? (
                <CheckCircle2 size={16} />
              ) : toast.tone === "error" ? (
                <AlertCircle size={16} />
              ) : (
                <Info size={16} />
              )}
            </span>
            <span className="toast-msg">{toast.message}</span>
            <button className="toast-close" onClick={() => remove(toast.id)} aria-label={t("common.dismiss")}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
