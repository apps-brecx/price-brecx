import "./SKUs.css";
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

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 25;

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
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [scanOpen, setScanOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<SkuCreateInput>(emptyDraft);
  const [scheduleFor, setScheduleFor] = useState<Sku | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");

  // ---- Filters ----
  type ChannelKey =
    | "amazon-fba"
    | "amazon-fbm"
    | "shopify"
    | "walmart"
    | "tiktok"
    | "ebay";
  type StockBucket = "in" | "low" | "out";
  interface AppliedFilters {
    channels: ChannelKey[];
    stockBuckets: StockBucket[];
    priceMin: string;
    priceMax: string;
  }
  const EMPTY_FILTERS: AppliedFilters = {
    channels: [],
    stockBuckets: [],
    priceMin: "",
    priceMax: "",
  };
  // `filters` is the *applied* state (drives the API query); `draftFilters`
  // is what the dropdown is currently editing until the user hits Apply.
  const [filters, setFilters] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] =
    useState<AppliedFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  type Tab = "all" | "active" | "inactive" | "favorites" | "scheduled";
  const [tab, setTab] = useState<Tab>("all");

  // Reset to page 1 + clear selection when the tab changes.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab]);

  // Debounce search → resets to page 1 + clears selection.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Applying filters always resets to page 1 and drops the current selection
  // (a row might fall off the filtered set).
  function applyFilters(next: AppliedFilters) {
    setFilters(next);
    setPage(1);
    setSelected(new Set());
    setFiltersOpen(false);
  }
  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
  }
  function toggleDraftArrayValue<T extends string>(
    key: "channels" | "stockBuckets",
    val: T,
  ) {
    setDraftFilters((cur) => {
      const arr = cur[key] as T[];
      const next = arr.includes(val)
        ? arr.filter((v) => v !== val)
        : [...arr, val];
      return { ...cur, [key]: next };
    });
  }

  // Sync draft state when the dropdown opens (so editing always starts from
  // the currently-applied filters, not whatever was left from a previous
  // cancel).
  useEffect(() => {
    if (filtersOpen) setDraftFilters(filters);
  }, [filtersOpen, filters]);

  // Close the dropdown on outside click / escape.
  useEffect(() => {
    if (!filtersOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFiltersOpen(false);
    }
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".skus-filters")) return;
      setFiltersOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [filtersOpen]);

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

  const filterParams = useMemo(() => {
    const out: Record<string, string> = {};
    if (filters.channels.length) out.channels = filters.channels.join(",");
    if (filters.stockBuckets.length)
      out.stockBuckets = filters.stockBuckets.join(",");
    if (filters.priceMin) out.priceMin = filters.priceMin;
    if (filters.priceMax) out.priceMax = filters.priceMax;
    return out;
  }, [filters]);

  const activeFilterCount =
    filters.channels.length +
    filters.stockBuckets.length +
    (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0);

  const query = useQuery({
    queryKey: ["skus", { search, page, pageSize, tab, filterParams }],
    queryFn: () =>
      api.get<Paginated<Sku>>(
        `/skus${qs({
          search,
          page,
          pageSize,
          ...tabParams,
          ...filterParams,
        })}`,
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
  const totalPages = data ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const items = data?.items ?? [];
  const fromN = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toN = Math.min(page * pageSize, total);

  /**
   * Page-number window for the pagination control. Renders up to 7 buttons:
   * always shows first + last, with current ±2 and ellipses where needed.
   * Returns either a real page number or "…" so the JSX can decide.
   */
  function pageWindow(current: number, totalP: number): (number | "…")[] {
    if (totalP <= 7) {
      return Array.from({ length: totalP }, (_, i) => i + 1);
    }
    const out: (number | "…")[] = [1];
    const lo = Math.max(2, current - 2);
    const hi = Math.min(totalP - 1, current + 2);
    if (lo > 2) out.push("…");
    for (let i = lo; i <= hi; i++) out.push(i);
    if (hi < totalP - 1) out.push("…");
    out.push(totalP);
    return out;
  }

  // ---- Bulk selection helpers ----
  const idsOnPage = useMemo(() => items.map((s) => s.id), [items]);
  const selectedOnPage = useMemo(
    () => idsOnPage.filter((id) => selected.has(id)),
    [idsOnPage, selected],
  );
  const allSelectedOnPage =
    idsOnPage.length > 0 && selectedOnPage.length === idsOnPage.length;
  const someSelectedOnPage =
    selectedOnPage.length > 0 && selectedOnPage.length < idsOnPage.length;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        for (const id of idsOnPage) next.delete(id);
      } else {
        for (const id of idsOnPage) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  /** Pull every row we know about across pages (current page + cache). Bulk
   *  CSV uses this so a "Export selected" hit on page 2 includes page 1 rows
   *  the user selected earlier without an extra round-trip. */
  function selectedSkuRows(): Sku[] {
    return items.filter((s) => selected.has(s.id));
  }

  const tagSelectedMut = useMutation({
    mutationFn: async (newTag: string) => {
      const label = newTag.trim();
      if (!label) return { count: 0 };
      const rows = selectedSkuRows();
      // PATCH one SKU at a time — appends a new tag *object* `{label,color}`
      // (not a string) so it matches the `tagSchema` on the server. Dedup by
      // label so re-applying the same tag is a no-op.
      let count = 0;
      for (const s of rows) {
        const existing = s.tags ?? [];
        if (existing.some((t) => t.label === label)) continue;
        const tags = [...existing, { label, color: "neutral" as const }];
        await api.patch<Sku>(`/skus/${s.id}`, { tags });
        count += 1;
      }
      return { count };
    },
    onSuccess: ({ count }) => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      setTagModalOpen(false);
      setTagDraft("");
      toast.success(
        "Tag added",
        `Applied to ${count} SKU${count === 1 ? "" : "s"}.`,
      );
    },
    onError: (err) =>
      toast.error(
        "Couldn't tag",
        err instanceof Error ? err.message : "Try again.",
      ),
  });

  function exportSelectedCsv() {
    const rows = selectedSkuRows();
    if (rows.length === 0) return;
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
      ...rows.map((s) =>
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
    a.download = `skus-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function bulkSchedule() {
    const rows = selectedSkuRows();
    if (rows.length === 0) return;
    if (rows.length > 1) {
      toast.info(
        "Opens for the first selected SKU",
        "Bulk-schedule across multiple SKUs is coming — set this one, then move to the next.",
      );
    }
    setScheduleFor(rows[0]);
  }

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

        {/* Filters dropdown — multi-select, opens to the right of the chip */}
        <div className="skus-filters">
          <div
            className={
              "filter-chip" + (activeFilterCount > 0 ? " active" : "")
            }
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="count">{activeFilterCount}</span>
            )}
          </div>
          {filtersOpen && (
            <div className="skus-filter-menu">
              <div className="skus-filter-section-label">Channel</div>
              {(
                [
                  ["amazon-fba", "Amazon FBA"],
                  ["amazon-fbm", "Amazon FBM"],
                  ["shopify", "Shopify"],
                  ["walmart", "Walmart"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="skus-filter-row">
                  <input
                    type="checkbox"
                    checked={draftFilters.channels.includes(key)}
                    onChange={() =>
                      toggleDraftArrayValue("channels", key)
                    }
                  />
                  {label}
                </label>
              ))}

              <div className="skus-filter-divider" />
              <div className="skus-filter-section-label">Price Range</div>
              <div className="skus-filter-price-row">
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={draftFilters.priceMin}
                  onChange={(e) =>
                    setDraftFilters((cur) => ({
                      ...cur,
                      priceMin: e.target.value,
                    }))
                  }
                />
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  placeholder="Max"
                  value={draftFilters.priceMax}
                  onChange={(e) =>
                    setDraftFilters((cur) => ({
                      ...cur,
                      priceMax: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="skus-filter-divider" />
              <div className="skus-filter-section-label">Stock</div>
              {(
                [
                  ["in", "In Stock (> 0)"],
                  ["low", "Low Stock (< 50)"],
                  ["out", "Out of Stock"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="skus-filter-row">
                  <input
                    type="checkbox"
                    checked={draftFilters.stockBuckets.includes(key)}
                    onChange={() =>
                      toggleDraftArrayValue("stockBuckets", key)
                    }
                  />
                  {label}
                </label>
              ))}

              <div className="skus-filter-actions">
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ flex: 1 }}
                  onClick={resetFilters}
                >
                  Reset
                </button>
                <button
                  className="btn btn-primary btn-xs"
                  style={{ flex: 1 }}
                  onClick={() => applyFilters(draftFilters)}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
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
            <table className="tbl tbl-sticky">
              <thead>
                <tr>
                  <th style={{ width: 38, textAlign: "center" }}>
                    <input
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            someSelectedOnPage && !allSelectedOnPage;
                        }
                      }}
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={allSelectedOnPage}
                      onChange={toggleAllOnPage}
                    />
                  </th>
                  <th style={{ width: 65 }}>Favourite</th>
                  <th style={{ width: 80 }}>Status</th>
                  <th style={{ width: 62 }}>Image</th>
                  <th>Product details</th>
                  <th style={{ width: 90 }}>Price</th>
                  <th style={{ width: 90, textAlign: "center" }}>FBA/FBM</th>
                  <th style={{ width: 120 }}>Tags</th>
                  <th style={{ width: 120, textAlign: "right" }}>
                    Channel Stock
                  </th>
                  <th style={{ width: 170, textAlign: "right" }}>
                    Sale (1D · 7D · 15D · 30D)
                  </th>
                  <th style={{ width: 110, textAlign: "center" }}>
                    Update Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr
                    key={s.id}
                    className={selected.has(s.id) ? "row-selected" : ""}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.sku}`}
                        checked={selected.has(s.id)}
                        onChange={() => toggleRow(s.id)}
                      />
                    </td>
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

          {/* Pagination footer — right-aligned, single row */}
          <div className="skus-pagination">
            <span className="skus-pagination-range">
              {total === 0 ? (
                "0 of 0"
              ) : (
                <>
                  {num(fromN)}-{num(toN)} of {num(total)}
                </>
              )}
            </span>
            <button
              className="skus-page-arrow"
              title="Previous page"
              disabled={page <= 1}
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
            {pageWindow(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="skus-pagination-ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={
                    "skus-page-btn" + (p === page ? " active" : "")
                  }
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ),
            )}
            <button
              className="skus-page-arrow"
              title="Next page"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
              className="skus-pagesize"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
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

      {/* Bulk action bar — slides up when any SKU is selected */}
      <div className={"bulk-bar" + (selected.size > 0 ? " show" : "")}>
        <div className="bulk-bar-count">
          <strong>{selected.size}</strong>
          <span>selected</span>
        </div>
        <div className="bulk-bar-actions">
          <button
            type="button"
            title="Add a tag to the selected SKUs"
            onClick={() => setTagModalOpen(true)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Tag
          </button>
          <button
            type="button"
            title="Export selected SKUs as CSV"
            onClick={exportSelectedCsv}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export
          </button>
          <div className="bulk-bar-divider" />
          <button
            type="button"
            className="primary"
            title="Schedule a price change"
            onClick={bulkSchedule}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Schedule Price
          </button>
          <div className="bulk-bar-divider" />
          <button
            type="button"
            className="close-btn"
            title="Clear selection"
            onClick={clearSelection}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tag modal — adds one tag to all selected SKUs */}
      <Modal
        open={tagModalOpen}
        title="Add tag"
        subtitle={`Will be added to ${selected.size} selected SKU${selected.size === 1 ? "" : "s"}.`}
        onClose={() => {
          setTagModalOpen(false);
          setTagDraft("");
        }}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setTagModalOpen(false);
                setTagDraft("");
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={tagSelectedMut.isPending || !tagDraft.trim()}
              onClick={() => tagSelectedMut.mutate(tagDraft)}
            >
              {tagSelectedMut.isPending ? "Tagging…" : "Apply tag"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Tag</label>
          <input
            className="form-control"
            placeholder="e.g. Spices"
            autoFocus
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagDraft.trim()) {
                tagSelectedMut.mutate(tagDraft);
              }
            }}
          />
          <div className="form-help">
            Appended to the SKU's existing tags. Duplicates are skipped.
          </div>
        </div>
      </Modal>
    </div>
  );
}
