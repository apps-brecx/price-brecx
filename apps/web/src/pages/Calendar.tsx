import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PriceSchedule, Paginated } from "@fbm/shared";
import { api } from "../lib/api";
import { money, dateShort } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";
import "./Calendar.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function Calendar() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () =>
      api.get<Paginated<PriceSchedule>>("/schedules"),
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const grid = buildGrid(year, month);

  const prevMonth = () => setCursor(new Date(year, month - 1, 1));
  const nextMonth = () => setCursor(new Date(year, month + 1, 1));

  const items: PriceSchedule[] = query.data?.items ?? [];

  const schedulesOn = (day: Date) =>
    items.filter(
      (s) => s.startDate && sameDay(new Date(s.startDate), day),
    );

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Scheduled price changes across the month"
        actions={
          <>
            <button className="btn btn-secondary" onClick={prevMonth}>
              ‹ Prev
            </button>
            <span className="cal-month-label">
              {MONTHS[month]} {year}
            </span>
            <button className="btn btn-secondary" onClick={nextMonth}>
              Next ›
            </button>
          </>
        }
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No scheduled price changes"
          message="Create a price schedule from the SKUs page to see it here."
        />
      ) : (
        <div className="cal-layout">
          <div className="card cal-card">
            <div className="cal-grid">
              {WEEKDAYS.map((w) => (
                <div key={w} className="cal-weekday">
                  {w}
                </div>
              ))}
              {grid.map((day, i) => (
                <div
                  key={i}
                  className={"cal-cell" + (day ? "" : " cal-cell-empty")}
                >
                  {day && (
                    <>
                      <div className="cal-daynum">{day.getDate()}</div>
                      <div className="cal-chips">
                        {schedulesOn(day).map((s) => (
                          <div
                            key={s.id}
                            className="cal-chip"
                            title={`${s.sku} · ${s.title}`}
                          >
                            <span className="mono">{s.sku}</span>{" "}
                            {money(s.price)}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card cal-side">
            <div className="card-header">
              <span className="card-title">All schedules</span>
            </div>
            <div className="card-body">
              <ul className="cal-list">
                {items.map((s) => (
                  <li key={s.id} className="cal-list-item">
                    <div className="cal-list-main">
                      <div className="cal-list-title">{s.title}</div>
                      <div className="muted mono cal-list-sku">{s.sku}</div>
                      <div className="muted cal-list-date">
                        {dateShort(s.startDate)} · {money(s.price)}
                      </div>
                    </div>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
