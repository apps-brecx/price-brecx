import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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

const PIE_COLORS = [
  "#1f47e5",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f59e0b",
  "#dc2626",
  "#0d9488",
  "#7c3aed",
  "#65a30d",
];

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

function changePct(curr: number, prev: number): number {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
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

  // Selected-row line data: merge current + previous series by date offset
  // so they overlay on the same x-axis (day index 0..N). Must be declared
  // BEFORE the early returns below — otherwise the hook count changes
  // between loading and ready renders.
  const selectedLine = useMemo(() => {
    if (!selectedRow) return [];
    const cur = selectedDailyCurrentQ.data?.items ?? [];
    const prev = selectedDailyPreviousQ.data?.items ?? [];
    const n = Math.max(cur.length, prev.length);
    const out: { day: number; current: number | null; previous: number | null }[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        day: i + 1,
        current: cur[i]?.units ?? null,
        previous: prev[i]?.units ?? null,
      });
    }
    return out;
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
      </div>

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
            <EmptyState
              title="Nothing to report yet"
              message={
                data.total === 0
                  ? "Daily sales are cached as the daily sync runs. Wait for the next sales sync (or run one from the Inventory page) to populate this report."
                  : "Try a different search or date range."
              }
            />
          ) : (
            <>
              <div className="sr-table-wrap card">
                <table className="sr-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }} />
                      <th style={{ width: 56 }}>Image</th>
                      <th>Title</th>
                      <th style={{ width: 130, textAlign: "right" }}>
                        Current
                      </th>
                      <th style={{ width: 130, textAlign: "right" }}>
                        Previous
                      </th>
                      <th style={{ width: 100, textAlign: "right" }}>
                        Change
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
                                  <span className="sr-id">{r.asin}</span>
                                )}
                                <span className="sr-id">{r.sku}</span>
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
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ←
                  </button>
                  <span style={{ fontSize: 13, padding: "0 8px" }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="inv-page-arrow"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    →
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

        {/* Right rail */}
        <aside className="sr-rail">
          {selectedRow ? (
            <>
              <div className="card sr-rail-card">
                <div className="sr-rail-head">
                  <div>
                    <div className="sr-rail-title">{selectedRow.title ?? selectedRow.key}</div>
                    <div className="sr-rail-sub">
                      {selectedRow.asin ?? ""} · {selectedRow.sku}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setDetailFor(selectedRow)}
                  >
                    See Details
                  </button>
                </div>

                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedLine}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11 }}
                        label={{ value: "Day", position: "insideBottom", offset: -2, fontSize: 11 }}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        name={`Current (${currentRange.start} → ${currentRange.end})`}
                        type="monotone"
                        dataKey="current"
                        stroke="#1f47e5"
                        dot={false}
                        connectNulls
                      />
                      <Line
                        name={`Previous (${previousRange.start} → ${previousRange.end})`}
                        type="monotone"
                        dataKey="previous"
                        stroke="#f97316"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ height: 180, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={selectedCurrPrev}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={40}
                        outerRadius={70}
                        label={(e) => `${e.name}: ${e.value}`}
                      >
                        {selectedCurrPrev.map((s, i) => (
                          <Cell key={i} fill={s.fill} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <div className="card sr-rail-card">
              <div className="sr-rail-head">
                <div>
                  <div className="sr-rail-title">Workspace totals</div>
                  <div className="sr-rail-sub">
                    {num(data.totals.currentUnits)} vs {num(data.totals.previousUnits)} units
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
                      {totalsChange > 0 ? "▲" : totalsChange < 0 ? "▼" : "→"}{" "}
                      {Math.abs(totalsChange)}%
                    </span>
                  </div>
                </div>
              </div>

              {monthlyPie.length > 0 ? (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={monthlyPie}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={85}
                      >
                        {monthlyPie.map((s, i) => (
                          <Cell key={i} fill={s.fill} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-3)", padding: 12 }}>
                  Select at least one month below to see the monthly breakdown.
                </div>
              )}

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

              <div style={{ height: 200, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyAllQ.data?.items ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      hide={(dailyAllQ.data?.items?.length ?? 0) > 90}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: unknown) => [
                        typeof value === "number" ? num(value) : String(value),
                        "Units",
                      ]}
                    />
                    <Line
                      name="Total daily units"
                      type="monotone"
                      dataKey="units"
                      stroke="#14b8a6"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
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
