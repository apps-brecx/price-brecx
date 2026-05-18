import { useQuery } from "@tanstack/react-query";
import { CHANNEL_LABELS } from "@fbm/shared";
import type { SalesChannel } from "@fbm/shared";
import { api } from "../lib/api";
import { money, num } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import "./Inventory.css";

interface InventoryRow {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  channel: string;
  stock: number;
  sales30d: number;
  price: number;
  status: string;
}

interface InventoryData {
  items: InventoryRow[];
  agg: {
    totalUnits: number;
    outOfStock: number;
    lowStock: number;
  };
}

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel as SalesChannel] ?? channel;
}

export function Inventory() {
  const query = useQuery({
    queryKey: ["inventory"],
    queryFn: () => api.get<InventoryData>("/inventory"),
  });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels across all connected channels"
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <>
          <div className="kpi-grid">
            <div className="stat-card">
              <div className="stat-label">Total units</div>
              <div className="stat-value">
                {num(query.data.agg.totalUnits)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Out of stock</div>
              <div className="stat-value">
                {num(query.data.agg.outOfStock)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Low stock</div>
              <div className="stat-value">
                {num(query.data.agg.lowStock)}
              </div>
            </div>
          </div>

          {query.data.items.length === 0 ? (
            <EmptyState
              title="No inventory"
              message="Connect a marketplace to sync stock levels."
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th></th>
                    <th>Product</th>
                    <th>Channel</th>
                    <th className="right">Stock</th>
                    <th className="right">30d Sales</th>
                    <th className="right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((r) => (
                    <tr key={r.skuId}>
                      <td>
                        {r.imageUrl ? (
                          <img
                            className="product-img"
                            src={r.imageUrl}
                            alt=""
                          />
                        ) : (
                          <div className="product-img" />
                        )}
                      </td>
                      <td>
                        <div className="inv-title">{r.title}</div>
                        <div className="inv-sku mono muted">
                          {r.asin ? `${r.asin} · ` : ""}
                          {r.sku}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-neutral">
                          {channelLabel(r.channel)}
                        </span>
                      </td>
                      <td className="right">
                        {num(r.stock)}
                        {r.stock === 0 ? (
                          <span className="badge badge-danger inv-stock-tag">
                            Out
                          </span>
                        ) : r.stock < 10 ? (
                          <span className="badge badge-warning inv-stock-tag">
                            Low
                          </span>
                        ) : null}
                      </td>
                      <td className="right">{num(r.sales30d)}</td>
                      <td className="right strong">{money(r.price)}</td>
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
