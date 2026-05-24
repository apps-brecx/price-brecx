import "./Inventory.css";
import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, qs } from "../lib/api";
import { money, num, relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";

interface InventoryRow {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  channel: string;
  status: string;
  fulfillmentChannel: string | null;
  fnSku: string | null;
  merchantQty: number;
  fbaFulfillable: number;
  fbaPending: number;
  stock: number;
  sales30d: number;
  price: number;
  updatedAt: string | null;
}

interface InventoryData {
  items: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
  agg: {
    totalUnits: number;
    outOfStock: number;
    lowStock: number;
    skuCount: number;
  };
  channelCounts: Record<string, number>;
  tabCounts: { all: number; in: number; low: number; out: number };
  lastFbaSync: {
    at: string;
    ok: boolean;
    affected: number | null;
  } | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  shopify: "Shopify",
  tiktok: "TikTok",
  ebay: "eBay",
  etsy: "Etsy",
  faire: "Faire",
};

const CHANNEL_DOTS: Record<string, string> = {
  amazon: "#ff9900",
  walmart: "#0071dc",
  shopify: "#96bf48",
  tiktok: "#ff0050",
  ebay: "#e53238",
  etsy: "#f1641e",
  faire: "#000000",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function channelDot(channel: string): string {
  return CHANNEL_DOTS[channel] ?? "var(--text-3)";
}

/** "DEFAULT" = merchant-fulfilled (FBM); anything else = Amazon-fulfilled. */
function fbaLabel(fc: string | null): "FBA" | "FBM" | null {
  if (!fc) return null;
  return fc === "DEFAULT" ? "FBM" : "FBA";
}

function stockLevel(stock: number): {
  label: string;
  cls: "" | "low" | "out";
} {
  if (stock <= 0) return { label: "Out of stock", cls: "out" };
  if (stock < 10) return { label: "Low stock", cls: "low" };
  return { label: "In stock", cls: "" };
}

const STOCK_CAP = 200;

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#f3f4f6"/></svg>',
  );

function ProductImg({ src }: { src: string | null }) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      className="inv-thumb"
      src={!src || errored ? FALLBACK_IMG : src}
      alt=""
      onError={() => setErrored(true)}
    />
  );
}

type StockTab = "all" | "in" | "low" | "out";

