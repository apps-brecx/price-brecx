import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { SeverityBadge } from "../components/Badges";
import "./BuyBox.css";

interface AlertList {
  items: Alert[];
  total: number;
}

type StatusFilter = "all" | "winning" | "losing";

/** Buy-box outcome derived from severity: critical = losing the buy box, else winning. */
function statusOf(a: Alert): "winning" | "losing" {
  return a.severity === "critical" ? "losing" : "winning";
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "winning", label: "Winning" },
  { key: "losing", label: "Losing" },
];

export function BuyBox() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const query = useQuery({
    queryKey: ["alerts", "buybox"],
    queryFn: () => api.get<AlertList>("/alerts" + qs({ kind: "buybox" })),
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/alerts/${id}/ack`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts", "buybox"] });
      qc.invalidateQueries({ queryKey: ["nav-counts"] });
    },
  });

  const items = query.data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const unacked = items.filter((a) => !a.acknowledged).length;
    const critical = items.filter((a) => a.severity === "critical").length;
    const losing = items.filter((a) => statusOf(a) === "losing").length;
    const winning = total - losing;
    return { total, unacked, critical, losing, winning };
  }, [items]);

  const counts = useMemo(
    () => ({
      all: items.length,
      winning: stats.winning,
      losing: stats.losing,
    }),
    [items.length, stats.winning, stats.losing],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((a) => {
      if (status !== "all" && statusOf(a) !== status) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, status]);

  return (
    <div>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : (
        <>
          {/* Stat strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
              marginBottom: 18,
            }}
          >
            <div className="stat-card">
              <div className="stat-label">Total Alerts</div>
              <div className="stat-value">{stats.total}</div>
              <div className="stat-trend">monitoring buy box</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Winning</div>
              <div className="stat-value">{stats.winning}</div>
              <div className="stat-trend up">holding buy box</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Losing</div>
              <div className="stat-value">{stats.losing}</div>
              <div className="stat-trend down">lost to competitors</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unacknowledged</div>
              <div className="stat-value">{stats.unacked}</div>
              <div className="stat-trend">needs review</div>
            </div>
          </div>

          {/* Filters + search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            {FILTERS.map((f) => (
              <div
                key={f.key}
                className={"filter-chip" + (status === f.key ? " active" : "")}
                onClick={() => setStatus(f.key)}
              >
                {f.label} <span className="count">{counts[f.key]}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
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
                placeholder="Search buy box..."
                style={{ width: "100%" }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <EmptyState
              title="No buy box alerts"
              message="You currently hold the Buy Box. Losses will be reported here."
            />
          ) : (
            <div className="card card-table-wrap" style={{ padding: 0 }}>
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Message</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "center" }}>Severity</th>
                    <th style={{ textAlign: "right" }}>Updated</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const st = statusOf(a);
                    return (
                      <tr
                        key={a.id}
                        style={
                          a.acknowledged ? { opacity: 0.55 } : undefined
                        }
                      >
                        <td>
                          <div style={{ minWidth: 0, maxWidth: 280 }}>
                            <div className="bb-title">{a.title}</div>
                            {a.sku && (
                              <span
                                className="copy-btn"
                                style={{ marginTop: 3 }}
                              >
                                {a.sku}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="bb-msg">{a.message}</td>
                        <td style={{ textAlign: "center" }}>
                          <span
                            className={
                              "badge " +
                              (st === "losing"
                                ? "badge-danger"
                                : "badge-success")
                            }
                          >
                            <span
                              className={
                                "badge-dot " +
                                (st === "losing"
                                  ? "bb-status-losing"
                                  : "bb-status-winning")
                              }
                              style={{
                                background:
                                  st === "losing"
                                    ? "var(--danger-fg)"
                                    : "var(--success-fg)",
                              }}
                            />
                            {st === "losing" ? "Losing" : "Winning"}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <SeverityBadge severity={a.severity} />
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "var(--text-3)",
                            fontSize: 12,
                          }}
                        >
                          {relativeTime(a.createdAt)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {a.acknowledged ? (
                            <span
                              className="badge badge-neutral"
                              title="Acknowledged"
                            >
                              <span className="badge-dot dot-muted" />
                              Acked
                            </span>
                          ) : (
                            <button
                              className="btn btn-secondary btn-xs"
                              disabled={ack.isPending}
                              onClick={() => ack.mutate(a.id)}
                            >
                              Acknowledge
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
