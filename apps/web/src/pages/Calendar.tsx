import "./Calendar.css";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PriceSchedule, Paginated, Sku } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, dateShort, relativeTime } from "../lib/format";
import { Loading, ErrorState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";
import { Modal } from "../components/Modal";
import { PriceScheduleModal } from "../components/PriceScheduleModal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAYS_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

type CalView = "month" | "week" | "day";
type SchedType = "single" | "weekly" | "monthly";

const EVENT_CLASS: Record<SchedType, string> = {
  single: "cal-event-blue",
  weekly: "cal-event-green",
  monthly: "cal-event-orange",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function parseStart(s: PriceSchedule): Date | null {
  if (!s.startDate) return null;
  const d = new Date(s.startDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}
function hourOf(time: string | undefined): number {
  if (!time) return 0;
  const h = parseInt(time.split(":")[0] ?? "0", 10);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 0;
}

interface MonthCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
}

function buildMonthCells(cursor: Date, today: Date): MonthCell[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, inMonth: false, isToday: sameDay(d, today) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ date, inMonth: true, isToday: sameDay(date, today) });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ date: d, inMonth: false, isToday: sameDay(d, today) });
  }
  return cells;
}

/** SKU id → minimum data the schedule modal needs. Derived from the schedule
 *  list (since each schedule already carries `sku`, `skuId`, `title`,
 *  `imageUrl`, `currentPrice`). Saves a separate /skus lookup when opening
 *  from a pill. */
function skuFromSchedule(s: PriceSchedule): {
  id: string;
  sku: string;
  title: string;
  price: number;
  imageUrl: string | null;
} {
  return {
    id: s.skuId,
    sku: s.sku,
    title: s.title,
    imageUrl: s.imageUrl ?? null,
    price: s.currentPrice ?? s.price,
  };
}

function initial(s: string): string {
  return (s.trim()[0] ?? "?").toUpperCase();
}

