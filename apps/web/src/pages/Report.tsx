import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReportRow } from "@fbm/shared";
import { api } from "../lib/api";
import { money, num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";

interface SalesReport {
  items: ReportRow[];
  totals: { units: number; revenue: number };
}

const PAGE_SIZE = 25;

/** Distinct palette for the donut / legend (real data, fixed colors). */
const PIE_COLORS = [
  "#1f47e5",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f59e0b",
];
const OTHER_COLOR = "#cbd2dd";

interface DonutSlice {
  label: string;
  value: number;
  color: string;
  pct: number;
}

/**
 * Inline SVG donut driven entirely by real revenue data.
 * No chart library is installed — slices are circle stroke-dasharray arcs.
 */
function Donut({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;

  if (total <= 0) {
    return (
      <svg viewBox="0 0 160 160" width="100%" height="100%" role="img">
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="22"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 160 160" width="100%" height="100%" role="img">
      <g transform="rotate(-90 80 80)">
        {slices.map((s) => {
          const len = (s.value / total) * c;
          const seg = (
            <circle
              key={s.label}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="22"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

/**
 * Tiny inline SVG bar pair comparing the selected SKU's units vs revenue.
 * Each metric is normalized against the dataset max so bars stay readable.
 */
function CompareBars({
  units,
  revenue,
  maxUnits,
  maxRevenue,
}: {
  units: number;
  revenue: number;
  maxUnits: number;
  maxRevenue: number;
}) {
  const W = 240;
  const H = 130;
  const pad = 8;
  const baseY = H - 22;
  const barW = 70;
  const maxBarH = baseY - pad;
  const uH = maxUnits > 0 ? (units / maxUnits) * maxBarH : 0;
  const rH = maxRevenue > 0 ? (revenue / maxRevenue) * maxBarH : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
      <line
        x1={pad}
        y1={baseY}
        x2={W - pad}
        y2={baseY}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <rect
        x={W * 0.28 - barW / 2}
        y={baseY - uH}
        width={barW}
        height={uH}
        rx="4"
        fill="#1f47e5"
      />
      <rect
        x={W * 0.72 - barW / 2}
        y={baseY - rH}
        width={barW}
        height={rH}
        rx="4"
        fill="#14b8a6"
      />
      <text
        x={W * 0.28}
        y={baseY + 14}
        textAnchor="middle"
        fontSize="10.5"
        fill="var(--text-3)"
      >
        Units
      </text>
      <text
        x={W * 0.72}
        y={baseY + 14}
        textAnchor="middle"
        fontSize="10.5"
        fill="var(--text-3)"
      >
        Revenue
      </text>
    </svg>
  );
}

const CopyIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export function Report() {
  const query = useQuery({
    queryKey: ["reports", "sales"],
    queryFn: () => api.get<SalesReport>("/reports/sales"),
  });

  const data = query.data;

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Real data, sorted by revenue desc.
  const sorted = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.revenue - a.revenue),
    [data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.title.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  // Donut: top SKUs by revenue (real data); remainder grouped as "Other".
  const donutSlices = useMemo<DonutSlice[]>(() => {
    if (sorted.length === 0) return [];
    const totalRev = sorted.reduce((s, r) => s + r.revenue, 0);
    if (totalRev <= 0) return [];
    const topN = sorted.slice(0, PIE_COLORS.length);
    const slices: DonutSlice[] = topN.map((r, i) => ({
      label: r.title,
      value: r.revenue,
      color: PIE_COLORS[i],
      pct: (r.revenue / totalRev) * 100,
    }));
    const rest = sorted.slice(PIE_COLORS.length);
    const restRev = rest.reduce((s, r) => s + r.revenue, 0);
    if (restRev > 0) {
      slices.push({
        label: `Other (${rest.length})`,
        value: restRev,
        color: OTHER_COLOR,
        pct: (restRev / totalRev) * 100,
      });
    }
    return slices;
  }, [sorted]);

  const maxUnits = useMemo(
    () => sorted.reduce((m, r) => Math.max(m, r.units), 0),
    [sorted],
  );
  const maxRevenue = useMemo(
    () => sorted.reduce((m, r) => Math.max(m, r.revenue), 0),
    [sorted],
  );

  const selected = useMemo(
    () => sorted.find((r) => r.skuId === selectedId) ?? null,
    [sorted, selectedId],
  );

  function toggleFav(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
  }

  if (query.isLoading) return <Loading />;
  if (query.isError || !data) return <ErrorState />;

  const showingFrom = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const showingTo = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="rp-page-wrap">
      {/* Toolbar: search + static range pill + real totals */}
      <div className="rp-toolbar">
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
            placeholder="Search by Product Name or SKU..."
            style={{ width: "100%" }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>

        {/* Range pill is a static visual: the endpoint has no range param. */}
        <div className="rp-range-pill" aria-disabled title="No date range available">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: ".04em",
            }}
          >
            Range
          </span>
          <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
            All time
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Real totals from the API */}
        <div className="rp-toggle">
          <span className="rp-toggle-label">Total Units</span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>
            {num(data.totals.units)}
          </span>
        </div>
        <div className="rp-toggle">
          <span className="rp-toggle-label">Total Revenue</span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>
            {money(data.totals.revenue)}
          </span>
        </div>
      </div>

      {/* Main split: table + details panel */}
      <div className="rp-main-split">
        {/* LEFT: scrollable table card with pagination footer */}
        <div className="card rp-table-card">
          <div className="rp-table-scroll">
            <table className="rp-table">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: "center" }}>Favorite</th>
                  <th style={{ width: 70 }}>Image</th>
                  <th>Title</th>
                  <th style={{ width: 130, textAlign: "center" }}>Units</th>
                  <th style={{ width: 140, textAlign: "center" }}>Revenue</th>
                  <th style={{ width: 120, textAlign: "center" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <EmptyState
                        title="No products"
                        message={
                          search
                            ? `No products match "${search}".`
                            : "There is no sales activity yet."
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => {
                    const isSel = r.skuId === selectedId;
                    const isFav = favorites.has(r.skuId);
                    return (
                      <tr
                        key={r.skuId}
                        className={isSel ? "rp-selected" : ""}
                        onClick={() => setSelectedId(r.skuId)}
                      >
                        <td
                          style={{ textAlign: "center" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            className={`rp-fav-star ${isFav ? "active" : ""}`}
                            onClick={() => toggleFav(r.skuId)}
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill={isFav ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.8"
                            >
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </span>
                        </td>
                        <td>
                          <div
                            className="rp-product-img"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "var(--surface-2)",
                              color: "var(--text-4)",
                              fontWeight: 700,
                              fontSize: 13,
                            }}
                          >
                            {r.title.charAt(0).toUpperCase()}
                          </div>
                        </td>
                        <td>
                          <div className="rp-title-text">{r.title}</div>
                          <div className="rp-ids-row">
                            <span
                              className="copy-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                copy(r.sku);
                              }}
                            >
                              {r.sku} <CopyIcon />
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="rp-unit-value">{num(r.units)}</div>
                        </td>
                        <td>
                          <div className="rp-unit-value">
                            {money(r.revenue)}
                          </div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {/* prevRevenue is always 0 — no prior period exists,
                              so render a neutral pill, never a fake delta. */}
                          <span
                            className="rp-change-pill flat"
                            title="No prior period data available"
                          >
                            —
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Sticky pagination footer */}
          <div className="rp-pagination-footer">
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Showing{" "}
              <strong style={{ color: "var(--text)" }}>
                {showingFrom}–{showingTo}
              </strong>{" "}
              of{" "}
              <strong style={{ color: "var(--text)" }}>
                {num(filtered.length)}
              </strong>{" "}
              products
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                className="btn btn-secondary btn-icon btn-sm"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
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
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-2)",
                  padding: "0 6px",
                  fontWeight: 600,
                }}
              >
                Page {safePage + 1} / {pageCount}
              </span>
              <button
                className="btn btn-secondary btn-icon btn-sm"
                disabled={safePage >= pageCount - 1}
                onClick={() =>
                  setPage((p) => Math.min(pageCount - 1, p + 1))
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
            </div>
          </div>
        </div>

        {/* RIGHT: details panel */}
        <div className="card rp-details-card">
          <div className="rp-details-header">
            <div className="rp-see-details-badge">See Details</div>
            <span className="rp-details-name">
              {selected ? selected.title : "Select any product"}
            </span>
          </div>

          <div className="rp-view-section">
            {/* Donut: revenue share of top SKUs (real data) */}
            <div className="rp-pie-section">
              <div className="rp-chart-title" style={{ alignSelf: "stretch" }}>
                Revenue Share by Product
              </div>
              <div className="rp-pie-large-wrap">
                <Donut slices={donutSlices} />
              </div>
              <div className="rp-pie-legend">
                {donutSlices.length === 0 ? (
                  <span style={{ color: "var(--text-3)" }}>
                    No revenue data
                  </span>
                ) : (
                  donutSlices.map((s) => (
                    <span className="rp-pie-legend-item" key={s.label}>
                      <span
                        className="rp-pie-legend-swatch"
                        style={{ background: s.color }}
                      />
                      <span
                        style={{
                          maxWidth: 140,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.label}
                      </span>
                      <span style={{ color: "var(--text-3)" }}>
                        {s.pct.toFixed(1)}%
                      </span>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="rp-section-divider" />

            {/* Bars: selected SKU units vs revenue (real values) */}
            <div className="rp-line-section">
              <div className="rp-chart-title">Selected Product</div>
              {selected ? (
                <>
                  <CompareBars
                    units={selected.units}
                    revenue={selected.revenue}
                    maxUnits={maxUnits}
                    maxRevenue={maxRevenue}
                  />
                  <div className="rp-line-legend">
                    <span className="rp-line-legend-item">
                      <span
                        className="rp-line-legend-line"
                        style={{ background: "#1f47e5", color: "#1f47e5" }}
                      />
                      Units {num(selected.units)}
                    </span>
                    <span className="rp-line-legend-item">
                      <span
                        className="rp-line-legend-line"
                        style={{ background: "#14b8a6", color: "#14b8a6" }}
                      />
                      Revenue {money(selected.revenue)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      color: "var(--text-3)",
                      textAlign: "center",
                    }}
                  >
                    No prior-period data is available, so
                    period-over-period change is not shown.
                  </div>
                </>
              ) : (
                <div
                  style={{
                    padding: "24px 8px",
                    textAlign: "center",
                    color: "var(--text-3)",
                    fontSize: 12.5,
                  }}
                >
                  Select a product from the table to see its units and
                  revenue.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
