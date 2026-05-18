import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { SeverityBadge } from "../components/Badges";
import "./PriceAlertV2.css";

interface AlertList {
  items: Alert[];
  total: number;
}

type SeverityFilter = "all" | "info" | "warning" | "critical";

export function PriceAlertV2() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const query = useQuery({
    queryKey: ["alerts", "price"],
    queryFn: () => api.get<AlertList>(`/alerts${qs({ kind: "price" })}`),
  });

  const items = query.data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const critical = items.filter((a) => a.severity === "critical").length;
    const unacked = items.filter((a) => !a.acknowledged).length;
    return { total, critical, unacked };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (severity !== "all" && a.severity !== severity) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, severity]);

  return (
    <div>
      <PageHeader
        title="Price Alerts"
        subtitle="Repricing and competitor price movement notifications"
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : (
        <>
          <div className="kpi-grid">
            <div className="stat-card">
              <div className="stat-label">Total alerts</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Critical</div>
              <div className="stat-value">{stats.critical}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unacknowledged</div>
              <div className="stat-value">{stats.unacked}</div>
            </div>
          </div>

          <div className="toolbar">
            <input
              className="input grow"
              placeholder="Search title, message, or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="select"
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as SeverityFilter)
              }
            >
              <option value="all">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No price alerts"
              message="Nothing matches your filters right now."
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>SKU</th>
                    <th>Title</th>
                    <th>Message</th>
                    <th>When</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <SeverityBadge severity={a.severity} />
                      </td>
                      <td className="mono">{a.sku ?? "—"}</td>
                      <td>{a.title}</td>
                      <td className="muted alert-message">{a.message}</td>
                      <td>{relativeTime(a.createdAt)}</td>
                      <td>
                        {a.acknowledged ? (
                          <span className="badge badge-success">Acked</span>
                        ) : (
                          <span className="badge badge-warning">Open</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
