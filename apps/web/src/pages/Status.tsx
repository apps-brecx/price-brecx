import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PriceSchedule } from "@fbm/shared";
import { SCHEDULE_STATUSES } from "@fbm/shared";
import { api } from "../lib/api";
import { money, date } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";
import "./Status.css";

interface ScheduleList {
  items: PriceSchedule[];
  total: number;
}

const STATUS_OPTIONS = ["all", ...SCHEDULE_STATUSES] as const;

export function Status() {
  const [filter, setFilter] = useState<string>("all");

  const query = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.get<ScheduleList>("/schedules"),
  });

  const data = query.data;
  const items = data?.items ?? [];

  const counts = {
    scheduled: items.filter((s) => s.status === "scheduled").length,
    running: items.filter((s) => s.status === "running").length,
    completed: items.filter((s) => s.status === "completed").length,
    inactive: items.filter(
      (s) =>
        s.status === "reverted" ||
        s.status === "cancelled" ||
        s.status === "failed",
    ).length,
  };

  const filtered =
    filter === "all" ? items : items.filter((s) => s.status === filter);

  return (
    <div>
      <PageHeader
        title="Status"
        subtitle="Live state of every price schedule"
      />

      <div className="kpi-grid">
        <div className="stat-card">
          <div className="stat-label">Scheduled</div>
          <div className="stat-value">{counts.scheduled}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Running</div>
          <div className="stat-value">{counts.running}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{counts.completed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inactive</div>
          <div className="stat-value">{counts.inactive}</div>
        </div>
      </div>

      <div className="toolbar">
        <select
          className="select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No schedules"
          message="No price schedules match the current filter."
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th className="right">Current</th>
                <th className="right">Target</th>
                <th>Start</th>
                <th>End</th>
                <th>Created by</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.sku}</td>
                  <td>{s.title}</td>
                  <td>
                    <span className="badge badge-neutral">{s.type}</span>
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="right">{money(s.currentPrice)}</td>
                  <td className="right">{money(s.price)}</td>
                  <td>{date(s.startDate)}</td>
                  <td>{date(s.endDate)}</td>
                  <td className="muted">{s.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
