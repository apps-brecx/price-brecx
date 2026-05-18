import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { SeverityBadge } from "../components/Badges";
import "./SalesAlert.css";

interface AlertList {
  items: Alert[];
  total: number;
}

export function SalesAlert() {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["alerts", "sales"],
    queryFn: () => api.get<AlertList>(`/alerts${qs({ kind: "sales" })}`),
  });

  const items = query.data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const unacked = items.filter((a) => !a.acknowledged).length;
    return { total, unacked };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.sku ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div>
      <PageHeader
        title="Sales Alerts"
        subtitle="Velocity changes and demand signal notifications"
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
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No sales alerts"
              message="Nothing matches your search right now."
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Title</th>
                    <th>Message</th>
                    <th>Severity</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.sku ?? "—"}</td>
                      <td>{a.title}</td>
                      <td className="muted">{a.message}</td>
                      <td>
                        <SeverityBadge severity={a.severity} />
                      </td>
                      <td>{relativeTime(a.createdAt)}</td>
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
