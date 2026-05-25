import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, qs } from "../lib/api";
import { num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { DateRangePicker } from "../components/DateRangePicker";
import { SalesReportModal } from "../components/SalesReportModal";
import { useToast } from "../components/Toast";
import "./Report.css";
import "./BuyBoxAlert.css";
import "./Inventory.css";

interface TableRow {
  key: string;
  skuId: string;
  sku: string;
  asin: string | null;
  title: string | null;
  imageUrl: string | null;
  favorite: boolean;
  currentUnits: number;
  currentRevenue: number;
  previousUnits: number;
  previousRevenue: number;
}

interface TableResponse {
  items: TableRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    currentUnits: number;
    currentRevenue: number;
    previousUnits: number;
    previousRevenue: number;
  };
}

interface DailyPoint {
  date: string;
  units: number;
  revenue: number;
}
interface MonthlyPoint {
  month: string;
  units: number;
  revenue: number;
}

/** Modern, slightly muted palette — high contrast on white, no neon. */
const PIE_COLORS = [
  "#2563eb",
  "#0d9488",
  "#f97316",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#d97706",
  "#dc2626",
  "#0ea5e9",
  "#7c3aed",
  "#16a34a",
];

const COLOR_CURRENT = "#2563eb";
const COLOR_PREVIOUS = "#f97316";

/** Compact tooltip that matches the rest of the app's card aesthetic. */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        fontSize: 12,
      }}
    >
      {label && (
        <div style={{ color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      )}
      {payload.map((p, i) => (
        <div
          key={i}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color,
              display: "inline-block",
            }}
          />
          <span style={{ color: "var(--text-2)" }}>{p.name}:</span>
          <strong style={{ color: "var(--text)" }}>
            {typeof p.value === "number" ? num(p.value) : String(p.value)}
          </strong>
        </div>
      ))}
    </div>
  );
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtMonth(m: string): string {
  // "2026-05" → "May 2026"
  const [y, mm] = m.split("-");
  return `${MONTH_SHORT[Number(mm) - 1]} ${y}`;
}

/**
 * Signed % change between current and previous interval, clamped to
 * [-100, +100]. Without the cap the value goes unbounded (e.g. +2001%
 * when the previous interval only has 1 day of cached history), which
 * makes the column noisy. -100 = went to zero; +100 = doubled or more.
 * Direction is preserved via the arrow icon next to the number.
 */
function changePct(curr: number, prev: number): number {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  const raw = ((curr - prev) / prev) * 100;
  return Math.max(-100, Math.min(100, Math.round(raw)));
}

/** Compact paginator window with `…` gaps — same shape as the SKUs and
 *  Inventory pages so all paged tables read identically. */
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

