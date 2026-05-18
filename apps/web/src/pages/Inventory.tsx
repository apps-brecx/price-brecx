import "./Inventory.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money, num } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";

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

const CHANNEL_LABELS: Record<string, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  shopify: "Shopify",
  tiktok: "TikTok",
  ebay: "eBay",
  etsy: "Etsy",
  faire: "Faire",
};

const CHANNEL_DOTS: Record<string, string> = {
  amazon: "#ff9900",
  walmart: "#0071dc",
  shopify: "#96bf48",
  tiktok: "#ff0050",
  ebay: "#e53238",
  etsy: "#f1641e",
  faire: "#000000",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function channelDot(channel: string): string {
  return CHANNEL_DOTS[channel] ?? "var(--text-3)";
}

/** Stock level → status text + css modifier suffix used by inv-mp-* / inv-progress. */
function stockLevel(stock: number): {
  label: string;
  cls: "" | "low" | "out";
} {
  if (stock <= 0) return { label: "Out of stock", cls: "out" };
  if (stock < 10) return { label: "Low stock", cls: "low" };
  return { label: "In stock", cls: "" };
}

/** Sensible cap so the progress bar conveys relative depth of stock. */
const STOCK_CAP = 200;

export function Inventory() {
  const query = useQuery({
    queryKey: ["inventory"],
    queryFn: () => api.get<InventoryData>("/inventory"),
  });

  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
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
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginBottom: 4,
            }}
          >
            Inventory
          </h1>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Stock levels across all connected marketplaces
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError || !query.data ? (
        <ErrorState />
      ) : (
        <>
          <div className="dash-kpi-grid">
            <div className="dash-kpi">
              <div className="dash-kpi-label">Total units</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.totalUnits)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip flat">→</span>
                <span>across all marketplaces</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Out of stock</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.outOfStock)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip down">SKUs</span>
                <span>blocking sales</span>
              </div>
            </div>
            <div className="dash-kpi">
              <div className="dash-kpi-label">Low stock</div>
              <div className="dash-kpi-value">
                {num(query.data.agg.lowStock)}
              </div>
              <div className="dash-kpi-foot">
                <span className="dash-chip down">Below 10</span>
                <span>needs attention</span>
              </div>
            </div>
          </div>

          {query.data.items.length === 0 ? (
            <EmptyState
              title="No inventory"
              message="Connect a marketplace to sync stock levels."
            />
          ) : (
            <div className="inv-product-list">
              {query.data.items.map((r) => {
                const isOpen = open.has(r.skuId);
                const level = stockLevel(r.stock);
                const fillPct = Math.min(
                  100,
                  Math.round((r.stock / STOCK_CAP) * 100),
                );
                return (
                  <div
                    key={r.skuId}
                    className={`inv-product-card${isOpen ? " open" : ""}`}
                  >
                    <div
                      className="inv-product-head"
                      onClick={() => toggle(r.skuId)}
                    >
                      <div className="inv-product-info">
                        <div className="inv-product-name">{r.title}</div>
                        <div className="inv-product-sku">
                          {r.asin ? `${r.asin} · ` : ""}
                          {r.sku}
                        </div>
                      </div>
                      <div className="inv-product-right">
                        <div className="inv-total-stock">
                          <div className="inv-total-stock-label">
                            Total stock
                          </div>
                          <div className="inv-total-stock-value">
                            {num(r.stock)}
                          </div>
                        </div>
                        <svg
                          className="inv-chevron"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>
                    <div className="inv-product-body">
                      <div className="inv-section-label">
                        Stock by marketplace
                      </div>
                      <div className="inv-mp-grid">
                        <div className="inv-mp-card">
                          <div className="inv-mp-head">
                            <div className="inv-mp-name">
                              <span
                                className="inv-mp-dot"
                                style={{
                                  background: channelDot(r.channel),
                                }}
                              />
                              {channelLabel(r.channel)}
                            </div>
                            <div className={`inv-mp-status ${level.cls}`}>
                              {level.label}
                            </div>
                          </div>
                          <div className="inv-mp-sku">{r.sku}</div>
                          <div className="inv-mp-row">
                            <span>Stock</span>
                            <span>{num(r.stock)} units</span>
                          </div>
                          <div className="inv-mp-row">
                            <span>30d sales</span>
                            <span>{num(r.sales30d)}</span>
                          </div>
                          <div className="inv-mp-row">
                            <span>Price</span>
                            <span>{money(r.price)}</span>
                          </div>
                          <div className="inv-progress">
                            <div
                              className={`inv-progress-fill ${level.cls}`}
                              style={{ width: `${fillPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
