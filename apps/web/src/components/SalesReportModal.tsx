import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { Modal } from "./Modal";
import { Loading, ErrorState, EmptyState } from "./EmptyState";
import { DateRangePicker } from "./DateRangePicker";
import { useToast } from "./Toast";
import "./SalesReportModal.css";

interface OrderMetric {
  intervalStart: string; // ISO date
  unitCount: number;
  averageAmount: number;
}
interface ApiResponse {
  identifier: string;
  identifierType: "sku" | "asin";
  granularity: "day" | "month";
  startDate: string;
  endDate: string;
  items: OrderMetric[];
}

type IdType = "sku" | "asin";
type Granularity = "day" | "month";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Pie palette — 12 saturated colors spaced ~30° apart on the hue wheel and
 * then re-ordered to maximize *adjacent* contrast. Walking down this list
 * jumps across the wheel, so two slices next to each other in the pie never
 * end up looking like the same color (the old palette had two reds + two
 * teals + two purples right next to each other).
 */
const PIE_COLORS = [
  "#dc2626", // red-600
  "#0d9488", // teal-600
  "#c026d3", // fuchsia-600
  "#65a30d", // lime-600
  "#2563eb", // blue-600
  "#ea580c", // orange-600
  "#0891b2", // cyan-600
  "#db2777", // pink-600
  "#16a34a", // green-600
  "#7c3aed", // violet-600
  "#ca8a04", // yellow-600
  "#0284c7", // sky-600
];

