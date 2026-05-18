import "./History.css";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { date, relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";

interface HistoryEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface HistoryList {
  items: HistoryEntry[];
  total: number;
}

const PAGE_SIZE = 25;

type ActionKind = "created" | "updated" | "deleted";

function actionKind(action: string): ActionKind {
  const a = action.toLowerCase();
  if (a === "created" || a.endsWith("_created") || a.includes("create")) {
    return "created";
  }
  if (a === "deleted" || a.endsWith("_deleted") || a.includes("delete")) {
    return "deleted";
  }
  // price_changed / price_reverted / updated / everything else -> updated
  return "updated";
}

function actionLabel(kind: ActionKind): string {
  return kind;
}

/** Pull a usable numeric price out of meta, guarding every access. */
function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

/** Render the meta object as readable key/value lines. */
function metaLines(meta: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(meta).map(([key, raw]) => {
    let value: string;
    if (raw === null || raw === undefined) {
      value = "—";
    } else if (typeof raw === "object") {
      try {
        value = JSON.stringify(raw);
      } catch {
        value = String(raw);
      }
    } else {
      value = String(raw);
    }
    return { key, value };
  });
}

export function History() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["history"],
    queryFn: () => api.get<HistoryList>("/history"),
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (e) =>
        e.summary.toLowerCase().includes(term) ||
        e.actor.toLowerCase().includes(term) ||
        e.action.toLowerCase().includes(term),
    );
  }, [items, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, total);
  const pageRows = useMemo(
    () => filtered.slice(startIdx, endIdx),
    [filtered, startIdx, endIdx],
  );

  const rangeStart = total === 0 ? 0 : startIdx + 1;

  return (
    <div>
      <PageHeader
        title="Price Change History"
        subtitle="A chronological record of price and SKU changes"
      />

      <div className="rp-page-wrap">
        {/* Top toolbar — search */}
        <div className="rp-toolbar">
          <div className="input-wrap" style={{ flex: 1, maxWidth: "360px" }}>
            <svg
              className="input-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder="Search by product, actor or action..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {/* Table card with scrollable body + sticky pagination */}
        <div className="card rp-table-card" style={{ flex: 1, minHeight: 0 }}>
          {query.isLoading ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState />
          ) : total === 0 ? (
            <EmptyState
              title="No history changes found"
              message="No price or SKU changes match the current filter."
            />
          ) : (
            <>
              <div className="rp-table-scroll">
                <table className="hist-table">
                  <thead>
                    <tr>
                      <th>Product Details</th>
                      <th style={{ width: "420px" }}>Duration</th>
                      <th style={{ width: "200px" }}>User</th>
                      <th style={{ width: "130px", paddingLeft: "24px" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((h) => {
                      const kind = actionKind(h.action);
                      const isExpanded = expandedId === h.id;
                      const lines = metaLines(h.meta);
                      const hasMeta = lines.length > 0;

                      // Price cell: only render a pill when meta carries
                      // usable price fields. No structured old→new price or
                      // product image exists in the API.
                      const oldPrice =
                        metaNumber(h.meta, "oldPrice") ??
                        metaNumber(h.meta, "previousPrice") ??
                        metaNumber(h.meta, "from");
                      const newPrice =
                        metaNumber(h.meta, "newPrice") ??
                        metaNumber(h.meta, "price") ??
                        metaNumber(h.meta, "to");

                      let durationContent;
                      if (oldPrice !== null && newPrice !== null) {
                        durationContent = (
                          <div className="hist-dur-inline">
                            <span className="hist-price-pill blue">
                              {money(oldPrice)}
                            </span>
                            <svg
                              className="hist-arrow-svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                            >
                              <line x1="5" y1="12" x2="19" y2="12" />
                              <polyline points="12 5 19 12 12 19" />
                            </svg>
                            <span className="hist-price-pill red">
                              {money(newPrice)}
                            </span>
                          </div>
                        );
                      } else if (newPrice !== null) {
                        durationContent = (
                          <div className="hist-dur-inline">
                            <span className="hist-price-pill blue">
                              {money(newPrice)}
                            </span>
                          </div>
                        );
                      } else {
                        durationContent = (
                          <span style={{ color: "var(--text-4)" }}>—</span>
                        );
                      }

                      return (
                        <Fragment key={h.id}>
                          <tr
                            className={`hist-row${
                              isExpanded ? " expanded" : ""
                            }`}
                            onClick={() =>
                              hasMeta
                                ? setExpandedId(isExpanded ? null : h.id)
                                : undefined
                            }
                          >
                            <td>
                              <div
                                className="hist-product-title"
                                title={h.summary}
                              >
                                {h.summary}
                              </div>
                              <div className="hist-ids-row">
                                <span className="copy-btn">
                                  {h.entityType}
                                </span>
                                {h.entityId ? (
                                  <span className="copy-btn">
                                    {h.entityId}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>{durationContent}</td>
                            <td>
                              <div className="hist-user-cell">
                                <div className="hist-user-name">
                                  <span className="user-text">
                                    {h.actor}
                                  </span>
                                </div>
                                <div
                                  className="hist-user-time"
                                  title={date(h.createdAt)}
                                >
                                  {relativeTime(h.createdAt)}
                                </div>
                              </div>
                            </td>
                            <td style={{ paddingLeft: "24px" }}>
                              <span className={`hist-action-pill ${kind}`}>
                                {actionLabel(kind)}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && hasMeta ? (
                            <tr className="hist-expand-row">
                              <td colSpan={4}>
                                <div className="hist-expand-content">
                                  {lines.map((l) => (
                                    <div
                                      key={l.key}
                                      style={{
                                        display: "flex",
                                        gap: "12px",
                                        padding: "5px 0",
                                        fontSize: "12.5px",
                                      }}
                                    >
                                      <span
                                        style={{
                                          minWidth: "160px",
                                          color: "var(--text-3)",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {l.key}
                                      </span>
                                      <span
                                        style={{
                                          color: "var(--text)",
                                          wordBreak: "break-word",
                                        }}
                                      >
                                        {l.value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Sticky pagination footer */}
              <div className="rp-pagination-footer">
                <div style={{ fontSize: "12.5px", color: "var(--text-3)" }}>
                  Showing{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {rangeStart}–{endIdx}
                  </strong>{" "}
                  of <strong style={{ color: "var(--text)" }}>{total}</strong>{" "}
                  changes
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ alignSelf: "center", fontSize: "12px" }}
                    disabled
                  >
                    Page {safePage} of {totalPages}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={safePage >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
