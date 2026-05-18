import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Alert } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { SeverityBadge } from "../components/Badges";
import "./PriceAlert.css";

interface AlertList {
  items: Alert[];
  total: number;
}

export function PriceAlert() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const query = useQuery({
    queryKey: ["alerts", { kind: "price" }],
    queryFn: () => api.get<AlertList>(`/alerts${qs({ kind: "price" })}`),
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/ack`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["alerts", { kind: "price" }] }),
  });

  const data = query.data;
  const term = filter.trim().toLowerCase();
  const items = (data?.items ?? []).filter((a) => {
    if (!term) return true;
    return (
      a.title.toLowerCase().includes(term) ||
      a.message.toLowerCase().includes(term) ||
      (a.sku ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <div>
      <PageHeader
        title="Price Alerts"
        subtitle="Pricing anomalies and threshold breaches across your catalog"
      />

      <div className="toolbar">
        <input
          className="input grow"
          placeholder="Filter by title, message, or SKU…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No price alerts"
          message="You're all caught up. New pricing alerts will appear here."
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td className="mono">{a.sku ?? "—"}</td>
                  <td className="alert-title">{a.title}</td>
                  <td className="alert-msg">{a.message}</td>
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
      )}
    </div>
  );
}
