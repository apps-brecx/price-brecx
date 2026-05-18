import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { SeverityBadge } from "../components/Badges";
import "./BuyBox.css";

interface AlertList {
  items: Alert[];
  total: number;
}

export function BuyBox() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["alerts", { kind: "buybox" }],
    queryFn: () => api.get<AlertList>(`/alerts${qs({ kind: "buybox" })}`),
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/ack`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["alerts", { kind: "buybox" }] }),
  });

  const data = query.data;
  const items = data?.items ?? [];
  const unacked = items.filter((a) => !a.acknowledged).length;

  return (
    <div>
      <PageHeader
        title="Buy Box"
        subtitle="Buy Box ownership and competitive pricing alerts"
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No Buy Box alerts"
          message="You currently hold the Buy Box. Losses will be reported here."
        />
      ) : (
        <>
          <div className="kpi-grid">
            <div className="stat-card">
              <div className="stat-label">Total Alerts</div>
              <div className="stat-value">{items.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Unacknowledged</div>
              <div className="stat-value">{unacked}</div>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Severity</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.sku ?? "—"}</td>
                    <td className="bb-title">{a.title}</td>
                    <td className="bb-msg">{a.message}</td>
                    <td>
                      <SeverityBadge severity={a.severity} />
                    </td>
                    <td className="muted">{relativeTime(a.createdAt)}</td>
                    <td className="right">
                      {a.acknowledged ? (
                        <span className="muted">✓ acked</span>
                      ) : (
                        <button
                          className="btn btn-sm btn-secondary"
                          disabled={ackMut.isPending}
                          onClick={() => ackMut.mutate(a.id)}
                        >
                          Acknowledge
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
