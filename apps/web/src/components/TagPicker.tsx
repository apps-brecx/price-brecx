import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import "./TagPicker.css";

/**
 * Tag-application popover. Lists the workspace's tag library (created in
 * Settings → Tags) with a checkbox per entry; toggling either applies or
 * removes the tag on the parent's target. New tags can ONLY be created from
 * Settings — the picker shows a footer link there but no inline create form.
 *
 * Three flavours of library are supported via `kind`:
 *   "sku"          – SKUs page
 *   "buybox"       – Buy Box Alert page
 *   "price-alert"  – Pricing page
 *
 * Parents are responsible for the actual API call (PATCH /skus/:id,
 * /pricing/.../tags etc.). This component only emits which tag was clicked
 * and whether it's now applied.
 */

export interface LibraryTag {
  id: string;
  label: string;
  color: string;
}

interface TagPickerProps {
  kind: "sku" | "buybox" | "price-alert";
  /** Tags currently applied to the target. Used to render checkbox state. */
  applied: { label: string; color: string }[];
  /** Toggle handler. `applied` is the post-toggle state — true = was added,
   *  false = was removed. Parent does the API call + invalidates queries. */
  onToggle: (tag: LibraryTag, applied: boolean) => void;
  /** Anchor element — usually the "+ Add tag" button. The picker positions
   *  itself directly below it. */
  children: (open: () => void) => React.ReactNode;
  /** Pending tag label, if a mutation is in flight. The matching row gets
   *  a "..." spinner so the user can't double-click. */
  pendingLabel?: string | null;
}

export function TagPicker({
  kind,
  applied,
  onToggle,
  children,
  pendingLabel,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const query = useQuery({
    queryKey: ["tag-library", kind],
    queryFn: () => api.get<{ items: LibraryTag[] }>(`/tags/${kind}`),
    enabled: open,
  });

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const appliedSet = new Set(applied.map((t) => t.label.toLowerCase()));
  const items = query.data?.items ?? [];

  return (
    <span ref={anchorRef} className="tag-picker-anchor">
      {children(() => setOpen((v) => !v))}
      {open && (
        <div className="tag-picker-pop" ref={popRef}>
          <div className="tag-picker-head">
            {kind === "sku"
              ? "SKU tags"
              : kind === "buybox"
                ? "Buy Box tags"
                : "Price Alert tags"}
          </div>
          <div className="tag-picker-body">
            {query.isLoading ? (
              <div className="tag-picker-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="tag-picker-empty">
                No tags yet. Create one in Settings.
              </div>
            ) : (
              items.map((t) => {
                const isApplied = appliedSet.has(t.label.toLowerCase());
                const isPending =
                  pendingLabel != null &&
                  pendingLabel.toLowerCase() === t.label.toLowerCase();
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={
                      "tag-picker-row" + (isApplied ? " applied" : "")
                    }
                    disabled={isPending}
                    onClick={() => onToggle(t, !isApplied)}
                  >
                    <span
                      className="tag-picker-check"
                      aria-hidden
                    >
                      {isApplied ? "✓" : ""}
                    </span>
                    <span className={`tag tag-${t.color}`}>{t.label}</span>
                    {isPending && (
                      <span className="tag-picker-spinner">…</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="tag-picker-foot">
            <Link to="/settings" onClick={() => setOpen(false)}>
              Manage tags in Settings →
            </Link>
          </div>
        </div>
      )}
    </span>
  );
}
