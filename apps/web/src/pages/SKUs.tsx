import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { Sku, Paginated, SkuCreateInput } from "@fbm/shared";
import { CHANNEL_LABELS, SALES_CHANNELS, SKU_STATUSES } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge, Tags } from "../components/Badges";
import { Modal } from "../components/Modal";
import { PriceScheduleModal } from "../components/PriceScheduleModal";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { useToast } from "../components/Toast";

const PAGE_SIZE = 25;

/** Amazon fulfillment-channel → display badge label.
 *  "DEFAULT" = merchant-fulfilled (FBM); anything else (AMAZON_NA, AMAZON_EU…)
 *  is Amazon-fulfilled (FBA). null = channel not synced yet. */
function fbaLabel(fc: string | null): "FBA" | "FBM" | null {
  if (!fc) return null;
  return fc === "DEFAULT" ? "FBM" : "FBA";
}

/** Pull a period's units from a SKU's salesMetrics array (0 if absent). */
function unitsFor(s: Sku, period: "1d" | "7d" | "15d" | "30d"): number {
  return s.salesMetrics?.find((m) => m.period === period)?.units ?? 0;
}

const emptyDraft: SkuCreateInput = {
  sku: "",
  title: "",
  asin: "",
  channel: "amazon",
  price: 0,
  basePrice: null,
  cost: null,
  stock: 0,
  status: "active",
};

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#f59e0b"/></svg>',
  );

function ProductImg({
  src,
  className,
}: {
  src: string | null;
  className: string;
}) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      className={className}
      src={!src || errored ? FALLBACK_IMG : src}
      alt=""
      onError={() => setErrored(true)}
    />
  );
}

