import type { ReactNode } from "react";
import "./EmptyState.css";

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  return (
    <div className="center-fill">
      <div className="spinner" />
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: "var(--danger-fg)" }}>
        !
      </div>
      <h3>Something went wrong</h3>
      <p>{message ?? "Failed to load data. Please retry."}</p>
    </div>
  );
}
