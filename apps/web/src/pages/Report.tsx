import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReportRow } from "@fbm/shared";
import { api } from "../lib/api";
import { money, num } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import "./Report.css";

interface SalesReport {
  items: ReportRow[];
  totals: { units: number; revenue: number };
}

function delta(revenue: number, prevRevenue: number) {
  if (prevRevenue > 0) {
    const pct = ((revenue - prevRevenue) / prevRevenue) * 100;
    return {
      text: `${pct.toFixed(1)}%`,
      cls: pct >= 0 ? "badge-success" : "badge-danger",
    };
  }
  return { text: "—", cls: "badge-neutral" };
}

export function Report() {
  const query = useQuery({
    queryKey: ["reports", "sales"],
    queryFn: () => api.get<SalesReport>("/reports/sales"),
  });

  const data = query.data;

  const sorted = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.revenue - a.revenue),
    [data],
  );

  return (
    <div>
      <PageHeader
        title="Sales Report"
        subtitle="Revenue and unit performance vs the previous period"
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data ? (
        <ErrorState />
      ) : (
        <>
          <div className="kpi-grid">
            <div className="stat-card">
              <div className="stat-label">Total units</div>
              <div className="stat-value">{num(data.totals.units)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total revenue</div>
              <div className="stat-value">{money(data.totals.revenue)}</div>
            </div>
          </div>

          {sorted.length === 0 ? (
            <EmptyState
              title="No report data"
              message="There is no sales activity for this period yet."
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="right">Units</th>
                    <th className="right">Revenue</th>
                    <th className="right">Prev units</th>
                    <th className="right">Prev revenue</th>
                    <th className="right">Δ Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const d = delta(r.revenue, r.prevRevenue);
                    return (
                      <tr key={r.skuId}>
                        <td>
                          <div className="report-title">{r.title}</div>
                          <div className="report-sku mono">{r.sku}</div>
                        </td>
                        <td className="right">{num(r.units)}</td>
                        <td className="right">{money(r.revenue)}</td>
                        <td className="right">{num(r.prevUnits)}</td>
                        <td className="right">{money(r.prevRevenue)}</td>
                        <td className="right">
                          <span className={`badge ${d.cls}`}>{d.text}</span>
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
