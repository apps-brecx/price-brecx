import "./Modal.css";
import type { ReactNode } from "react";

/**
 * Shared modal — matches the redesign's .modal-overlay / .modal markup.
 * Styling is co-located in Modal.css.
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "lg" | "xl";
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay show" onClick={onClose}>
      <div
        className={"modal" + (size ? ` modal-${size}` : "")}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-subtitle">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