/** Last N months ending at the current month, newest first. */
function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function Report() {
  const qc = useQueryClient();
  const toast = useToast();

  // Default current = last 30 days; previous = the 30 days before that.
  const today = useMemo(() => new Date(), []);
  const def = useMemo(() => {
    const t = new Date(today);
    const currentEnd = ymd(t);
    const currentStartD = new Date(t);
    currentStartD.setDate(t.getDate() - 29);
    const currentStart = ymd(currentStartD);
    const previousEndD = new Date(currentStartD);
    previousEndD.setDate(currentStartD.getDate() - 1);
    const previousEnd = ymd(previousEndD);
    const previousStartD = new Date(previousEndD);
    previousStartD.setDate(previousEndD.getDate() - 29);
    const previousStart = ymd(previousStartD);
    return { currentStart, currentEnd, previousStart, previousEnd };
  }, [today]);

  const [currentRange, setCurrentRange] = useState<{ start: string; end: string }>({
    start: def.currentStart,
    end: def.currentEnd,
  });
  const [previousRange, setPreviousRange] = useState<{ start: string; end: string }>({
    start: def.previousStart,
    end: def.previousEnd,
  });
  const [mode, setMode] = useState<"sku" | "asin">("asin");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Month checkboxes for the right-rail line / pie. Default to the last 3
  // months so the chart isn't empty on first paint.
  const allMonths = useMemo(() => lastMonths(13), []);
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() =>
    lastMonths(3),
  );

  const [detailFor, setDetailFor] = useState<TableRow | null>(null);

  // Debounce search input so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset page on filter change.
  useEffect(() => {
    setPage(1);
  }, [search, mode, favoritesOnly, currentRange, previousRange, pageSize]);

  const tableQ = useQuery({
    queryKey: [
      "sale-report",
      { currentRange, previousRange, mode, search, favoritesOnly, page, pageSize },
    ],
    queryFn: () =>
      api.get<TableResponse>(
        "/sale-report" +
          qs({
            currentStart: currentRange.start,
            currentEnd: currentRange.end,
            previousStart: previousRange.start,
            previousEnd: previousRange.end,
            mode,
            search: search || undefined,
            favoritesOnly: favoritesOnly ? "true" : undefined,
            page,
            pageSize,
          }),
      ),
    placeholderData: keepPreviousData,
  });

  // Daily workspace-wide series for the bottom-right chart, scoped to the
  // selected months. Concat (start-of-first-month) → (end-of-last-month).
  const monthBounds = useMemo(() => {
    if (selectedMonths.length === 0) return null;
    const sorted = [...selectedMonths].sort();
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const [fy, fm] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    const start = `${fy}-${String(fm).padStart(2, "0")}-01`;
    const endD = new Date(ly!, lm!, 0); // last day of `last`
    const end = ymd(endD);
    return { start, end };
  }, [selectedMonths]);

  const dailyAllQ = useQuery({
    queryKey: ["sale-report", "daily", monthBounds, mode],
    queryFn: () =>
      api.get<{ items: DailyPoint[] }>(
        "/sale-report/daily" +
          qs({ start: monthBounds!.start, end: monthBounds!.end, mode }),
      ),
    enabled: !!monthBounds,
  });

  const monthlyAllQ = useQuery({
    queryKey: ["sale-report", "monthly", selectedMonths, mode],
    queryFn: () =>
      api.get<{ items: MonthlyPoint[] }>(
        "/sale-report/monthly" +
          qs({ months: selectedMonths.join(","), mode }),
      ),
    enabled: selectedMonths.length > 0,
  });

  // Selected-row series (current + previous intervals overlaid).
  const selectedRow = useMemo(
    () => tableQ.data?.items.find((r) => r.key === selectedKey) ?? null,
    [tableQ.data, selectedKey],
  );

  const selectedDailyCurrentQ = useQuery({
    queryKey: ["sale-report", "daily-selected-current", selectedKey, currentRange, mode],
    queryFn: () =>
      api.get<{ items: DailyPoint[] }>(
        "/sale-report/daily" +
          qs({
            start: currentRange.start,
            end: currentRange.end,
            identifier: selectedKey!,
            mode,
          }),
      ),
    enabled: !!selectedKey,
  });

  const selectedDailyPreviousQ = useQuery({
    queryKey: ["sale-report", "daily-selected-previous", selectedKey, previousRange, mode],
    queryFn: () =>
      api.get<{ items: DailyPoint[] }>(
        "/sale-report/daily" +
          qs({
            start: previousRange.start,
            end: previousRange.end,
            identifier: selectedKey!,
            mode,
          }),
      ),
    enabled: !!selectedKey,
  });

  const toggleFavorite = useMutation({
    mutationFn: ({ skuId, favorite }: { skuId: string; favorite: boolean }) =>
      api.patch(`/skus/${skuId}`, { favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sale-report"] }),
    onError: () =>
      toast.error("Couldn't update favorite", "Please try again."),
  });

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text);
    toast.success("Copied", `${label} copied to clipboard.`);
  }

  const syncMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; firstTime: boolean }>("/sale-report/sync"),
    onSuccess: (res) =>
      toast.info(
        res.firstTime ? "First-time setup started" : "Sync started",
        res.firstTime
          ? "Pulling 18 months of charts data + the last 90 days of per-SKU history from Amazon. First-time setup takes 15-25 minutes total and runs in the background — the report will keep filling in as data lands."
          : "Refreshing the last 30 days from Amazon. The report refreshes automatically when it's done — usually 2-5 minutes.",
      ),
    onError: (err) =>
      toast.error(
        "Couldn't start sync",
        err instanceof Error ? err.message : "Please try again.",
      ),
  });

  // First-visit auto-sync — when the daily_sales cache is empty for this
  // workspace we kick off one sync transparently (mirrors the legacy app's
  // "data just appears" UX). Guarded so it fires at most once per page
  // mount; the timestamp lets us show "still waiting…" vs. a real empty
  // result after a long wait.
  const [autoSyncStartedAt, setAutoSyncStartedAt] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (autoSyncStartedAt != null) return;
    if (!tableQ.data) return;
    if (tableQ.data.total > 0) return;
    if (syncMut.isPending) return;
    setAutoSyncStartedAt(Date.now());
    syncMut.mutate();
  }, [tableQ.data, autoSyncStartedAt, syncMut]);

  // While we're waiting on a sync, re-poll the report every 20s so data
  // appears as soon as the worker writes its first rows.
  useEffect(() => {
    if (autoSyncStartedAt == null) return;
    if (tableQ.data && tableQ.data.total > 0) return; // done
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["sale-report"] });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [autoSyncStartedAt, tableQ.data, qc]);

  // Selected-row line data — merge current + previous series by real
  // calendar date so they share a single continuous X axis (legacy parity).
  // When no row is selected, falls back to the workspace-wide daily series.
  // Must be declared BEFORE the early returns below — otherwise the hook
  // count changes between loading and ready renders.
  const selectedLine = useMemo(() => {
    if (!selectedRow) return [];
    const cur = selectedDailyCurrentQ.data?.items ?? [];
    const prev = selectedDailyPreviousQ.data?.items ?? [];
    const curMap = new Map(cur.map((p) => [p.date, p.units]));
    const prevMap = new Map(prev.map((p) => [p.date, p.units]));
    const allDates = Array.from(
      new Set([...curMap.keys(), ...prevMap.keys()]),
    ).sort();
    return allDates.map((date) => ({
      date,
      current: curMap.has(date) ? (curMap.get(date) as number) : null,
      previous: prevMap.has(date) ? (prevMap.get(date) as number) : null,
    }));
  }, [
    selectedRow,
    selectedDailyCurrentQ.data,
    selectedDailyPreviousQ.data,
  ]);

  function toggleMonth(m: string) {
    setSelectedMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }

  if (tableQ.isLoading) return <Loading />;
  if (tableQ.isError) return <ErrorState />;

  const data = tableQ.data!;
  const items = data.items;
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const totalsChange = changePct(
    data.totals.currentUnits,
    data.totals.previousUnits,
  );

  // Pie data — the right-rail "by month" donut.
  const monthlyPie = (monthlyAllQ.data?.items ?? [])
    .filter((m) => m.units > 0)
    .map((m, i) => ({
      name: fmtMonth(m.month),
      value: m.units,
      fill: PIE_COLORS[i % PIE_COLORS.length],
    }));

  // Selected row pies.
  const selectedCurrPrev = selectedRow
    ? [
        { name: "Current", value: selectedRow.currentUnits, fill: "#1f47e5" },
        { name: "Previous", value: selectedRow.previousUnits, fill: "#f97316" },
      ]
    : [];

  return (
    <div className="sr-page">
      {/* Header */}
      <div className="sr-header">
        <div>
          <h1 className="sr-title">Sale Report</h1>
          <div className="sr-sub">
            Compare units sold across two date ranges, by SKU or ASIN.
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          title="First-time: backfills 18 months of charts + 90 days of per-SKU history (15-25 min). After that: refreshes the last 30 days from Amazon (2-5 min)."
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

      {/* Status line — sits above the toolbar so it appears vertically above
          the sticky chart card on the right rail (same pattern as the
          SKUs/Inventory pages, with the isFetching spinner inline). */}
      {!tableQ.isLoading && !tableQ.isError && tableQ.data && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>
            Showing{" "}
            <strong style={{ color: "var(--text)" }}>
              {num((page - 1) * pageSize + 1)}-
              {num(Math.min(page * pageSize, tableQ.data.total))}
            </strong>{" "}
            of{" "}
            <strong style={{ color: "var(--text)" }}>
              {num(tableQ.data.total)}
            </strong>{" "}
            {tableQ.data.total === 1 ? "product" : "products"}
          </span>
          {tableQ.isFetching && (
            <span className="spinner-inline" aria-label="Loading" />
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="sr-toolbar">
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

        <div className="sr-toggle">
          <span className="sr-toggle-label">ASIN mode</span>
          <div
            className={"bba-toggle" + (mode === "asin" ? " on" : "")}
            role="switch"
            aria-checked={mode === "asin"}
            onClick={() => setMode(mode === "asin" ? "sku" : "asin")}
          />
        </div>

        <div className="sr-toggle">
          <span className="sr-toggle-label">Favorites only</span>
          <div
            className={"bba-toggle" + (favoritesOnly ? " on" : "")}
            role="switch"
            aria-checked={favoritesOnly}
            onClick={() => setFavoritesOnly((v) => !v)}
          />
        </div>

        <div className="sr-range-group">
          <span className="sr-range-label">Current</span>
          <DateRangePicker
            start={currentRange.start}
            end={currentRange.end}
            onChange={(s, e) =>
              setCurrentRange({
                start: s ?? currentRange.start,
                end: e ?? currentRange.end,
              })
            }
          />
        </div>

        <div className="sr-range-group">
          <span className="sr-range-label">Previous</span>
          <DateRangePicker
            start={previousRange.start}
            end={previousRange.end}
            onChange={(s, e) =>
              setPreviousRange({
                start: s ?? previousRange.start,
                end: e ?? previousRange.end,
              })
            }
          />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="sr-layout">
        <div className="sr-main">
          {items.length === 0 ? (
            data.total === 0 && autoSyncStartedAt != null ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                  padding: "60px 20px",
                  color: "var(--text-2)",
                  textAlign: "center",
                }}
              >
                <div className="spinner" />
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
                  Populating sales data — first-time setup
                </div>
                <div style={{ maxWidth: 460, fontSize: 13, lineHeight: 1.55 }}>
                  Pulling the last 90 days of Amazon orders to build the
                  daily-sales cache. This usually takes 2-5 minutes; the report
                  will refresh automatically once data starts arriving.
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Started {Math.max(1, Math.floor((Date.now() - autoSyncStartedAt) / 1000))}s ago
                </div>
              </div>
            ) : (
              <EmptyState
                title="Nothing to report yet"
                message={
                  data.total === 0
                    ? "Daily sales are cached as the daily sync runs. Click \"Sync sales from Amazon\" above to populate this report."
                    : "Try a different search or date range."
                }
              />
            )
          ) : (
            <>
              <div
                className={
                  "sr-table-wrap card" +
                  (tableQ.isFetching && !tableQ.isLoading
                    ? " is-refetching"
                    : "")
                }
              >
                <table className="sr-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} />
                      <th style={{ width: 56 }}>Image</th>
                      <th>Title</th>
                      <th style={{ width: 160, textAlign: "right" }}>
                        Current Interval Units
                      </th>
                      <th style={{ width: 160, textAlign: "right" }}>
                        Previous Interval Units
                      </th>
                      <th style={{ width: 110, textAlign: "right" }}>
                        Change (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const c = changePct(r.currentUnits, r.previousUnits);
                      const sign = c > 0 ? "▲" : c < 0 ? "▼" : "→";
                      const cls =
                        c > 0
                          ? "sr-change up"
                          : c < 0
                            ? "sr-change down"
                            : "sr-change flat";
                      const selected = selectedKey === r.key;
                      return (
                        <tr
                          key={r.key}
                          className={selected ? "selected" : ""}
                          onClick={() =>
                            setSelectedKey(selected ? null : r.key)
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className={"star" + (r.favorite ? " active" : "")}
                              title={
                                r.favorite ? "Unfavorite" : "Mark as favorite"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite.mutate({
                                  skuId: r.skuId,
                                  favorite: !r.favorite,
                                });
                              }}
                            >
                              ★
                            </button>
                          </td>
                          <td>
                            {r.imageUrl ? (
                              <img
                                className="sr-thumb"
                                src={r.imageUrl}
                                alt=""
                              />
                            ) : (
                              <div className="sr-thumb sr-thumb-placeholder" />
                            )}
                          </td>
                          <td>
                            <div className="sr-title-cell">
                              <span className="sr-title-text">
                                {r.title ?? "—"}
                              </span>
                              <span className="sr-ids">
                                {r.asin && (
                                  <span
                                    className="sr-id sr-id-copy"
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
                                  className="sr-id sr-id-copy"
                                  title="Click to copy SKU"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copy(r.sku, "SKU");
                                  }}
                                >
                                  {r.sku}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="sr-num">{num(r.currentUnits)}</td>
                          <td className="sr-num">{num(r.previousUnits)}</td>
                          <td className={"sr-num " + cls}>
                            {sign} {Math.abs(c)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="inv-pagination" style={{ marginTop: 16 }}>
                  <button
                    className="inv-page-arrow"
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
                      <span key={`e${i}`} className="inv-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        className={
                          "inv-page-btn" + (p === page ? " active" : "")
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
        </div>

        {/* Right rail — shared layout for both workspace and selected-row
            views. Selected-row view only ADDS a Current-vs-Previous pie next
            to the By-Month pie, and overrides the bottom line chart with that
            row's current+previous series by real calendar date (matches the
            legacy app). */}
        <aside className="sr-rail">
          <div className="card sr-rail-card">
            <div className="sr-rail-head">
              <div>
                <div className="sr-rail-title">
                  {selectedRow
                    ? (selectedRow.title ?? selectedRow.key)
                    : "Workspace totals"}
                </div>
                <div className="sr-rail-sub">
                  {selectedRow ? (
                    <>
                      {selectedRow.asin ?? ""} · {selectedRow.sku} ·{" "}
                      {num(selectedRow.currentUnits)} vs{" "}
                      {num(selectedRow.previousUnits)} units
                    </>
                  ) : (
                    <>
                      {num(data.totals.currentUnits)} vs{" "}
                      {num(data.totals.previousUnits)} units
                      {" · "}
                      <span
                        className={
                          totalsChange > 0
                            ? "sr-change up"
                            : totalsChange < 0
                              ? "sr-change down"
                              : "sr-change flat"
                        }
                      >
                        {totalsChange > 0
                          ? "▲"
                          : totalsChange < 0
                            ? "▼"
                            : "→"}{" "}
                        {Math.abs(totalsChange)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
              {selectedRow && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setDetailFor(selectedRow)}
                >
                  See Details
                </button>
              )}
            </div>

            {/* Pie row — Current-vs-Previous appears only when a row is
                selected; By-Month pie always shows. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: selectedRow ? "1fr 1fr" : "1fr",
                gap: 8,
              }}
            >
              {selectedRow && (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        <linearGradient id="gradCurrent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLOR_CURRENT} stopOpacity={1} />
                          <stop offset="100%" stopColor={COLOR_CURRENT} stopOpacity={0.75} />
                        </linearGradient>
                        <linearGradient id="gradPrevious" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLOR_PREVIOUS} stopOpacity={1} />
                          <stop offset="100%" stopColor={COLOR_PREVIOUS} stopOpacity={0.75} />
                        </linearGradient>
                      </defs>
                      <Pie
                        data={selectedCurrPrev}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={72}
                        paddingAngle={2}
                        stroke="var(--surface)"
                        strokeWidth={3}
                      >
                        <Cell fill="url(#gradCurrent)" />
                        <Cell fill="url(#gradPrevious)" />
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                        iconType="circle"
                        iconSize={8}
                        verticalAlign="bottom"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginTop: -4,
                    }}
                  >
                    Current vs Previous
                  </div>
                </div>
              )}

              {monthlyPie.length > 0 ? (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <defs>
                        {monthlyPie.map((s, i) => (
                          <linearGradient
                            key={i}
                            id={`gradMonth${i}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="0%" stopColor={s.fill} stopOpacity={1} />
                            <stop offset="100%" stopColor={s.fill} stopOpacity={0.7} />
                          </linearGradient>
                        ))}
                      </defs>
                      <Pie
                        data={monthlyPie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={72}
                        paddingAngle={2}
                        stroke="var(--surface)"
                        strokeWidth={3}
                      >
                        {monthlyPie.map((_, i) => (
                          <Cell key={i} fill={`url(#gradMonth${i})`} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                        iconType="circle"
                        iconSize={8}
                        verticalAlign="bottom"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginTop: -4,
                    }}
                  >
                    By Month
                  </div>
                </div>
              ) : (
                !selectedRow && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-3)",
                      padding: 12,
                      textAlign: "center",
                    }}
                  >
                    Tick at least one month below to see the breakdown.
                  </div>
                )
              )}
            </div>

            {/* Month checkboxes — always visible. */}
            <div className="sr-month-checks">
              {allMonths.map((m) => (
                <label key={m} className="sr-month-check">
                  <input
                    type="checkbox"
                    checked={selectedMonths.includes(m)}
                    onChange={() => toggleMonth(m)}
                  />
                  {fmtMonth(m)}
                </label>
              ))}
            </div>

            {/* Bottom line chart. Selected-row mode overlays Current +
                Previous by real calendar date; workspace mode is a single
                workspace-wide daily series scoped to the selected months. */}
            {selectedRow ? (
              <div style={{ height: 220, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={selectedLine} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaCurrent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR_CURRENT} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLOR_CURRENT} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="areaPrevious" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR_PREVIOUS} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={COLOR_PREVIOUS} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="var(--border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--text-3)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--text-3)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Area
                      name="Current"
                      type="monotone"
                      dataKey="current"
                      stroke={COLOR_CURRENT}
                      strokeWidth={2}
                      fill="url(#areaCurrent)"
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                    <Area
                      name="Previous"
                      type="monotone"
                      dataKey="previous"
                      stroke={COLOR_PREVIOUS}
                      strokeWidth={2}
                      fill="url(#areaPrevious)"
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: 220, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={dailyAllQ.data?.items ?? []}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="areaTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="var(--border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--text-3)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      hide={(dailyAllQ.data?.items?.length ?? 0) > 90}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--text-3)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      name="Total daily units"
                      type="monotone"
                      dataKey="units"
                      stroke="#0d9488"
                      strokeWidth={2}
                      fill="url(#areaTotal)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </aside>
      </div>

      <SalesReportModal
        open={detailFor != null}
        sku={detailFor?.sku ?? null}
        asin={detailFor?.asin ?? null}
        title={detailFor?.title ?? detailFor?.sku ?? ""}
        imageUrl={detailFor?.imageUrl ?? null}
        price={null}
        onClose={() => setDetailFor(null)}
      />
    </div>
  );
}

export type { TableRow as SaleReportRow };
