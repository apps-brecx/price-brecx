import "./Calendar.css";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PriceSchedule, Paginated, Sku } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, dateShort } from "../lib/format";
import { Loading, ErrorState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";
import { Modal } from "../components/Modal";

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
function formatLongDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS_LONG[dt.getDay()]}, ${MONTHS_SHORT[m - 1]} ${d}`;
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

interface ScheduleForm {
  type: SchedType;
  start: string; // datetime-local
  end: string; // datetime-local
  newPrice: string;
  revertTo: string;
  keepUntilReverted: boolean;
  weekdays: number[]; // weekly
  monthDay: string; // monthly day-of-month
  startTime: string; // weekly/monthly
  endTime: string; // weekly/monthly
}

function defaultForm(dateKey: string): ScheduleForm {
  return {
    type: "single",
    start: `${dateKey}T17:30`,
    end: `${dateKey}T23:59`,
    newPrice: "",
    revertTo: "",
    keepUntilReverted: false,
    weekdays: [],
    monthDay: String(Number(dateKey.split("-")[2])),
    startTime: "17:30",
    endTime: "23:59",
  };
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

  // New Schedule modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDateKey, setModalDateKey] = useState<string>(() =>
    dateKeyOf(new Date()),
  );
  const [form, setForm] = useState<ScheduleForm>(() =>
    defaultForm(dateKeyOf(new Date())),
  );
  const [skuSearch, setSkuSearch] = useState("");
  const [selected, setSelected] = useState<Sku[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<Paginated<PriceSchedule>>("/schedules"),
  });

  const skuQuery = useQuery({
    queryKey: ["skus", "cal-search", skuSearch],
    queryFn: () =>
      api.get<Paginated<Sku>>("/skus" + qs({ search: skuSearch, pageSize: 8 })),
    enabled: modalOpen && skuSearch.trim().length > 0,
  });

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

  // Week view: place each schedule into its [dayColumn-hour] slot.
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

  function openSchedule(dateKey: string) {
    setModalDateKey(dateKey);
    setForm(defaultForm(dateKey));
    setSelected([]);
    setSkuSearch("");
    setFormError(null);
    setModalOpen(true);
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const newPrice = Number(form.newPrice);
      for (const sku of selected) {
        const revert = Number(form.revertTo);
        const currentPrice =
          Number.isFinite(revert) && revert > 0
            ? revert
            : sku.price > 0
              ? sku.price
              : newPrice;

        if (form.type === "single") {
          await api.post("/schedules", {
            skuId: sku.id,
            type: "single",
            price: newPrice,
            currentPrice,
            startDate: new Date(form.start).toISOString(),
            endDate:
              form.keepUntilReverted || !form.end
                ? undefined
                : new Date(form.end).toISOString(),
            timeSlots: [],
            timezone: "America/New_York",
          });
        } else if (form.type === "weekly") {
          await api.post("/schedules", {
            skuId: sku.id,
            type: "weekly",
            price: newPrice,
            currentPrice,
            timeSlots: form.weekdays.map((day) => ({
              day,
              startTime: form.startTime,
              endTime: form.endTime,
              price: newPrice,
            })),
            timezone: "America/New_York",
          });
        } else {
          await api.post("/schedules", {
            skuId: sku.id,
            type: "monthly",
            price: newPrice,
            currentPrice,
            timeSlots: [
              {
                day: Number(form.monthDay),
                startTime: form.startTime,
                endTime: form.endTime,
                price: newPrice,
              },
            ],
            timezone: "America/New_York",
          });
        }
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["schedules"] });
      await qc.invalidateQueries({ queryKey: ["nav-counts"] });
      setModalOpen(false);
    },
    onError: (e) =>
      setFormError(e instanceof Error ? e.message : "Failed to create schedule"),
  });

  function submitSchedule() {
    setFormError(null);
    if (selected.length === 0) {
      setFormError("Select at least one SKU.");
      return;
    }
    const np = Number(form.newPrice);
    if (!Number.isFinite(np) || np <= 0) {
      setFormError("Enter a valid new price.");
      return;
    }
    if (form.type === "weekly" && form.weekdays.length === 0) {
      setFormError("Pick at least one weekday.");
      return;
    }
    createMut.mutate();
  }

  const set = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}
      >
        <button className="btn btn-secondary btn-sm" onClick={goToday}>
          Today
        </button>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="btn btn-secondary btn-icon btn-sm" onClick={prevPeriod} aria-label="Previous">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="btn btn-secondary btn-icon btn-sm" onClick={nextPeriod} aria-label="Next">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
          {headerLabel}
        </div>

        <div style={{ flex: 1 }} />

        <div className="segmented">
          <button className={view === "month" ? "active" : undefined} onClick={() => setView("month")}>Month</button>
          <button className={view === "week" ? "active" : undefined} onClick={() => setView("week")}>Week</button>
          <button className={view === "day" ? "active" : undefined} onClick={() => setView("day")}>Day</button>
        </div>

        <div style={{ position: "relative" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Filter by SKU
          </button>
          {filterOpen && (
            <div
              className="dropdown-menu show"
              style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", minWidth: 260, padding: 8 }}
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

        <button
          className="btn btn-primary btn-sm"
          onClick={() => openSchedule(dateKeyOf(view === "month" ? today : new Date(year, month, cursor.getDate())))}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Schedule
        </button>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
          padding: "10px 14px", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: 12.5,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--text-3)" }}>Event types:</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--info-fg)" }} /> Single
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--success-fg)" }} /> Weekly
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#c2410c" }} /> Monthly
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
            <div key={w} className="cal-head">{w}</div>
          ))}
          {cells.map((cell, i) => {
            const evts = eventsFor(cell.date);
            const shown = evts.slice(0, 2);
            const more = evts.length - shown.length;
            const key = dateKeyOf(cell.date);
            return (
              <div
                key={i}
                className={
                  "cal-cell" +
                  (cell.inMonth ? "" : " muted") +
                  (cell.isToday ? " today" : "")
                }
                onClick={() => openSchedule(key)}
              >
                <span className="date-num">{pad2(cell.date.getDate())}</span>
                {shown.map((s) => (
                  <div
                    key={s.id}
                    className={`cal-event ${EVENT_CLASS[s.type]}`}
                    title={`${s.sku} · ${s.title}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.title || s.sku} · {money(s.price)}
                  </div>
                ))}
                {more > 0 && (
                  <div
                    className="cal-event"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text-3)",
                      borderColor: "var(--text-4)",
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
                        "cal-week-cell" + (sameDay(d, today) ? " today-col" : "")
                      }
                      onClick={() => openSchedule(dateKeyOf(d))}
                    >
                      {evts.map((s) => (
                        <div
                          key={s.id}
                          className={`cal-event ${EVENT_CLASS[s.type]}`}
                          title={`${s.sku} · ${s.title}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.title || s.sku} · {money(s.price)}
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
              padding: "14px 18px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 650, fontSize: 16 }}>
                {DAYS_LONG[new Date(year, month, cursor.getDate()).getDay()]},{" "}
                {MONTHS_SHORT[month]} {cursor.getDate()}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {dayEvents.length} scheduled event{dayEvents.length === 1 ? "" : "s"}
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openSchedule(dateKeyOf(new Date(year, month, cursor.getDate())))}
            >
              + Schedule for this day
            </button>
          </div>
          <div style={{ padding: "14px 18px" }}>
            {dayEvents.length === 0 ? (
              <div style={{ color: "var(--text-3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
                No schedules start on this day.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {dayEvents.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <StatusBadge status={s.status} />
                      <div style={{ fontWeight: 600 }}>
                        {s.title || s.sku} → {money(s.price)}
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

      {/* New Schedule modal */}
      <Modal
        open={modalOpen}
        title="New Schedule"
        subtitle={formatLongDate(modalDateKey)}
        size="lg"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={submitSchedule}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? "Creating…" : "Create Schedule"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Select SKU(s) <span className="req">*</span>
          </label>
          <input
            className="form-control"
            placeholder="Search by SKU, ASIN, or product title…"
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
          />
          <div className="form-help">Can select multiple products</div>

          {selected.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {selected.map((s) => (
                <span key={s.id} className="tag tag-blue">
                  {s.sku}
                  <span
                    style={{ cursor: "pointer", marginLeft: 4 }}
                    onClick={() =>
                      setSelected((cur) => cur.filter((x) => x.id !== s.id))
                    }
                  >
                    ✕
                  </span>
                </span>
              ))}
            </div>
          )}

          {skuSearch.trim() && (
            <div
              style={{
                marginTop: 8, border: "1px solid var(--border)",
                borderRadius: 8, maxHeight: 180, overflowY: "auto",
              }}
            >
              {skuQuery.isLoading ? (
                <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-3)" }}>
                  Searching…
                </div>
              ) : (skuQuery.data?.items ?? []).length === 0 ? (
                <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-3)" }}>
                  No SKUs found.
                </div>
              ) : (
                (skuQuery.data?.items ?? []).map((s) => {
                  const picked = selected.some((x) => x.id === s.id);
                  return (
                    <div
                      key={s.id}
                      className="picker-row"
                      style={{
                        padding: "8px 10px", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                      onClick={() =>
                        setSelected((cur) =>
                          picked
                            ? cur.filter((x) => x.id !== s.id)
                            : [...cur, s],
                        )
                      }
                    >
                      <input type="checkbox" readOnly checked={picked} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>
                          {s.title}
                        </div>
                        <div className="muted mono" style={{ fontSize: 11.5 }}>
                          {s.sku} · {money(s.price)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="tabs-inline" style={{ marginBottom: 14 }}>
          <button
            className={form.type === "single" ? "active" : undefined}
            onClick={() => set("type", "single")}
          >
            Single Change
          </button>
          <button
            className={form.type === "weekly" ? "active" : undefined}
            onClick={() => set("type", "weekly")}
          >
            Weekly Recurring
          </button>
          <button
            className={form.type === "monthly" ? "active" : undefined}
            onClick={() => set("type", "monthly")}
          >
            Monthly Recurring
          </button>
        </div>

        {form.type === "single" && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                Start <span className="req">*</span>
              </label>
              <input
                type="datetime-local"
                className="form-control"
                value={form.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input
                type="datetime-local"
                className="form-control"
                value={form.end}
                disabled={form.keepUntilReverted}
                onChange={(e) => set("end", e.target.value)}
              />
            </div>
          </div>
        )}

        {form.type === "weekly" && (
          <div className="form-group">
            <label className="form-label">
              Repeat on <span className="req">*</span>
            </label>
            <div className="day-picker">
              {WEEKDAYS.map((w, idx) => (
                <button
                  key={w}
                  type="button"
                  className={
                    "day-pick" + (form.weekdays.includes(idx) ? " selected" : "")
                  }
                  onClick={() =>
                    set(
                      "weekdays",
                      form.weekdays.includes(idx)
                        ? form.weekdays.filter((d) => d !== idx)
                        : [...form.weekdays, idx],
                    )
                  }
                >
                  {w}
                </button>
              ))}
            </div>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label">Start time</label>
                <input
                  type="time"
                  className="form-control"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">End time</label>
                <input
                  type="time"
                  className="form-control"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {form.type === "monthly" && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                Day of month <span className="req">*</span>
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="form-control"
                value={form.monthDay}
                onChange={(e) => set("monthDay", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Start / End time</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="time"
                  className="form-control"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
                <input
                  type="time"
                  className="form-control"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              New Price <span className="req">*</span>
            </label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={form.newPrice}
              onChange={(e) => set("newPrice", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Revert to</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={form.revertTo}
              onChange={(e) => set("revertTo", e.target.value)}
            />
            <div className="form-help">
              Defaults to each SKU's current price.
            </div>
          </div>
        </div>

        {form.type === "single" && (
          <label
            className="checkbox-item"
            style={{ padding: 0, display: "flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={form.keepUntilReverted}
              onChange={(e) => set("keepUntilReverted", e.target.checked)}
            />
            Keep changed price until manually reverted
          </label>
        )}

        {formError && (
          <div
            style={{
              marginTop: 12, background: "var(--danger-bg)",
              color: "var(--danger-fg)", border: "1px solid var(--danger-border)",
              borderRadius: 8, padding: "9px 12px", fontSize: 12.5,
            }}
          >
            {formError}
          </div>
        )}
      </Modal>
    </div>
  );
}