export function Calendar() {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [view, setView] = useState<CalView>("month");
  const [skuFilter, setSkuFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // ---- Modal states ----
  // The shared schedule drawer (matches SKUs page UX) — opened once we know
  // which SKU the user wants to schedule against.
  const [scheduleSku, setScheduleSku] = useState<{
    id: string;
    sku: string;
    title: string;
    price: number;
    asin?: string | null;
    imageUrl?: string | null;
    channelStock?: number | null;
    fulfillmentChannel?: string | null;
    status?: string | null;
  } | null>(null);
  // Lightweight SKU picker that fronts the drawer when starting from a date
  // cell or the "New Schedule" button (no SKU known yet).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  // Event details popup when a pill is clicked.
  const [detailsFor, setDetailsFor] = useState<PriceSchedule | null>(null);
  // "See all schedules for this day" popup, opened from the "+N more" pill on
  // a crowded month cell — avoids jumping to day view to read the overflow.
  const [allEventsFor, setAllEventsFor] = useState<{
    date: Date;
    events: PriceSchedule[];
  } | null>(null);

  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<Paginated<PriceSchedule>>("/schedules"),
  });

  const skuQuery = useQuery({
    queryKey: ["skus", "cal-picker", pickerSearch],
    queryFn: () =>
      api.get<Paginated<Sku>>(
        "/skus" + qs({ search: pickerSearch, pageSize: 12 }),
      ),
    enabled: pickerOpen,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setDetailsFor(null);
    },
  });

  // Reset picker state every time it opens.
  useEffect(() => {
    if (pickerOpen) setPickerSearch("");
  }, [pickerOpen]);

  const today = startOfDay(new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const allItems: PriceSchedule[] = query.data?.items ?? [];

  const items = useMemo(() => {
    const f = skuFilter.trim().toLowerCase();
    if (!f) return allItems;
    return allItems.filter(
      (s) =>
        s.sku?.toLowerCase().includes(f) ||
        s.title?.toLowerCase().includes(f),
    );
  }, [allItems, skuFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PriceSchedule[]>();
    for (const s of items) {
      const d = parseStart(s);
      if (!d) continue;
      const key = dateKeyOf(d);
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [items]);

  const cells = useMemo(
    () => buildMonthCells(cursor, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cursor],
  );

  const eventsFor = (d: Date): PriceSchedule[] =>
    eventsByDay.get(dateKeyOf(d)) ?? [];

  const weekDays = useMemo(() => {
    const base = new Date(year, month, cursor.getDate());
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor, year, month]);

  const weekSlots = useMemo(() => {
    const map = new Map<string, PriceSchedule[]>();
    const add = (col: number, hour: number, s: PriceSchedule) => {
      if (col < 0 || col > 6 || hour < 0 || hour > 23) return;
      const k = `${col}-${hour}`;
      const arr = map.get(k);
      if (arr) arr.push(s);
      else map.set(k, [s]);
    };
    for (const s of items) {
      if (s.type === "single") {
        const d = parseStart(s);
        if (!d) continue;
        const col = weekDays.findIndex((wd) => sameDay(wd, d));
        add(col, d.getHours(), s);
      } else if (s.type === "weekly") {
        for (const ts of s.timeSlots) {
          const col = weekDays.findIndex((wd) => wd.getDay() === ts.day);
          add(col, hourOf(ts.startTime), s);
        }
      } else {
        for (const ts of s.timeSlots) {
          const col = weekDays.findIndex((wd) => wd.getDate() === ts.day);
          add(col, hourOf(ts.startTime), s);
        }
      }
    }
    return map;
  }, [items, weekDays]);

  const dayEvents = eventsFor(new Date(year, month, cursor.getDate()));

  const prevPeriod = () => {
    if (view === "month") setCursor(new Date(year, month - 1, 1));
    else if (view === "week")
      setCursor(new Date(year, month, cursor.getDate() - 7));
    else setCursor(new Date(year, month, cursor.getDate() - 1));
  };
  const nextPeriod = () => {
    if (view === "month") setCursor(new Date(year, month + 1, 1));
    else if (view === "week")
      setCursor(new Date(year, month, cursor.getDate() + 7));
    else setCursor(new Date(year, month, cursor.getDate() + 1));
  };
  const goToday = () => {
    const now = new Date();
    setCursor(
      view === "month"
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    );
  };

  const headerLabel =
    view === "day"
      ? `${MONTHS[month]} ${cursor.getDate()}, ${year}`
      : `${MONTHS[month]} ${year}`;

  /** Click on a pill → details popup; click on cell background → SKU picker. */
  function onEventClick(e: React.MouseEvent, s: PriceSchedule) {
    e.stopPropagation();
    setDetailsFor(s);
  }
  function openPicker() {
    setPickerOpen(true);
  }
  function pickSku(s: Sku) {
    setPickerOpen(false);
    setScheduleSku({
      id: s.id,
      sku: s.sku,
      title: s.title,
      price: s.price,
      asin: s.asin,
      imageUrl: s.imageUrl,
      channelStock: s.stock,
      fulfillmentChannel: s.fulfillmentChannel,
      status: s.status,
    });
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <button className="btn btn-secondary btn-sm" onClick={goToday}>
          Today
        </button>
        <div style={{ display: "flex", gap: 2 }}>
          <button
            className="btn btn-secondary btn-icon btn-sm"
            onClick={prevPeriod}
            aria-label="Previous"
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
          <button
            className="btn btn-secondary btn-icon btn-sm"
            onClick={nextPeriod}
            aria-label="Next"
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
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {headerLabel}
        </div>

        <div style={{ flex: 1 }} />

        <div className="segmented">
          <button
            className={view === "month" ? "active" : undefined}
            onClick={() => setView("month")}
          >
            Month
          </button>
          <button
            className={view === "week" ? "active" : undefined}
            onClick={() => setView("week")}
          >
            Week
          </button>
          <button
            className={view === "day" ? "active" : undefined}
            onClick={() => setView("day")}
          >
            Day
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Filter by SKU
          </button>
          {filterOpen && (
            <div
              className="dropdown-menu show"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                minWidth: 260,
                padding: 8,
              }}
            >
              <input
                className="form-control"
                placeholder="Filter by SKU or title…"
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                style={{ fontSize: 12.5, height: 32 }}
              />
              {skuFilter && (
                <button
                  className="btn btn-ghost btn-xs"
                  style={{ marginTop: 6 }}
                  onClick={() => setSkuFilter("")}
                >
                  Clear filter
                </button>
              )}
            </div>
          )}
        </div>

        <button className="btn btn-primary btn-sm" onClick={openPicker}>
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
          New Schedule
        </button>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          fontSize: 12.5,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--text-3)" }}>
          Event types:
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "var(--info-fg)",
            }}
          />{" "}
          Single
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "var(--success-fg)",
            }}
          />{" "}
          Weekly
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "#c2410c",
            }}
          />{" "}
          Monthly
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--text-3)" }}>
          {query.isSuccess
            ? `Showing ${items.length} schedule${items.length === 1 ? "" : "s"} across ${MONTHS[month]} ${year}`
            : ""}
        </span>
      </div>

      {query.isError ? (
        <ErrorState />
      ) : query.isLoading ? (
        <Loading />
      ) : view === "month" ? (
        <div className="cal-grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-head">
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            const evts = eventsFor(cell.date);
            const shown = evts.slice(0, 3);
            const more = evts.length - shown.length;
            return (
              <div
                key={i}
                className={
                  "cal-cell" +
                  (cell.inMonth ? "" : " muted") +
                  (cell.isToday ? " today" : "")
                }
                onClick={openPicker}
              >
                <div className="cal-cell-head">
                  <span className="date-num">{pad2(cell.date.getDate())}</span>
                  <button
                    className="cal-add-btn"
                    aria-label="Add schedule on this day"
                    title="Add schedule"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPicker();
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                {shown.map((s) => (
                  <div
                    key={s.id}
                    className={`cal-event ${EVENT_CLASS[s.type]}`}
                    title={`${s.title} (${s.sku})`}
                    onClick={(e) => onEventClick(e, s)}
                  >
                    {s.sku} → {money(s.price)}
                  </div>
                ))}
                {more > 0 && (
                  <div
                    className="cal-event cal-event-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAllEventsFor({ date: cell.date, events: evts });
                    }}
                  >
                    +{more} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : view === "week" ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="cal-week-head">
            <div />
            {weekDays.map((d) => (
              <div
                key={d.toISOString()}
                className={sameDay(d, today) ? "today" : undefined}
              >
                {pad2(d.getDate())} {WEEKDAYS[d.getDay()]}
              </div>
            ))}
          </div>
          <div className="cal-week-body">
            {HOURS.map((h) => (
              <div key={h} className="cal-week-row">
                <div className="cal-week-hour">{hourLabel(h)}</div>
                {weekDays.map((d, col) => {
                  const evts = weekSlots.get(`${col}-${h}`) ?? [];
                  return (
                    <div
                      key={d.toISOString()}
                      className={
                        "cal-week-cell" +
                        (sameDay(d, today) ? " today-col" : "")
                      }
                      onClick={openPicker}
                    >
                      {evts.map((s) => (
                        <div
                          key={s.id}
                          className={`cal-event ${EVENT_CLASS[s.type]}`}
                          title={`${s.title} (${s.sku})`}
                          onClick={(e) => onEventClick(e, s)}
                        >
                          {s.sku} → {money(s.price)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 650, fontSize: 16 }}>
                {DAYS_LONG[new Date(year, month, cursor.getDate()).getDay()]},{" "}
                {MONTHS_SHORT[month]} {cursor.getDate()}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {dayEvents.length} scheduled event
                {dayEvents.length === 1 ? "" : "s"}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={openPicker}>
              + Schedule for this day
            </button>
          </div>
          <div style={{ padding: "14px 18px" }}>
            {dayEvents.length === 0 ? (
              <div
                style={{
                  color: "var(--text-3)",
                  fontSize: 13,
                  padding: "24px 0",
                  textAlign: "center",
                }}
              >
                No schedules start on this day.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {dayEvents.map((s) => (
                  <div
                    key={s.id}
                    className="card cal-day-row"
                    style={{ padding: 14, cursor: "pointer" }}
                    onClick={() => setDetailsFor(s)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <StatusBadge status={s.status} />
                      <div style={{ fontWeight: 600 }}>
                        {s.sku} → {money(s.price)}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-3)",
                          maxWidth: 360,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.title}
                      </div>
                      <div style={{ flex: 1 }} />
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {s.timeSlots.length > 0
                          ? `${s.timeSlots[0].startTime} – ${s.timeSlots[0].endTime}`
                          : s.startDate
                            ? dateShort(s.startDate)
                            : "All day"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SKU picker — opens before the schedule drawer so the user picks a SKU */}
      <Modal
        open={pickerOpen}
        title="Pick a SKU"
        subtitle="Type to search by SKU, ASIN, or title — then choose which SKU to schedule a price change on."
        size="lg"
        onClose={() => setPickerOpen(false)}
      >
        <div className="form-group">
          <input
            className="form-control"
            placeholder="Search by SKU, ASIN, or title…"
            autoFocus
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
          />
        </div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {skuQuery.isLoading ? (
            <div style={{ padding: 12, fontSize: 13, color: "var(--text-3)" }}>
              Searching…
            </div>
          ) : (skuQuery.data?.items ?? []).length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: "var(--text-3)" }}>
              No SKUs match.
            </div>
          ) : (
            (skuQuery.data?.items ?? []).map((s) => (
              <div
                key={s.id}
                className="picker-row"
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderBottom: "1px solid var(--border)",
                }}
                onClick={() => pickSku(s)}
              >
                <ProductThumb src={s.imageUrl} title={s.title} size={42} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 550,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {s.title}
                  </div>
                  <div
                    className="muted mono"
                    style={{ fontSize: 11.5, marginTop: 3 }}
                  >
                    {s.sku} · {money(s.price)}
                  </div>
                </div>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: "var(--text-3)", flexShrink: 0 }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* All schedules on a single day — opened from "+N more" pill */}
      <Modal
        open={!!allEventsFor}
        title={
          allEventsFor
            ? `Schedules on ${MONTHS_SHORT[allEventsFor.date.getMonth()]} ${allEventsFor.date.getDate()}, ${allEventsFor.date.getFullYear()}`
            : ""
        }
        subtitle={
          allEventsFor
            ? `${allEventsFor.events.length} scheduled event${allEventsFor.events.length === 1 ? "" : "s"} on this day — click any to see details.`
            : undefined
        }
        size="lg"
        onClose={() => setAllEventsFor(null)}
        footer={
          allEventsFor && (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setAllEventsFor(null)}
              >
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setAllEventsFor(null);
                  openPicker();
                }}
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
                New schedule
              </button>
            </>
          )
        }
      >
        {allEventsFor && (
          <div className="cal-allday-list">
            {allEventsFor.events.map((s) => (
              <div
                key={s.id}
                className="cal-allday-row"
                onClick={() => {
                  setAllEventsFor(null);
                  setDetailsFor(s);
                }}
              >
                <span
                  className={`cal-event ${EVENT_CLASS[s.type]}`}
                  style={{ margin: 0, textTransform: "capitalize" }}
                  title={s.type}
                >
                  {s.type}
                </span>
                <div className="cal-allday-main">
                  <div className="cal-allday-title">{s.title}</div>
                  <div className="cal-allday-sub">
                    <span className="copy-btn">{s.sku}</span>
                    <span style={{ color: "var(--text-3)" }}>
                      {money(s.currentPrice)} → <b>{money(s.price)}</b>
                    </span>
                  </div>
                </div>
                <StatusBadge status={s.status} />
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ color: "var(--text-3)", flexShrink: 0 }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Event details popup — click a pill */}
      <Modal
        open={!!detailsFor}
        title="Schedule details"
        onClose={() => setDetailsFor(null)}
        footer={
          detailsFor && (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setDetailsFor(null)}
              >
                Close
              </button>
              {detailsFor.status !== "cancelled" && (
                <button
                  className="btn btn-secondary"
                  style={{
                    color: "var(--danger-fg)",
                    borderColor: "var(--danger-border)",
                  }}
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(detailsFor.id)}
                >
                  {deleteMut.isPending ? "Cancelling…" : "Cancel schedule"}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!detailsFor) return;
                  setScheduleSku(skuFromSchedule(detailsFor));
                  setDetailsFor(null);
                }}
              >
                Schedule another change
              </button>
            </>
          )
        }
      >
        {detailsFor && (
          <div className="cal-details">
            <div className="cal-details-head">
              <ProductThumb
                src={detailsFor.imageUrl ?? null}
                title={detailsFor.title}
                size={56}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cal-details-title">{detailsFor.title}</div>
                <div className="cal-details-sub">
                  <span className="copy-btn">{detailsFor.sku}</span>
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                    {money(detailsFor.price)}
                  </span>
                </div>
              </div>
            </div>
            <div className="cal-details-row">
              <div className="cal-details-label">Type</div>
              <div style={{ textTransform: "capitalize", fontWeight: 600 }}>
                {detailsFor.type}
              </div>
            </div>
            <div className="cal-details-row">
              <div className="cal-details-label">Status</div>
              <StatusBadge status={detailsFor.status} />
            </div>
            <div className="cal-details-row">
              <div className="cal-details-label">SKU</div>
              <span className="copy-btn">{detailsFor.sku}</span>
            </div>
            <div className="cal-details-row">
              <div className="cal-details-label">New price</div>
              <div style={{ fontWeight: 700 }}>{money(detailsFor.price)}</div>
            </div>
            <div className="cal-details-row">
              <div className="cal-details-label">Revert to</div>
              <div>{money(detailsFor.currentPrice)}</div>
            </div>
            {detailsFor.type === "single" ? (
              <>
                <div className="cal-details-row">
                  <div className="cal-details-label">Start</div>
                  <div>
                    {detailsFor.startDate
                      ? new Date(detailsFor.startDate).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <div className="cal-details-row">
                  <div className="cal-details-label">End</div>
                  <div>
                    {detailsFor.untilChanged
                      ? "Until manually reverted"
                      : detailsFor.endDate
                        ? new Date(detailsFor.endDate).toLocaleString()
                        : "—"}
                  </div>
                </div>
              </>
            ) : (
              <div className="cal-details-row">
                <div className="cal-details-label">Slots</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {detailsFor.timeSlots.map((sl, i) => (
                    <div key={i} style={{ fontSize: 12.5 }}>
                      {detailsFor.type === "weekly"
                        ? DAYS_LONG[sl.day]
                        : `Day ${sl.day}`}{" "}
                      · {sl.startTime} – {sl.endTime} · {money(sl.price)}
                      {sl.revertPrice != null && ` → ${money(sl.revertPrice)}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="cal-details-row">
              <div className="cal-details-label">Created</div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                {detailsFor.createdBy} · {relativeTime(detailsFor.createdAt)}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Shared schedule drawer */}
      <PriceScheduleModal
        open={!!scheduleSku}
        sku={scheduleSku}
        onClose={() => setScheduleSku(null)}
      />
    </div>
  );
}

/* Reusable thumbnail with a graceful fallback to the title's first letter.
   Used by both the SKU picker rows and the schedule-details popup so a
   missing image_url doesn't leave an empty grey box. */
function ProductThumb({
  src,
  title,
  size = 40,
}: {
  src: string | null | undefined;
  title: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const show = src && !errored ? src : null;
  return show ? (
    <img
      src={show}
      alt=""
      onError={() => setErrored(true)}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        objectFit: "cover",
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        flexShrink: 0,
      }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-3)",
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >
      {initial(title)}
    </div>
  );
}
