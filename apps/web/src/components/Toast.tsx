/**
 * App-wide toast notifications. Markup + behaviour (bottom-right stack,
 * 3.5s auto-dismiss, manual close, per-type icon) mirror the redesign's
 * showToast(); styling lives in styles/app.css (.toast-* classes).
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Invitation sent", "Email sent to jane@brecx.com");
 *   toast.error("Couldn't send invite", err.message);
 */
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

export type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  desc?: string;
}

interface ToastApi {
  show: (title: string, kind?: ToastKind, desc?: string) => void;
  success: (title: string, desc?: string) => void;
  error: (title: string, desc?: string) => void;
  info: (title: string, desc?: string) => void;
  warning: (title: string, desc?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 3500ms matches the redesign's showToast() auto-dismiss. */
const AUTO_DISMISS_MS = 3500;

const ICONS: Record<ToastKind, JSX.Element> = {
  success: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
    </svg>
  ),
};

/** app.css defines .toast.danger (not .error) — map the public kind to it. */
function toastClass(kind: ToastKind): string {
  return `toast ${kind === "error" ? "danger" : kind}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (title: string, kind: ToastKind = "success", desc?: string) => {
      const id = ++seq.current;
      setToasts((list) => [...list, { id, kind, title, desc }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  // Clear any pending timers if the provider unmounts.
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t, d) => show(t, "success", d),
      error: (t, d) => show(t, "error", d),
      info: (t, d) => show(t, "info", d),
      warning: (t, d) => show(t, "warning", d),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-container" id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={toastClass(t.kind)} role="status">
            <div className="toast-icon">{ICONS[t.kind]}</div>
            <div className="toast-content">
              <div className="toast-title">{t.title}</div>
              {t.desc && <div className="toast-desc">{t.desc}</div>}
            </div>
            <button
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
