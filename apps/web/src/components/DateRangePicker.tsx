import { useEffect, useMemo, useRef, useState } from "react";
import "./DateRangePicker.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Preset {
  label: string;
  /** Returns [startDate, endDate] when applied. */
  range: () => [Date, Date];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() - out.getDay());
  return out;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromYmd(s: string | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function inRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

const PRESETS: Preset[] = [
  {
    label: "Today",
    range: () => {
      const t = startOfDay(new Date());
      return [t, t];
    },
  },
  {
    label: "Last 7 Days",
    range: () => [addDays(startOfDay(new Date()), -6), startOfDay(new Date())],
  },
  {
    label: "This Week",
    range: () => [
      startOfWeek(new Date()),
      addDays(startOfWeek(new Date()), 6),
    ],
  },
  {
    label: "Last Week",
    range: () => {
      const start = addDays(startOfWeek(new Date()), -7);
      return [start, addDays(start, 6)];
    },
  },
  {
    label: "Last 30 Days",
    range: () => [
      addDays(startOfDay(new Date()), -29),
      startOfDay(new Date()),
    ],
  },
  {
    label: "Last 90 Days",
    range: () => [
      addDays(startOfDay(new Date()), -89),
      startOfDay(new Date()),
    ],
  },
  {
    label: "This Month",
    range: () => [startOfMonth(new Date()), startOfDay(new Date())],
  },
  {
    label: "Last Month",
    range: () => {
      const lastMonth = addMonths(startOfMonth(new Date()), -1);
      return [lastMonth, endOfMonth(lastMonth)];
    },
  },
  {
    label: "Last 6 Months",
    range: () => [
      addMonths(startOfMonth(new Date()), -5),
      startOfDay(new Date()),
    ],
  },
  {
    label: "Year to Date",
    range: () => [
      new Date(new Date().getFullYear(), 0, 1),
      startOfDay(new Date()),
    ],
  },
];

/**
 * Ant-Design-style date range picker:
 *  - Two inputs separated by an arrow trigger the dropdown
 *  - Dropdown shows preset sidebar + two side-by-side month grids
 *  - First click picks the start, hover previews, second click commits
 *
 * Values are exchanged with the parent as YYYY-MM-DD strings (matches the
 * sales-report API contract). `null` is treated as "no value" both ways.
 */
export function DateRangePicker({
  start,
  end,
  onChange,
  placeholderStart = "Start date",
  placeholderEnd = "End date",
}: {
  start: string | null | undefined;
  end: string | null | undefined;
  onChange: (start: string | null, end: string | null) => void;
  placeholderStart?: string;
  placeholderEnd?: string;
}) {
  const [open, setOpen] = useState(false);
  // Local draft while picking — committed to parent on full range selection
  // or preset click.
  const initialStart = useMemo(() => fromYmd(start ?? undefined), [start]);
  const initialEnd = useMemo(() => fromYmd(end ?? undefined), [end]);
  const [draftStart, setDraftStart] = useState<Date | null>(initialStart);
  const [draftEnd, setDraftEnd] = useState<Date | null>(initialEnd);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  // Left panel's anchor month — right is always +1.
  const [leftMonth, setLeftMonth] = useState<Date>(() => {
    return initialStart ?? new Date();
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Resync draft when parent value changes (e.g. preset chip on the modal).
  useEffect(() => {
    setDraftStart(initialStart);
    setDraftEnd(initialEnd);
    if (initialStart) setLeftMonth(initialStart);
  }, [initialStart, initialEnd]);

  // Click outside / Esc → close, keeping whatever range is committed.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null;
      if (t && wrapRef.current && wrapRef.current.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  function pickDate(d: Date) {
    if (!draftStart || (draftStart && draftEnd)) {
      // Start a new selection.
      setDraftStart(d);
      setDraftEnd(null);
      return;
    }
    // Completing the range.
    if (d.getTime() < draftStart.getTime()) {
      // User clicked an earlier day → treat first click as the new end.
      setDraftStart(d);
      setDraftEnd(draftStart);
    } else {
      setDraftEnd(d);
    }
    // Commit to parent on the next tick so React renders the second click
    // selected before we close.
    const s = d.getTime() < draftStart.getTime() ? d : draftStart;
    const e = d.getTime() < draftStart.getTime() ? draftStart : d;
    setTimeout(() => {
      onChange(ymd(s), ymd(e));
      setOpen(false);
    }, 60);
  }

  function applyPreset(p: Preset) {
    const [s, e] = p.range();
    setDraftStart(s);
    setDraftEnd(e);
    setLeftMonth(s);
    onChange(ymd(s), ymd(e));
    setOpen(false);
  }

  function clear() {
    setDraftStart(null);
    setDraftEnd(null);
    onChange(null, null);
    setOpen(false);
  }

  const display = (d: Date | null, placeholder: string) =>
    d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      : placeholder;

  const hasValue = !!(draftStart || draftEnd);

  return (
    <div className="drp-wrap" ref={wrapRef}>
      <div
        className={
          "drp-trigger" +
          (open ? " active" : "") +
          (hasValue ? " has-value" : "")
        }
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
      >
        <span className={"drp-trigger-value" + (draftStart ? "" : " placeholder")}>
          {display(draftStart, placeholderStart)}
        </span>
        <span className="drp-arrow">→</span>
        <span className={"drp-trigger-value" + (draftEnd ? "" : " placeholder")}>
          {display(draftEnd, placeholderEnd)}
        </span>
        {/* Calendar icon — replaced by the clear (×) on hover when a range
            is set, mirroring Ant Design's RangePicker affordance. */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="drp-cal-icon"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {hasValue && (
          <button
            type="button"
            className="drp-clear-btn"
            aria-label="Clear date range"
            onMouseDown={(e) => {
              // Beat the trigger's onClick so the popover doesn't open.
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="drp-popover">
          <div className="drp-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="drp-preset"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
            <button type="button" className="drp-preset drp-clear" onClick={clear}>
              Clear
            </button>
          </div>
          <div className="drp-panes">
            <div className="drp-pane-head">
              <button
                type="button"
                className="drp-nav"
                onClick={() => setLeftMonth(addMonths(leftMonth, -12))}
                title="Previous year"
              >
                «
              </button>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                title="Previous month"
              >
                ‹
              </button>
              <div className="drp-pane-title">
                {MONTHS[leftMonth.getMonth()]} {leftMonth.getFullYear()}
              </div>
              <div className="drp-pane-title">
                {MONTHS[addMonths(leftMonth, 1).getMonth()]}{" "}
                {addMonths(leftMonth, 1).getFullYear()}
              </div>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                title="Next month"
              >
                ›
              </button>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setLeftMonth(addMonths(leftMonth, 12))}
                title="Next year"
              >
                »
              </button>
            </div>
            <div className="drp-pane-grid">
              <MonthGrid
                month={leftMonth}
                start={draftStart}
                end={draftEnd}
                hover={hoverDate}
                onPick={pickDate}
                onHover={setHoverDate}
              />
              <MonthGrid
                month={addMonths(leftMonth, 1)}
                start={draftStart}
                end={draftEnd}
                hover={hoverDate}
                onPick={pickDate}
                onHover={setHoverDate}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  month,
  start,
  end,
  hover,
  onPick,
  onHover,
}: {
  month: Date;
  start: Date | null;
  end: Date | null;
  hover: Date | null;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const prevMonthLast = new Date(year, m, 0).getDate();
  const today = startOfDay(new Date());

  // Mirror the SalesReport "in-progress" range — when only `start` is set,
  // use the hovered cell as the virtual end so the user sees a preview band.
  const previewEnd =
    start && !end && hover && hover.getTime() >= start.getTime() ? hover : end;
  const previewStart =
    start && !end && hover && hover.getTime() < start.getTime() ? hover : start;

  const cells: Array<{ d: number; inMonth: boolean; date: Date }> = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push({
      d: prevMonthLast - firstDay + 1 + i,
      inMonth: false,
      date: new Date(year, m - 1, prevMonthLast - firstDay + 1 + i),
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d, inMonth: true, date: new Date(year, m, d) });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cells.push({ d: i, inMonth: false, date: new Date(year, m + 1, i) });
  }

  return (
    <div className="drp-grid">
      {WEEKDAYS.map((w) => (
        <div key={w} className="drp-dh">
          {w}
        </div>
      ))}
      {cells.map((c, i) => {
        const isToday = sameDay(c.date, today);
        const isStart = previewStart && sameDay(c.date, previewStart);
        const isEnd = previewEnd && sameDay(c.date, previewEnd);
        const isInRange =
          previewStart && previewEnd && inRange(c.date, previewStart, previewEnd);
        return (
          <button
            key={i}
            type="button"
            className={
              "drp-cell" +
              (!c.inMonth ? " out" : "") +
              (isToday ? " today" : "") +
              (isInRange ? " in-range" : "") +
              (isStart ? " start" : "") +
              (isEnd ? " end" : "")
            }
            onClick={() => onPick(c.date)}
            onMouseEnter={() => onHover(c.date)}
            onMouseLeave={() => onHover(null)}
          >
            <span>{c.d}</span>
          </button>
        );
      })}
    </div>
  );
}