export function Inventory() {
  const toast = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StockTab>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce search input so we don't spam the API every keystroke. 250ms
  // matches the SKUs page convention.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change resets to page 1 so the user doesn't end up looking
  // at "page 5 of 1" after narrowing the result set.
  useEffect(() => {
    setPage(1);
  }, [search, tab, channelFilter, pageSize]);

  // Server-side pagination + filtering. `keepPreviousData` keeps the old
  // page visible during the next fetch so the UI doesn't flash empty.
  const query = useQuery({
    queryKey: ["inventory", { search, tab, channelFilter, page, pageSize }],
    queryFn: () =>
      api.get<InventoryData>(
        "/inventory" +
          qs({
            search,
            tab,
            channel: channelFilter === "all" ? undefined : channelFilter,
            page,
            pageSize,
          }),
      ),
    placeholderData: keepPreviousData,
  });

  const syncMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/skus/sync"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.info(
        "Sync started",
        "Pulling listings, FBA stock, and sales from Amazon. Inventory refreshes automatically when it's done — usually a few minutes.",
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't start sync",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text);
    toast.success("Copied", `${label} copied to clipboard.`);
  }

  // Server-side pagination — `items` IS the current page. Filtered is just
  // an alias used by the rest of the render code.
  const items = query.data?.items ?? [];
  const filtered = items;
  // KPIs come from the server's aggregate queries (whole workspace) so the
  // chips don't lie about totals when the user is filtering.
  const channelCounts = query.data?.channelCounts ?? { all: 0 };
  const tabCounts =
    query.data?.tabCounts ?? { all: 0, in: 0, low: 0, out: 0 };
  const channels = Object.keys(channelCounts).filter((c) => c !== "all");
  // Pagination derived values for the footer.
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const fromN = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toN = Math.min(currentPage * pageSize, total);

  function pageWindow(current: number, totalP: number): (number | "…")[] {
    if (totalP <= 7) return Array.from({ length: totalP }, (_, i) => i + 1);
    const out: (number | "…")[] = [1];
    const lo = Math.max(2, current - 2);
    const hi = Math.min(totalP - 1, current + 2);
    if (lo > 2) out.push("…");
    for (let i = lo; i <= hi; i++) out.push(i);
    if (hi < totalP - 1) out.push("…");
    out.push(totalP);
    return out;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: 4,
            }}
          >
            Inventory
          </h1>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Stock levels across all connected marketplaces
            {query.data?.lastFbaSync && (
              <>
                {" · "}
                <span
                  style={{
                    color: query.data.lastFbaSync.ok
                      ? "var(--text-3)"
                      : "var(--danger-fg)",
                  }}
                  title={
                    query.data.lastFbaSync.ok
                      ? "Last FBA stock sync"
                      : "Last FBA stock sync failed — check Activity Log"
                  }
                >
                  FBA stock synced {relativeTime(query.data.lastFbaSync.at)}
                  {!query.data.lastFbaSync.ok && " (failed)"}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          title="Pull listings, FBA stock, and sales from Amazon"
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
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <>
          {query.data.agg.skuCount > 0 &&
            query.data.agg.totalUnits === 0 && (
              <div className="inv-empty-banner">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ flex: "none" }}
                >
                  <path d="M12 9v4M12 17h.01" />
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
                <div style={{ flex: 1 }}>
                  <div className="inv-empty-banner-title">
                    {query.data.lastFbaSync?.ok
                      ? "Amazon returned 0 stock"
                      : "No stock data yet"}
                  </div>
                  <div className="inv-empty-banner-msg">
                    You have {num(query.data.agg.skuCount)} SKUs but all show 0
                    units.{" "}
                    {query.data.lastFbaSync
                      ? query.data.lastFbaSync.ok
                        ? `Last FBA stock sync was ${relativeTime(
                            query.data.lastFbaSync.at,
                          )}. The auto-sync runs daily at 11:00 AM (Asia/Dhaka) — or sync now to refresh immediately.`
                        : `The last FBA sync failed — check Activity Log. Daily auto-sync runs at 11:00 AM (Asia/Dhaka).`
                      : "The auto-sync runs daily at 11:00 AM (Asia/Dhaka). Sync now to populate stock immediately."}
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={syncMut.isPending}
                  onClick={() => syncMut.mutate()}
                >
                  {syncMut.isPending ? "Starting…" : "Sync now"}
                </button>
              </div>
            )}

          <div className="dash-kpi-grid" style={{ marginBottom: 18 }}>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Total units</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.totalUnits)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">
                  {num(query.data.agg.skuCount)}
                </span>
                <span>SKUs across all channels</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Out of stock</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.outOfStock)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip down">SKUs</span>
                <span>blocking sales</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Low stock</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.lowStock)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip down">Below 10</span>
                <span>needs attention</span>
              </div>
            </div>
          </div>

          {/* Filter / search bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            {(
              [
                ["all", "All", tabCounts.all],
                ["in", "In stock", tabCounts.in],
                ["low", "Low stock", tabCounts.low],
                ["out", "Out of stock", tabCounts.out],
              ] as const
            ).map(([key, label, count]) => (
              <div
                key={key}
                className={"filter-chip" + (tab === key ? " active" : "")}
                onClick={() => setTab(key)}
              >
                {label} <span className="count">{count}</span>
              </div>
            ))}

            <div style={{ flex: 1 }} />

            {channels.length > 1 && (
              <select
                className="input"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                style={{
                  height: 32,
                  padding: "0 10px",
                  fontSize: 13,
                  width: "auto",
                }}
              >
                <option value="all">All channels</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel(c)} ({channelCounts[c]})
                  </option>
                ))}
              </select>
            )}

            <div className="input-wrap" style={{ minWidth: 240 }}>
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
                placeholder="Search ASIN, SKU, title…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={items.length === 0 ? "No inventory" : "No matches"}
              message={
                items.length === 0
                  ? "Connect a marketplace to sync stock levels."
                  : "Try a different search or filter."
              }
            />
          ) : (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-2)",
                  marginBottom: 10,
                }}
              >
                Showing{" "}
                <strong style={{ color: "var(--text)" }}>
                  {num(fromN)}-{num(toN)}
                </strong>{" "}
                of <strong style={{ color: "var(--text)" }}>{num(total)}</strong>{" "}
                SKU{total === 1 ? "" : "s"}
              </div>
              <div className="inv-product-list">
                {filtered.map((r) => {
                  const isOpen = open.has(r.skuId);
                  const level = stockLevel(r.stock);
                  const fillPct = Math.min(
                    100,
                    Math.max(2, Math.round((r.stock / STOCK_CAP) * 100)),
                  );
                  const fc = fbaLabel(r.fulfillmentChannel);
                  return (
                    <div
                      key={r.skuId}
                      className={`inv-product-card${isOpen ? " open" : ""}`}
                    >
                      <div
                        className="inv-product-head"
                        onClick={() => toggle(r.skuId)}
                      >
                        <div className="inv-product-thumb-wrap">
                          <ProductImg src={r.imageUrl} />
                        </div>
                        <div className="inv-product-info">
                          <div className="inv-product-name">{r.title}</div>
                          <div className="inv-product-meta">
                            <span
                              className="inv-channel-pill"
                              title={channelLabel(r.channel)}
                            >
                              <span
                                className="inv-mp-dot"
                                style={{ background: channelDot(r.channel) }}
                              />
                              {channelLabel(r.channel)}
                            </span>
                            {fc && (
                              <span className={`inv-fc-pill ${fc.toLowerCase()}`}>
                                {fc}
                              </span>
                            )}
                            {r.asin && (
                              <span
                                className="inv-copy"
                                title="Click to copy ASIN"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copy(r.asin!, "ASIN");
                                }}
                              >
                                {r.asin}
                              </span>
                            )}
                            <span
                              className="inv-copy"
                              title="Click to copy SKU"
                              onClick={(e) => {
                                e.stopPropagation();
                                copy(r.sku, "SKU");
                              }}
                            >
                              {r.sku}
                            </span>
                          </div>
                        </div>
                        <div className="inv-product-right">
                          <div className="inv-total-stock">
                            <div className="inv-total-stock-label">
                              Total stock
                            </div>
                            <div
                              className={`inv-total-stock-value ${level.cls}`}
                            >
                              {num(r.stock)}
                            </div>
                          </div>
                          <div className={`inv-status-pill ${level.cls}`}>
                            {level.label}
                          </div>
                          <svg
                            className="inv-chevron"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>
                      <div className="inv-product-body">
                        <div className="inv-progress">
                          <div
                            className={`inv-progress-fill ${level.cls}`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>

                        <div className="inv-breakdown-grid">
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">Merchant qty</div>
                            <div className="inv-bd-value">
                              {num(r.merchantQty)}
                            </div>
                            <div className="inv-bd-foot">FBM on-hand</div>
                          </div>
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">FBA fulfillable</div>
                            <div className="inv-bd-value">
                              {num(r.fbaFulfillable)}
                            </div>
                            <div className="inv-bd-foot">ready to ship</div>
                          </div>
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">FBA inbound</div>
                            <div className="inv-bd-value">
                              {num(r.fbaPending)}
                            </div>
                            <div className="inv-bd-foot">pending transship</div>
                          </div>
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">30d sales</div>
                            <div className="inv-bd-value">
                              {num(r.sales30d)}
                            </div>
                            <div className="inv-bd-foot">units sold</div>
                          </div>
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">Price</div>
                            <div className="inv-bd-value">{money(r.price)}</div>
                            <div className="inv-bd-foot">current</div>
                          </div>
                          <div className="inv-bd-card">
                            <div className="inv-bd-label">Last synced</div>
                            <div className="inv-bd-value small">
                              {r.updatedAt ? relativeTime(r.updatedAt) : "—"}
                            </div>
                            <div className="inv-bd-foot">
                              {r.fnSku ? `FN: ${r.fnSku}` : "no FN-SKU"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Server-side pagination footer — same compact pattern as
                  the SKUs + Pricing pages. */}
              {totalPages > 1 && (
                <div className="inv-pagination">
                  <button
                    className="inv-page-arrow"
                    title="Previous page"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  {pageWindow(currentPage, totalPages).map((p, i) =>
                    p === "…" ? (
                      <span key={`e${i}`} className="inv-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        className={
                          "inv-page-btn" +
                          (p === currentPage ? " active" : "")
                        }
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    className="inv-page-arrow"
                    title="Next page"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <select
                    className="inv-pagesize"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {[25, 50, 100, 200].map((n) => (
                      <option key={n} value={n}>
                        {n} / page
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