export function SKUs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<SkuCreateInput>(emptyDraft);
  const [scheduleFor, setScheduleFor] = useState<Sku | null>(null);
  type Tab = "all" | "active" | "inactive" | "favorites" | "scheduled";
  const [tab, setTab] = useState<Tab>("all");

  // Reset to page 1 when the tab changes.
  useEffect(() => setPage(1), [tab]);

  // Debounce search → resets to page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const tabParams = useMemo(() => {
    switch (tab) {
      case "active":
        return { status: "active" };
      case "inactive":
        return { status: "inactive" };
      case "favorites":
        return { favorite: "true" };
      case "scheduled":
        return { scheduled: "true" };
      default:
        return {};
    }
  }, [tab]);

  const query = useQuery({
    queryKey: ["skus", { search, page, tab }],
    queryFn: () =>
      api.get<Paginated<Sku>>(
        `/skus${qs({ search, page, pageSize: PAGE_SIZE, ...tabParams })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const statsQ = useQuery({
    queryKey: ["skus", "stats"],
    queryFn: () =>
      api.get<{
        activeSkus: number;
        scheduledUpdates: number;
        totalChannelStock: number;
        sales30d: number;
      }>("/skus/stats"),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (body: SkuCreateInput) => api.post<Sku>("/skus", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      setCreateOpen(false);
      setDraft(emptyDraft);
    },
  });

  const syncMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/skus/sync"),
    onSuccess: () =>
      toast.info(
        "Sync started",
        "Pulling listings & stock from Amazon — the list refreshes automatically when it's done (can take a few minutes).",
      ),
    onError: (err) =>
      toast.error(
        "Couldn't start sync",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const favMut = useMutation({
    mutationFn: (s: Sku) =>
      api.patch<Sku>(`/skus/${s.id}`, { favorite: !s.favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skus"] }),
  });


  const data = query.data;
  const total = data?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const items = data?.items ?? [];
  const fromN = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toN = Math.min(page * PAGE_SIZE, total);

  const stats = statsQ.data;
  const fmtMoney = (n: number) =>
    `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  function exportCsv() {
    const items = query.data?.items ?? [];
    if (items.length === 0) return;
    const header = [
      "SKU",
      "ASIN",
      "Title",
      "Status",
      "Channel",
      "FBA/FBM",
      "Price",
      "Channel Stock",
      "Sales (30d)",
    ];
    const csvCell = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(","),
      ...items.map((s) =>
        [
          s.sku,
          s.asin ?? "",
          s.title,
          s.status,
          s.channel,
          fbaLabel(s.fulfillmentChannel) ?? "",
          s.price,
          s.stock,
          unitsFor(s, "30d"),
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skus-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Stat strip — Active SKUs / Scheduled Updates / Total Channel Stock / Sales (30D) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div className="stat-card">
          <div className="stat-label">Active SKUs</div>
          <div className="stat-value">
            {stats ? num(stats.activeSkus) : "—"}
          </div>
          <div className="stat-trend">all live listings</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Scheduled Updates</div>
          <div className="stat-value">
            {stats ? num(stats.scheduledUpdates) : "—"}
          </div>
          <div className="stat-trend">price schedules pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Channel Stock</div>
          <div className="stat-value">
            {stats ? num(stats.totalChannelStock) : "—"}
          </div>
          <div className="stat-trend">units across all SKUs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sales (30D)</div>
          <div className="stat-value">
            {stats ? fmtMoney(stats.sales30d) : "—"}
          </div>
          <div className="stat-trend up">revenue · last 30 days</div>
        </div>
      </div>

      {/* Top toolbar — search left, action buttons right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div className="input-wrap" style={{ flex: 1, maxWidth: 520 }}>
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
            placeholder="Search by Title, ASIN or SKU…"
            style={{ width: "100%", paddingRight: 60 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />

        <button
          className="btn btn-secondary btn-sm"
          title="Pull listings, prices and stock from Amazon"
          disabled={syncMut.isPending}
          onClick={() => syncMut.mutate()}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          {syncMut.isPending ? "Starting…" : "Sync from Amazon"}
        </button>

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setScanOpen(true)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan
        </button>

        <button
          className="btn btn-secondary btn-sm"
          title="Download visible SKUs as CSV"
          disabled={!query.data?.items?.length}
          onClick={exportCsv}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>

        <button
          className="btn btn-secondary btn-sm"
          title="Pending price schedules"
          onClick={() => setTab("scheduled")}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          Schedule Price
          {stats?.scheduledUpdates ? (
            <span
              style={{
                marginLeft: 6,
                background: "var(--brand-600)",
                color: "#fff",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {stats.scheduledUpdates}
            </span>
          ) : null}
        </button>

        <button
          className="btn btn-primary btn-sm"
          onClick={() => setCreateOpen(true)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add SKU
        </button>
      </div>

      {/* Filter tabs — All / Active / Inactive / Favorites / Scheduled */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {(
          [
            ["all", "All", total],
            ["active", "Active", stats?.activeSkus],
            [
              "inactive",
              "Inactive",
              stats != null
                ? Math.max(0, total - (stats.activeSkus ?? 0))
                : undefined,
            ],
            ["favorites", "Favorites", undefined],
            ["scheduled", "Scheduled", stats?.scheduledUpdates],
          ] as const
        ).map(([key, label, count]) => (
          <div
            key={key}
            className={"filter-chip" + (tab === key ? " active" : "")}
            onClick={() => setTab(key as Tab)}
          >
            {label}
            {typeof count === "number" && (
              <span className="count">{num(count)}</span>
            )}
          </div>
        ))}
      </div>

      {/* Result count row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Showing{" "}
          <strong style={{ color: "var(--text)" }}>
            {fromN}–{toN}
          </strong>{" "}
          of <strong style={{ color: "var(--text)" }}>{num(total)}</strong>
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No SKUs yet"
          message="Add a SKU or connect a marketplace to sync listings."
          action={
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + Add SKU
            </button>
          }
        />
      ) : (
        <>
          <div className="card card-table-wrap" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 75 }}>Favourite</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 62 }}>Image</th>
                  <th>Product details</th>
                  <th style={{ width: 90 }}>Price</th>
                  <th style={{ width: 90, textAlign: "center" }}>FBA/FBM</th>
                  <th style={{ width: 120 }}>Tags</th>
                  <th style={{ width: 120, textAlign: "right" }}>
                    Channel Stock
                  </th>
                  <th style={{ width: 120, textAlign: "right" }}>Sale</th>
                  <th style={{ width: 110, textAlign: "center" }}>
                    Update Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "center" }}>
                      <span
                        className={"star" + (s.favorite ? " active" : "")}
                        onClick={() => favMut.mutate(s)}
                        role="button"
                        aria-label="Toggle favorite"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill={s.favorite ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      <ProductImg src={s.imageUrl} className="product-img" />
                    </td>
                    <td>
                      <div style={{ minWidth: 0, maxWidth: 380 }}>
                        <div
                          style={{
                            fontWeight: 550,
                            fontSize: 13,
                            lineHeight: 1.4,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {s.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            marginTop: 4,
                          }}
                        >
                          {s.asin && (
                            <span className="copy-btn">{s.asin}</span>
                          )}
                          <span className="copy-btn">{s.sku}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {money(s.price)}
                      </span>
                      {s.basePrice != null && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--text-3)",
                            marginTop: 2,
                          }}
                        >
                          {money(s.basePrice)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {fbaLabel(s.fulfillmentChannel) ? (
                        <span
                          className="badge"
                          style={{
                            background:
                              fbaLabel(s.fulfillmentChannel) === "FBA"
                                ? "var(--info-bg)"
                                : "var(--warning-bg)",
                            color:
                              fbaLabel(s.fulfillmentChannel) === "FBA"
                                ? "var(--info-fg)"
                                : "var(--warning-fg)",
                          }}
                        >
                          {fbaLabel(s.fulfillmentChannel)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-4)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <Tags tags={s.tags} />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 550,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s.stock > 0 ? (
                        num(s.stock)
                      ) : (
                        <span style={{ color: "var(--text-4)" }}>0</span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(() => {
                        const u30 = unitsFor(s, "30d");
                        const u1 = unitsFor(s, "1d");
                        const u7 = unitsFor(s, "7d");
                        const u15 = unitsFor(s, "15d");
                        return (
                          <>
                            <div
                              style={{
                                color:
                                  u30 > 0
                                    ? "var(--success-fg)"
                                    : "var(--text-4)",
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                              title="Units sold in last 30 days"
                            >
                              {num(u30)}
                            </div>
                            <div
                              style={{
                                fontSize: 10.5,
                                color: "var(--text-3)",
                                marginTop: 2,
                                letterSpacing: 0.1,
                              }}
                            >
                              1D {num(u1)} · 7D {num(u7)} · 15D {num(u15)}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        className="btn btn-primary btn-icon btn-sm"
                        title="Update price / Open schedule"
                        onClick={() => setScheduleFor(s)}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              padding: "0 4px",
            }}
          >
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Page {page} of {totalPages}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
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

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(text) => {
          setSearchInput(text);
        }}
      />

      {/* Add SKU modal */}
      <Modal
        open={createOpen}
        title="Add SKU"
        subtitle="Create a listing manually"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={
                createMut.isPending ||
                !draft.sku.trim() ||
                !draft.title.trim() ||
                !draft.price
              }
              onClick={() => createMut.mutate(draft)}
            >
              {createMut.isPending ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            SKU <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.sku}
            onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Title <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">ASIN</label>
          <input
            className="form-control"
            value={draft.asin ?? ""}
            onChange={(e) => setDraft({ ...draft, asin: e.target.value })}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Channel <span className="req">*</span>
            </label>
            <select
              className="form-control"
              value={draft.channel}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  channel: e.target.value as Sku["channel"],
                })
              }
            >
              {SALES_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Status <span className="req">*</span>
            </label>
            <select
              className="form-control"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as Sku["status"],
                })
              }
            >
              {SKU_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Price <span className="req">*</span>
            </label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.price || ""}
              onChange={(e) =>
                setDraft({ ...draft, price: Number(e.target.value) })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Base price</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.basePrice ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  basePrice:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cost</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={draft.cost ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  cost: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Stock</label>
            <input
              className="form-control"
              type="number"
              value={draft.stock ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, stock: Number(e.target.value) })
              }
            />
          </div>
        </div>
        {createMut.isError && (
          <div className="form-help" style={{ color: "var(--danger-fg)" }}>
            Could not create SKU. Check the fields and try again.
          </div>
        )}
      </Modal>

      <PriceScheduleModal
        open={!!scheduleFor}
        sku={
          scheduleFor
            ? {
                id: scheduleFor.id,
                sku: scheduleFor.sku,
                title: scheduleFor.title,
                price: scheduleFor.price,
                asin: scheduleFor.asin,
                imageUrl: scheduleFor.imageUrl,
                channelStock: scheduleFor.stock,
                fulfillmentChannel: scheduleFor.fulfillmentChannel,
                status: scheduleFor.status,
              }
            : null
        }
        onClose={() => setScheduleFor(null)}
      />
    </div>
  );
}