function labelFor(g: Granularity, iso: string): string {
  // The /sales/v1/orderMetrics interval start is an ISO timestamp
  // (e.g. "2026-05-21T00:00:00Z"). Format compactly for axis ticks.
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  if (g === "month") {
    return `${MONTH_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SalesReportModal({
  open,
  sku,
  asin,
  title,
  imageUrl,
  price,
  onClose,
}: {
  open: boolean;
  sku: string | null;
  asin: string | null;
  title: string;
  imageUrl?: string | null;
  price?: number | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [idType, setIdType] = useState<IdType>("sku");

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text);
    toast.success("Copied", `${label} copied to clipboard.`);
  }
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [showTable, setShowTable] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // What we actually query against — falls back gracefully if one isn't set.
  const identifier = idType === "asin" ? asin : sku;
  const canQuery = !!identifier && open;

  const reportQ = useQuery({
    queryKey: [
      "sales-report",
      { identifier, idType, granularity, start, end },
    ],
    queryFn: () =>
      api.get<ApiResponse>(
        `/sales-metrics/${granularity}/${encodeURIComponent(identifier!)}` +
          qs({ type: idType, startDate: start, endDate: end }),
      ),
    enabled: canQuery,
    staleTime: 60_000,
  });

  const items = reportQ.data?.items ?? [];
  const totalUnits = useMemo(
    () => items.reduce((acc, m) => acc + m.unitCount, 0),
    [items],
  );

  const handlePresetRange = (preset: "30d" | "90d" | "ytd" | "12m" | "all") => {
    const now = new Date();
    setEnd(toYMD(now));
    if (preset === "30d") {
      const s = new Date(now);
      s.setDate(s.getDate() - 30);
      setStart(toYMD(s));
    } else if (preset === "90d") {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      setStart(toYMD(s));
    } else if (preset === "ytd") {
      setStart(toYMD(new Date(now.getFullYear(), 0, 1)));
    } else if (preset === "12m") {
      const s = new Date(now);
      s.setMonth(s.getMonth() - 11);
      s.setDate(1);
      setStart(toYMD(s));
    } else {
      setStart("");
      setEnd("");
    }
  };

  return (
    <Modal
      open={open}
      title="Pricing & Sales Report"
      subtitle={title}
      size="full"
      onClose={onClose}
    >
      {/* Compact product strip — image + title + price */}
      <div className="srm-header">
        {imageUrl ? (
          <img className="srm-thumb" src={imageUrl} alt="" />
        ) : (
          <div className="srm-thumb srm-thumb-fallback">
            {(title.trim()[0] ?? "?").toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="srm-product-title" title={title}>
            {title}
          </div>
          <div className="srm-product-chips">
            {price != null && (
              <span className="srm-price-pill">{money(price)}</span>
            )}
            {sku && (
              <span
                className="copy-btn"
                title="Click to copy SKU"
                onClick={() => copy(sku, "SKU")}
              >
                {sku}
              </span>
            )}
            {asin && (
              <span
                className="copy-btn"
                title="Click to copy ASIN"
                onClick={() => copy(asin, "ASIN")}
              >
                {asin}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="srm-presets">
        <span className="srm-presets-label">Quick range</span>
        <button onClick={() => handlePresetRange("30d")}>Last 30 days</button>
        <button onClick={() => handlePresetRange("90d")}>Last 90 days</button>
        <button onClick={() => handlePresetRange("ytd")}>YTD</button>
        <button onClick={() => handlePresetRange("12m")}>Last 12 months</button>
        <button onClick={() => handlePresetRange("all")}>Reset</button>
      </div>

      {!canQuery ? (
        <EmptyState
          title={`No ${idType.toUpperCase()} on this product`}
          message="Switch to the other identifier above to load the report."
        />
      ) : reportQ.isLoading ? (
        <Loading />
      ) : reportQ.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No sales in this window"
          message="Adjust the date range or try the other identifier."
        />
      ) : (
        <>
          <div className="srm-stats">
            <div className="srm-stat-card">
              <div className="srm-stat-label">Total units</div>
              <div className="srm-stat-value">{num(totalUnits)}</div>
            </div>
            <div className="srm-stat-card">
              <div className="srm-stat-label">Buckets</div>
              <div className="srm-stat-value">{num(items.length)}</div>
            </div>
            <div className="srm-stat-card">
              <div className="srm-stat-label">Avg price</div>
              <div className="srm-stat-value">
                {(() => {
                  const totalAmt = items.reduce(
                    (acc, m) => acc + m.averageAmount * m.unitCount,
                    0,
                  );
                  const avg = totalUnits > 0 ? totalAmt / totalUnits : 0;
                  return money(avg);
                })()}
              </div>
            </div>
          </div>

          <div className="srm-chart-row">
            <div className="srm-chart-card">
              <div className="srm-chart-head">
                <div className="srm-chart-title">
                  Amazon Sales — by {granularity === "day" ? "Day" : "Month"}
                </div>
                <div className="srm-toolbar">
                  <div className="segmented">
                    <button
                      className={idType === "sku" ? "active" : undefined}
                      onClick={() => setIdType("sku")}
                      disabled={!sku}
                      title={sku ? "" : "No SKU on this product"}
                    >
                      SKU
                    </button>
                    <button
                      className={idType === "asin" ? "active" : undefined}
                      onClick={() => setIdType("asin")}
                      disabled={!asin}
                      title={asin ? "" : "No ASIN on this product"}
                    >
                      ASIN
                    </button>
                  </div>
                  <DateRangePicker
                    start={start}
                    end={end}
                    onChange={(s, e) => {
                      setStart(s ?? "");
                      setEnd(e ?? "");
                    }}
                  />
                  <div className="segmented">
                    <button
                      className={granularity === "day" ? "active" : undefined}
                      onClick={() => setGranularity("day")}
                    >
                      By Day
                    </button>
                    <button
                      className={granularity === "month" ? "active" : undefined}
                      onClick={() => setGranularity("month")}
                    >
                      By Month
                    </button>
                    <button
                      className={showTable ? "active" : undefined}
                      onClick={() => setShowTable((v) => !v)}
                    >
                      {showTable ? "Hide Table" : "View Table"}
                    </button>
                  </div>
                </div>
              </div>
              <BarChart items={items} granularity={granularity} />
            </div>

            {granularity === "month" && (
              <div className="srm-pie-card">
                <div className="srm-chart-title">Distribution</div>
                <PieChart items={items} granularity={granularity} />
              </div>
            )}
          </div>

          {showTable && (
            <div className="srm-table-wrap">
              <table className="srm-table">
                <thead>
                  <tr>
                    <th>{granularity === "day" ? "Date" : "Month"}</th>
                    <th style={{ textAlign: "right" }}>Avg price</th>
                    <th style={{ textAlign: "right" }}>Units</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.intervalStart}>
                      <td>{labelFor(granularity, m.intervalStart)}</td>
                      <td style={{ textAlign: "right" }}>
                        {money(m.averageAmount)}
                      </td>
                      <td
                        style={{ textAlign: "right", fontWeight: 600 }}
                      >
                        {num(m.unitCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ---------------------------- Charts ---------------------------- */

function BarChart({
  items,
  granularity,
}: {
  items: OrderMetric[];
  granularity: Granularity;
}) {
  // Responsive: SVG carries a viewBox + width="100%" so the browser scales
  // everything to the chart-card's actual width. No more horizontal scroll —
  // bars and labels just shrink when there are lots of buckets.
  const padLeft = 48;
  const padRight = 18;
  const padTop = 36;
  const padBottom = 60;
  // The intrinsic coord space stays at 1100 wide (matches a typical desktop
  // chart card after the modal's 22px body padding × 2). Browser scales it.
  const totalW = 1100;
  const innerW = totalW - padLeft - padRight;
  // Bar + gap together — bars take ~70% of the per-bucket slot so a 32-day
  // chart still has visible bars without looking cramped.
  const slotW = items.length > 0 ? innerW / items.length : innerW;
  const barW = Math.max(6, slotW * 0.7);
  const w = totalW;
  const innerH = 200;
  const h = innerH + padTop + padBottom;
  const max = Math.max(1, ...items.map((m) => m.unitCount));
  // Auto-shrink label font when many bars are crammed in. Bumped one size
  // smaller overall so the chart reads as data, not text-on-bars.
  const valueFont = items.length > 24 ? 8.5 : items.length > 16 ? 9.5 : 10;
  const xLabelFont = items.length > 24 ? 8 : 9;

  // Y-axis ticks — 4 evenly-spaced gridlines including 0 and max.
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) =>
    Math.round((max * i) / ticks),
  );

  // Hover tooltip uses viewport-fixed coords so it escapes the bar-scroll
  // overflow container — otherwise tall bars push the tooltip above the
  // chart's clip line and it disappears.
  const [hover, setHover] = useState<{
    item: OrderMetric;
    pageX: number;
    pageY: number;
  } | null>(null);

  return (
    <div className="srm-bar-wrap">
      <div className="srm-bar-scroll">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          className="srm-bar-svg"
        >
          {/* Y gridlines */}
          {tickVals.map((v) => {
            const y = padTop + innerH - (v / max) * innerH;
            return (
              <g key={v}>
                <line
                  x1={padLeft}
                  x2={w - padRight}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  fontSize="9"
                  textAnchor="end"
                  fill="var(--text-3)"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {/* Y-axis title */}
          <text
            x={16}
            y={padTop + innerH / 2}
            fontSize="9"
            textAnchor="middle"
            fill="var(--text-3)"
            transform={`rotate(-90 16 ${padTop + innerH / 2})`}
          >
            Units sold
          </text>

          {/* Bars */}
          {items.map((m, i) => {
            const slotX = padLeft + i * slotW;
            const x = slotX + (slotW - barW) / 2;
            const barH = max > 0 ? (m.unitCount / max) * innerH : 0;
            const y = padTop + innerH - barH;
            const label = labelFor(granularity, m.intervalStart);
            const isHovered = hover?.item.intervalStart === m.intervalStart;
            // Show value labels on every bar with sales — the user expects
            // consistency. Font auto-shrinks via `valueFont` so they still
            // fit in dense charts.
            const showValueLabel = m.unitCount > 0;
            return (
              <g key={m.intervalStart}>
                {/* Invisible hover hit-area covering the full column so the
                    bar still gets a tooltip even when its height is 0. */}
                <rect
                  x={slotX}
                  y={padTop}
                  width={slotW}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={(e) =>
                    setHover({
                      item: m,
                      pageX: e.clientX,
                      pageY: e.clientY,
                    })
                  }
                  onMouseMove={(e) =>
                    setHover((cur) =>
                      cur && cur.item.intervalStart === m.intervalStart
                        ? { ...cur, pageX: e.clientX, pageY: e.clientY }
                        : cur,
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                />
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  fill={isHovered ? "var(--brand-700)" : "var(--brand-600)"}
                  rx={3}
                  pointerEvents="none"
                />
                {/* Bar value */}
                {showValueLabel && (
                  <>
                    <text
                      x={x + barW / 2}
                      y={y - 18}
                      fontSize={valueFont}
                      fontWeight="600"
                      textAnchor="middle"
                      fill="var(--text)"
                      pointerEvents="none"
                    >
                      {m.unitCount}
                    </text>
                    <text
                      x={x + barW / 2}
                      y={y - 5}
                      fontSize={valueFont - 2}
                      textAnchor="middle"
                      fill="var(--text-3)"
                      pointerEvents="none"
                    >
                      {money(m.averageAmount)}
                    </text>
                  </>
                )}
                {/* X label */}
                <text
                  x={x + barW / 2}
                  y={padTop + innerH + 18}
                  fontSize={xLabelFont}
                  textAnchor="middle"
                  fill="var(--text-3)"
                  pointerEvents="none"
                >
                  {label.split(" ")[0]}
                </text>
                <text
                  x={x + barW / 2}
                  y={padTop + innerH + 32}
                  fontSize={xLabelFont}
                  textAnchor="middle"
                  fill="var(--text-3)"
                  pointerEvents="none"
                >
                  {label.split(" ")[1] ?? ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover && (
        <div
          className="srm-tooltip srm-tooltip-fixed"
          // Position relative to the viewport so the box clears the
          // bar-scroll's clip. Offset by 14px so it doesn't sit under the
          // cursor and trigger mouseleave.
          style={{ left: hover.pageX + 14, top: hover.pageY - 12 }}
        >
          <div className="srm-tooltip-title">
            {labelFor(granularity, hover.item.intervalStart)}
          </div>
          <div className="srm-tooltip-row">
            <span>Units sold</span>
            <strong>{num(hover.item.unitCount)}</strong>
          </div>
          <div className="srm-tooltip-row">
            <span>Avg price</span>
            <strong>{money(hover.item.averageAmount)}</strong>
          </div>
          <div className="srm-tooltip-row">
            <span>Revenue</span>
            <strong>
              {money(hover.item.averageAmount * hover.item.unitCount)}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}

function PieChart({
  items,
  granularity,
}: {
  items: OrderMetric[];
  granularity: Granularity;
}) {
  const total = items.reduce((acc, m) => acc + m.unitCount, 0);
  const size = 240;
  const r = 100;
  const cx = size / 2;
  const cy = size / 2;
  const [hover, setHover] = useState<{
    item: OrderMetric;
    frac: number;
    pageX: number;
    pageY: number;
  } | null>(null);

  // Build sorted slice list so largest sections render first (visually
  // dominant) and tiny tail slices don't get hidden under labels.
  const slices = useMemo(() => {
    if (total === 0) return [];
    let acc = 0;
    return items
      .map((m, i) => {
        const frac = m.unitCount / total;
        const start = acc;
        acc += frac;
        return {
          ...m,
          color: PIE_COLORS[i % PIE_COLORS.length],
          frac,
          start,
          end: acc,
        };
      })
      .filter((s) => s.frac > 0);
  }, [items, total]);

  function arcPath(start: number, end: number): string {
    if (end - start >= 0.9999) {
      // Full circle — draw two half arcs to avoid degenerate path.
      return [
        `M ${cx + r} ${cy}`,
        `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
        `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
        "Z",
      ].join(" ");
    }
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = end - start > 0.5 ? 1 : 0;
    return [
      `M ${cx} ${cy}`,
      `L ${x0} ${y0}`,
      `A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
      "Z",
    ].join(" ");
  }

  if (total === 0) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)", fontSize: 12 }}>
        No data
      </div>
    );
  }

  return (
    <>
      <svg width={size} height={size} className="srm-pie">
        {slices.map((s) => (
          <path
            key={s.intervalStart}
            d={arcPath(s.start, s.end)}
            fill={s.color}
            style={{
              cursor: "pointer",
              opacity:
                hover && hover.item.intervalStart !== s.intervalStart
                  ? 0.4
                  : 1,
              transition: "opacity .12s",
            }}
            onMouseEnter={(e) =>
              setHover({
                item: s,
                frac: s.frac,
                pageX: e.clientX,
                pageY: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setHover((cur) =>
                cur && cur.item.intervalStart === s.intervalStart
                  ? { ...cur, pageX: e.clientX, pageY: e.clientY }
                  : cur,
              )
            }
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover && (
        <div
          className="srm-tooltip srm-tooltip-fixed"
          style={{ left: hover.pageX + 14, top: hover.pageY - 12 }}
        >
          <div className="srm-tooltip-title">
            {labelFor(granularity, hover.item.intervalStart)}
          </div>
          <div className="srm-tooltip-row">
            <span>Units</span>
            <strong>{num(hover.item.unitCount)}</strong>
          </div>
          <div className="srm-tooltip-row">
            <span>Share</span>
            <strong>{(hover.frac * 100).toFixed(1)}%</strong>
          </div>
          <div className="srm-tooltip-row">
            <span>Avg price</span>
            <strong>{money(hover.item.averageAmount)}</strong>
          </div>
        </div>
      )}
      <div className="srm-pie-legend">
        {slices.map((s) => (
          <div
            key={s.intervalStart}
            className={
              "srm-legend-row" +
              (hover?.item.intervalStart === s.intervalStart
                ? " active"
                : "")
            }
            onMouseEnter={(e) =>
              setHover({
                item: s,
                frac: s.frac,
                pageX: e.clientX,
                pageY: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setHover((cur) =>
                cur && cur.item.intervalStart === s.intervalStart
                  ? { ...cur, pageX: e.clientX, pageY: e.clientY }
                  : cur,
              )
            }
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="srm-legend-dot"
              style={{ background: s.color }}
            />
            <span className="srm-legend-label">
              {labelFor(granularity, s.intervalStart)}
            </span>
            <span className="srm-legend-pct">{(s.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}
