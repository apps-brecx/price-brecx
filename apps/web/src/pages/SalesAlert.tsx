import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";

interface AlertList {
  items: Alert[];
  total: number;
}

type SeverityFilter = "all" | "critical" | "warning" | "info";

const DOT_CLASS: Record<Alert["severity"], string> = {
  critical: "red",
  warning: "amber",
  info: "blue",
};

const FILTERS: { key: SeverityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
];

export function SalesAlert() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const query = useQuery({
    queryKey: ["alerts", "sales"],
    queryFn: () => api.get<AlertList>("/alerts" + qs({ kind: "sales" })),
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/alerts/${id}/ack`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts", "sales"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const items = query.data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const unacked = items.filter((a) => !a.acknowledged).length;
    return { total, unacked };
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
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Get notified when sales velocity, conversion, or revenue drifts from
            expected.
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : (
        <>
          {/* KPI cards */}
          <div className="dash-kpi-grid">
            <div className="dash-kpi">
              <div className="dash-kpi-label">Total alerts</div>
              <div className="dash-kpi-value">{stats.total}</div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>monitoring 24/7</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Unacknowledged</div>
              <div className="dash-kpi-value">{stats.unacked}</div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>needs review</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Critical</div>
              <div className="dash-kpi-value">
                {items.filter((a) => a.severity === "critical").length}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>high priority</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Acknowledged</div>
              <div className="dash-kpi-value">
                {stats.total - stats.unacked}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>handled</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              className="input-wrap"
              style={{ flex: 1, maxWidth: 380 }}
            >
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
                placeholder="Search alerts..."
                style={{ width: "100%" }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {FILTERS.map((f) => (
              <div
                key={f.key}
                className={
                  "filter-chip" + (severity === f.key ? " active" : "")
                }
                onClick={() => setSeverity(f.key)}
              >
                {f.label}
              </div>
            ))}
          </div>

          {/* Alerts list */}
          {filtered.length === 0 ? (
            <EmptyState
              title="No sales alerts"
              message="Nothing matches your search right now."
            />
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="sa-list">
                {filtered.map((a) => (
                  <div
                    key={a.id}
                    className="sa-alert"
                    style={a.acknowledged ? { opacity: 0.6 } : undefined}
                  >
                    <div
                      className={"sa-alert-dot " + DOT_CLASS[a.severity]}
                    />
                    <div className="sa-alert-body">
                      <div className="sa-alert-title">{a.title}</div>
                      <div className="sa-alert-desc">{a.message}</div>
                      <div className="sa-alert-meta">
                        <span className="sa-alert-time">
                          {relativeTime(a.createdAt)}
                        </span>
                        <div className="sa-alert-tags">
                          {a.sku && (
                            <span className="sa-alert-tag">{a.sku}</span>
                          )}
                          <span className="sa-alert-tag">
                            {a.severity}
                          </span>
                          {a.acknowledged && (
                            <span className="sa-alert-tag">Acked</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {!a.acknowledged && (
                      <div className="sa-alert-actions">
                        <div
                          className="sa-alert-action-btn"
                          title="Mark acknowledged"
                          onClick={() => ack.mutate(a.id)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
