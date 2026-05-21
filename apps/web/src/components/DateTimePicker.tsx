import { useEffect, useMemo, useRef, useState } from "react";
import "./DateRangePicker.css";
import "./DateTimePicker.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function fromDatetimeLocal(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * Ant-Design-style single date + time picker.
 *
 *  - Trigger shows `YYYY-MM-DD hh:mm AM` (matches the legacy spreadsheet
 *    look but with explicit AM/PM rather than 24h, which was the legacy app's
 *    convention).
 *  - Popover: month grid on the left, vertically-scrollable hour & minute &
 *    AM/PM columns on the right (the Ant `<DatePicker showTime>` layout).
 *  - Date is committed when the user clicks an OK in the footer, so they can
 *    tweak time without the popover closing on first calendar click. "Now"
 *    sets the value to the current moment.
 *
 * The on-the-wire format is HTML5 `datetime-local` (`YYYY-MM-DDTHH:MM`) — the
 * same string `<input type="datetime-local">` produces, so this is a 1:1
 * drop-in replacement for that input.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "dd-mm-yyyy hh:mm",
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Draft = the value the user is currently editing inside the popover.
  // Only committed to parent on OK / Now.
  const parsed = useMemo(() => fromDatetimeLocal(value ?? undefined), [value]);
  const [draft, setDraft] = useState<Date | null>(parsed);
  const [viewMonth, setViewMonth] = useState<Date>(() => parsed ?? new Date());

  useEffect(() => {
    setDraft(parsed);
    if (parsed) setViewMonth(parsed);
  }, [parsed]);

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
    // Keep the current time component when changing day.
    const cur = draft ?? new Date();
    const next = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      cur.getHours(),
      cur.getMinutes(),
    );
    setDraft(next);
  }
  function setHour12(h: number, pm: boolean) {
    const cur = draft ?? new Date();
    const h24 = pm ? (h % 12) + 12 : h % 12;
    const next = new Date(cur);
    next.setHours(h24, cur.getMinutes(), 0, 0);
    setDraft(next);
  }
  function setMinute(m: number) {
    const cur = draft ?? new Date();
    const next = new Date(cur);
    next.setMinutes(m, 0, 0);
    setDraft(next);
  }
  function setAmPm(pm: boolean) {
    const cur = draft ?? new Date();
    const h = cur.getHours();
    const inAm = h < 12;
    if (pm && inAm) {
      const next = new Date(cur);
      next.setHours(h + 12);
      setDraft(next);
    } else if (!pm && !inAm) {
      const next = new Date(cur);
      next.setHours(h - 12);
      setDraft(next);
    }
  }
  function commit() {
    if (draft) {
      onChange(toDatetimeLocal(draft));
    }
    setOpen(false);
  }
  function setNow() {
    const now = new Date();
    setDraft(now);
    setViewMonth(now);
    onChange(toDatetimeLocal(now));
    setOpen(false);
  }
  function clear() {
    setDraft(null);
    onChange("");
    setOpen(false);
  }

  const display = parsed
    ? `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())} ${pad2(((parsed.getHours() % 12) || 12))}:${pad2(parsed.getMinutes())} ${parsed.getHours() < 12 ? "AM" : "PM"}`
    : placeholder;

  const hasValue = !!parsed;

  // Time-column state derived from draft (or fallback to current time when
  // the popover is opened without a value).
  const eff = draft ?? new Date();
  const effHour12 = eff.getHours() % 12 || 12;
  const effMinute = eff.getMinutes();
  const effIsPm = eff.getHours() >= 12;

  return (
    <div className={"drp-wrap dtp-wrap" + (className ? " " + className : "")} ref={wrapRef}>
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
        <span
          className={"drp-trigger-value dtp-single" + (hasValue ? "" : " placeholder")}
        >
          {display}
        </span>
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
          <line x1="9" y1="14" x2="11" y2="14" />
          <line x1="13" y1="14" x2="15" y2="14" />
          <line x1="9" y1="18" x2="11" y2="18" />
        </svg>
        {hasValue && (
          <button
            type="button"
            className="drp-clear-btn"
            aria-label="Clear date"
            onMouseDown={(e) => {
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
        <div className="drp-popover dtp-popover">
          <div className="dtp-cal">
            <div className="drp-pane-head dtp-head">
              <button
                type="button"
                className="drp-nav"
                onClick={() => setViewMonth(addMonths(viewMonth, -12))}
                title="Previous year"
              >
                «
              </button>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                title="Previous month"
              >
                ‹
              </button>
              <div className="drp-pane-title">
                {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </div>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                title="Next month"
              >
                ›
              </button>
              <button
                type="button"
                className="drp-nav"
                onClick={() => setViewMonth(addMonths(viewMonth, 12))}
                title="Next year"
              >
                »
              </button>
            </div>
            <MonthGrid
              month={viewMonth}
              selected={draft}
              onPick={pickDate}
            />
          </div>

          <div className="dtp-time">
            <div className="dtp-time-head">Time</div>
            <div className="dtp-time-cols">
              <Scroller
                items={HOURS_12.map((h) => pad2(h))}
                value={pad2(effHour12)}
                onSelect={(v) => setHour12(Number(v), effIsPm)}
              />
              <div className="dtp-time-sep">:</div>
              <Scroller
                items={MINUTES.map((m) => pad2(m))}
                value={pad2(effMinute)}
                onSelect={(v) => setMinute(Number(v))}
              />
              <div className="dtp-ampm">
                <button
                  type="button"
                  className={"dtp-ampm-btn" + (!effIsPm ? " active" : "")}
                  onClick={() => setAmPm(false)}
                >
                  AM
                </button>
                <button
                  type="button"
                  className={"dtp-ampm-btn" + (effIsPm ? " active" : "")}
                  onClick={() => setAmPm(true)}
                >
                  PM
                </button>
              </div>
            </div>
          </div>

          <div className="dtp-footer">
            <button type="button" className="dtp-link" onClick={setNow}>
              Now
            </button>
            <div style={{ flex: 1 }} />
            <button type="button" className="dtp-cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="dtp-ok"
              onClick={commit}
              disabled={!draft}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  month,
  selected,
  onPick,
}: {
  month: Date;
  selected: Date | null;
  onPick: (d: Date) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const prevMonthLast = new Date(year, m, 0).getDate();
  const today = startOfDay(new Date());

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
        const isSelected = selected && sameDay(c.date, selected);
        return (
          <button
            key={i}
            type="button"
            className={
              "drp-cell" +
              (!c.inMonth ? " out" : "") +
              (isToday ? " today" : "") +
              (isSelected ? " start end" : "")
            }
            onClick={() => onPick(c.date)}
          >
            <span>{c.d}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Vertical scroll list used for hour + minute pickers. The selected row
 *  is centered by scrolling the container so the user always sees a few
 *  adjacent values for context (matches Ant Design's TimePicker). */
function Scroller({
  items,
  value,
  onSelect,
}: {
  items: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const el = root.querySelector<HTMLButtonElement>(
      `[data-v="${value}"]`,
    );
    if (el) {
      // Scroll the selected row to the top so it sits in the visible band.
      root.scrollTop = el.offsetTop - 4;
    }
  }, [value]);
  return (
    <div className="dtp-scroller" ref={ref}>
      {items.map((it) => (
        <button
          key={it}
          type="button"
          data-v={it}
          className={"dtp-scroll-item" + (it === value ? " active" : "")}
          onClick={() => onSelect(it)}
        >
          {it}
        </button>
      ))}
    </div>
  );
}
