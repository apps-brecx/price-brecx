import "./Products.css";
import "./Inventory.css";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CHANNEL_LABELS, SALES_CHANNELS } from "@fbm/shared";
import { api } from "../lib/api";
import { money, num, relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { PriceScheduleModal } from "../components/PriceScheduleModal";
import { useToast } from "../components/Toast";

interface ChannelPrice {
  skuId: string;
  sku: string;
  price: number;
  basePrice: number | null;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  asin: string | null;
  skuIds: string[];
  createdAt: string;
  updatedAt: string | null;
  primarySku: string;
  skuCount: number;
  channels: Record<string, ChannelPrice>;
}

interface ProductsData {
  items: ProductRow[];
  total: number;
  knownChannels: string[];
  agg: {
    totalProducts: number;
    avgBasePrice: number | null;
    listedOnAllChannels: number;
    lastEditedAt: string | null;
  };
}

interface ProductDraft {
  name: string;
  description: string;
}

const emptyDraft: ProductDraft = { name: "", description: "" };

/** Fallback channel order if the workspace has none yet — keeps the table
 *  structure visible even before any SKUs are linked. */
const FALLBACK_CHANNELS = ["amazon", "walmart", "tiktok", "shopify"] as const;

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function Products() {
  const qc = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [scheduleFor, setScheduleFor] = useState<{
    id: string;
    sku: string;
    title: string;
    price: number;
  } | null>(null);

  const query = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<ProductsData>("/products"),
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string; skuIds: string[] }) =>
      api.post<ProductRow>("/products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      setCreateOpen(false);
      setDraft(emptyDraft);
      toast.success("Product created");
    },
    onError: (err) =>
      toast.error(
        "Couldn't create product",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      toast.success("Product deleted");
    },
  });

  const syncMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; inserted: number; updated: number }>(
        "/products/sync",
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
      toast.success(
        "Products synced",
        `${data.inserted} new · ${data.updated} relinked`,
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't sync products",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  function openCreate() {
    setDraft(emptyDraft);
    setCreateOpen(true);
  }

  function submitCreate() {
    const name = draft.name.trim();
    if (!name) return;
    createMut.mutate({
      name,
      description: draft.description.trim() || undefined,
      skuIds: [],
    });
  }

  function confirmDelete(p: ProductRow) {
    if (window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) {
      deleteMut.mutate(p.id);
    }
  }

  const data = query.data;
  const items = data?.items ?? [];

  // Columns: real channels from the data; fall back to a canonical set so the
  // header stays meaningful before any SKU is linked.
  const channels = useMemo(() => {
    const known = data?.knownChannels ?? [];
    if (known.length > 0) {
      // Preserve SALES_CHANNELS ordering for stability across renders.
      const order = SALES_CHANNELS as readonly string[];
      return [...known].sort(
        (a, b) =>
          (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
          (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
      );
    }
    return [...FALLBACK_CHANNELS];
  }, [data?.knownChannels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.primarySku.toLowerCase().includes(q),
    );
  }, [items, search]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );
  const fromN = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toN = Math.min(currentPage * pageSize, filtered.length);

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

  function exportCsv() {
    if (filtered.length === 0) return;
    const header = ["Product", "Primary SKU", ...channels.map((c) =>
      (CHANNEL_LABELS as Record<string, string>)[c] ?? c,
    )];
    const lines = [
      header.join(","),
      ...filtered.map((p) =>
        [
          p.name,
          p.primarySku,
          ...channels.map((c) =>
            p.channels[c]?.price != null
              ? p.channels[c].price.toFixed(2)
              : "",
          ),
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
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Header with action button */}
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
            Products
          </h1>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Base prices across all connected marketplaces.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            title="Group SKUs by ASIN — picks up any new listings since the last sync"
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
            {syncMut.isPending ? "Syncing…" : "Sync from SKUs"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={filtered.length === 0}
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export
          </button>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Product
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError || !data ? (
        <ErrorState />
      ) : (
        <>
          {/* KPI cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div className="dash-kpi">
              <div className="dash-kpi-label">Total Products</div>
              <div className="dash-kpi-value">{num(data.agg.totalProducts)}</div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>across catalogue</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Avg. base price</div>
              <div className="dash-kpi-value">
                {data.agg.avgBasePrice != null
                  ? money(data.agg.avgBasePrice)
                  : "—"}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>across linked SKUs</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Listed on all channels</div>
              <div className="dash-kpi-value">
                {num(data.agg.listedOnAllChannels)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>of {num(data.agg.totalProducts)} products</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Last edited</div>
              <div
                className="dash-kpi-value"
                style={{ fontSize: 22 }}
                title={data.agg.lastEditedAt ?? undefined}
              >
                {data.agg.lastEditedAt
                  ? relativeTime(data.agg.lastEditedAt)
                  : "—"}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>most recent change</span>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div className="input-wrap" style={{ flex: 1, maxWidth: 380 }}>
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
                placeholder="Search products by name or SKU..."
                style={{ width: "100%" }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              {filtered.length > 0 && (
                <>
                  Showing{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {num(fromN)}-{num(toN)}
                  </strong>{" "}
                  of{" "}
                </>
              )}
              <strong style={{ color: "var(--text)" }}>{num(filtered.length)}</strong>
              {filtered.length !== items.length && (
                <> of {num(items.length)}</>
              )}{" "}
              {filtered.length === 1 ? "product" : "products"}
              {query.isFetching && !query.isLoading && (
                <span
                  className="spinner-inline"
                  style={{ marginLeft: 8 }}
                  aria-label="Loading"
                />
              )}
            </div>
          </div>

          {/* Table */}
          {items.length === 0 ? (
            <EmptyState
              title="No products yet"
              message="Create a product to group related SKUs together."
              action={
                <button className="btn btn-primary" onClick={openCreate}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ marginRight: 6, verticalAlign: "-1px" }}
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Product
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={`No products match "${search}"`}
              message="Try a different search term."
            />
          ) : (
            <div
              className={
                "card" +
                (query.isFetching && !query.isLoading ? " is-refetching" : "")
              }
              style={{ padding: 0, overflow: "hidden" }}
            >
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style={{ width: 140 }}>SKU</th>
                    {channels.map((c) => (
                      <th
                        key={c}
                        style={{ width: 120, textAlign: "right" }}
                      >
                        {(CHANNEL_LABELS as Record<string, string>)[c] ?? c}
                      </th>
                    ))}
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="prod-name">{p.name}</div>
                        {p.description && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-3)",
                              marginTop: 3,
                            }}
                          >
                            {p.description}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-3)",
                            marginTop: 3,
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          {p.asin && (
                            <span style={{ fontFamily: "var(--font-mono)" }}>
                              ASIN: {p.asin}
                            </span>
                          )}
                          {p.skuCount > 1 && (
                            <span>{p.skuCount} linked SKUs</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="prod-sku">{p.primarySku}</span>
                      </td>
                      {channels.map((c) => {
                        const ch = p.channels[c];
                        if (!ch?.price && ch?.price !== 0)
                          return (
                            <td key={c} style={{ textAlign: "right" }}>
                              <span style={{ color: "var(--text-3)" }}>—</span>
                            </td>
                          );
                        return (
                          <td key={c} style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="prod-price prod-price-btn"
                              title={`Click to schedule a price change · SKU ${ch.sku}`}
                              onClick={() =>
                                setScheduleFor({
                                  id: ch.skuId,
                                  sku: ch.sku,
                                  title: p.name,
                                  price: ch.price,
                                })
                              }
                            >
                              {money(ch.price)}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "center" }}>
                        <div
                          className="prod-delete"
                          title="Delete product"
                          role="button"
                          aria-label={`Delete ${p.name}`}
                          onClick={() => confirmDelete(p)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && totalPages > 1 && (
            <div className="inv-pagination">
              <button
                className="inv-page-arrow"
                title="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              {pageWindow(currentPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="inv-page-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={"inv-page-btn" + (p === currentPage ? " active" : "")}
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
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <select
                className="inv-pagesize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <Modal
        open={createOpen}
        title="New product"
        subtitle="Group related SKUs under a single product."
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
              disabled={createMut.isPending || !draft.name.trim()}
              onClick={submitCreate}
            >
              {createMut.isPending ? "Creating…" : "Create product"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Name <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.name}
            autoFocus
            placeholder="e.g. Syruvia Vanilla Coffee Syrup"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-control"
            rows={3}
            value={draft.description}
            placeholder="Optional notes about this product."
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
          <div className="form-help">
            SKUs can be linked to this product after it is created.
          </div>
        </div>
        {createMut.isError && (
          <div className="form-help" style={{ color: "var(--danger-fg)" }}>
            Failed to create product. Please try again.
          </div>
        )}
      </Modal>

      <PriceScheduleModal
        open={!!scheduleFor}
        sku={scheduleFor}
        onClose={() => setScheduleFor(null)}
      />
    </div>
  );
}
