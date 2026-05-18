import "./Dashboard.css";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { money, num, relativeTime } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";

interface DashboardData {
  stats: {
    skuCount: number;
    activeSchedules: number;
    openAlerts: number;
    revenue30d: number;
  };
  recentSchedules: {
    id: string;
    sku: string;
    title: string;
    price: number;
    status: string;
    createdAt: string;
  }[];
  recentActivity: {
    id: string;
    actor: string;
    action: string;
    summary: string;
    createdAt: string;
  }[];
  topSkus: {
    id: string;
    sku: string;
    title: string;
    sales30d: number;
    price: number;
  }[];
}

interface MarketplacesData {
  items: {
    id: string;
    channel: string;
    label: string;
    sellerId: string | null;
    marketplaceId: string | null;
    connected: boolean;
    createdAt: string;
  }[];
  amazonMode: "live" | "stub";
}

interface AlertsData {
  items: {
    id: string;
    title: string;
    message: string;
    severity: "info" | "warning" | "critical";
    acknowledged: boolean;
    createdAt: string;
  }[];
  total: number;
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

const CHANNEL_LOGO: Record<string, { bg: string; ch: string }> = {
  amazon: { bg: "#ff9900", ch: "a" },
  walmart: { bg: "#0071ce", ch: "W" },
  shopify: { bg: "#95bf47", ch: "S" },
  tiktok: { bg: "#000000", ch: "T" },
  ebay: { bg: "#e53238", ch: "e" },
  etsy: { bg: "#f1641e", ch: "E" },
  faire: { bg: "#1a1a1a", ch: "F" },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "red",
  warning: "amber",
  info: "green",
};

function channelName(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

export function Dashboard() {
  const navigate = useNavigate();

  const dashQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
  });
  const mpQuery = useQuery({
    queryKey: ["marketplaces"],
    queryFn: () => api.get<MarketplacesData>("/marketplaces"),
  });
  const alertsQuery = useQuery({
    queryKey: ["alerts", "price"],
    queryFn: () => api.get<AlertsData>("/alerts?kind=price"),
  });

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 20,
        flexWrap: "wrap",
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
          Overview of all marketplaces and pricing activity.
        </div>
      </div>
      <div className="dash-meta">
        <span className="dash-meta-dot" />
        <span>All synced · just now</span>
      </div>
    </div>
  );

  if (dashQuery.isLoading) {
    return (
      <div>
        {header}
        <Loading />
      </div>
    );
  }

  if (dashQuery.isError || !dashQuery.data) {
    return (
      <div>
        {header}
        <ErrorState />
      </div>
    );
  }

  const { stats, recentSchedules, recentActivity } = dashQuery.data;
  const marketplaces = mpQuery.data?.items ?? [];
  const alerts = (alertsQuery.data?.items ?? []).slice(0, 5);

  return (
    <div>
      {header}

      {/* KPI Grid */}
      <div className="dash-kpi-grid">
        <div className="dash-kpi">
          <div className="dash-kpi-label">Revenue · 30d</div>
          <div className="dash-kpi-value">{money(stats.revenue30d)}</div>
          <div className="dash-kpi-foot">
            <span className="dash-chip flat">30d</span>
            <span>rolling window</span>
          </div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">SKUs</div>
          <div className="dash-kpi-value">{num(stats.skuCount)}</div>
          <div className="dash-kpi-foot">
            <span className="dash-chip flat">total</span>
            <span>across marketplaces</span>
          </div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Active schedules</div>
          <div className="dash-kpi-value">{num(stats.activeSchedules)}</div>
          <div className="dash-kpi-foot">
            <span className="dash-chip flat">live</span>
            <span>currently running</span>
          </div>
        </div>
        <div className="dash-kpi">
          <div className="dash-kpi-label">Open price alerts</div>
          <div className="dash-kpi-value">{num(stats.openAlerts)}</div>
          <div className="dash-kpi-foot">
            <span className="dash-chip flat">open</span>
            <span>unresolved</span>
          </div>
        </div>
      </div>

      {/* Connected Marketplaces */}
      <div className="dash-section-header">
        <div className="dash-section-title">Connected marketplaces</div>
        <span
          className="dash-section-link"
          onClick={() => navigate("/settings")}
        >
          Manage →
        </span>
      </div>
      {mpQuery.isLoading ? (
        <div style={{ marginBottom: 28 }}>
          <Loading />
        </div>
      ) : mpQuery.isError ? (
        <div style={{ marginBottom: 28 }}>
          <ErrorState message="Failed to load marketplaces." />
        </div>
      ) : marketplaces.length === 0 ? (
        <div className="card" style={{ marginBottom: 28 }}>
          <div className="card-body">
            <EmptyState
              title="No marketplaces connected"
              message="Connect a marketplace to start syncing."
            />
          </div>
        </div>
      ) : (
        <div className="dash-mp-grid">
          {marketplaces.map((mp) => {
            const logo = CHANNEL_LOGO[mp.channel] ?? {
              bg: "var(--text-3)",
              ch: channelName(mp.channel).charAt(0),
            };
            return (
              <div
                key={mp.id}
                className="dash-mp-card"
                onClick={() => navigate("/settings")}
              >
                <div className="dash-mp-head">
                  <div
                    className="dash-mp-logo"
                    style={{ background: logo.bg }}
                  >
                    {logo.ch}
                  </div>
                  <div className="dash-mp-status">
                    <span
                      className="dash-mp-status-dot"
                      style={
                        mp.connected
                          ? undefined
                          : { background: "var(--text-4)" }
                      }
                    />
                    {mp.connected ? "Live" : "Not connected"}
                  </div>
                </div>
                <div className="dash-mp-name">
                  {channelName(mp.channel)}
                </div>
                <div className="dash-mp-meta">{mp.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Two-col: Upcoming Schedules + Price Alerts */}
      <div className="dash-two-col">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 650 }}>
              Upcoming schedules
            </div>
            <span
              className="dash-section-link"
              onClick={() => navigate("/activity-log")}
            >
              View all →
            </span>
          </div>
          <div className="dash-schedule-list">
            {recentSchedules.length === 0 ? (
              <div style={{ padding: "8px 0" }}>
                <EmptyState
                  title="No schedules"
                  message="Scheduled price changes will appear here."
                />
              </div>
            ) : (
              recentSchedules.map((s) => (
                <div
                  key={s.id}
                  className="dash-schedule"
                  onClick={() => navigate("/activity-log")}
                >
                  <div
                    className="dash-sched-icon"
                    style={{
                      background: "var(--info-bg)",
                      color: "var(--info-fg)",
                    }}
                  >
                    {s.sku.charAt(0).toUpperCase()}
                  </div>
                  <div className="dash-sched-body">
                    <div className="dash-sched-name">{s.title}</div>
                    <div className="dash-sched-detail">
                      {s.sku} · {relativeTime(s.createdAt)}
                    </div>
                  </div>
                  <div className="dash-sched-price">{money(s.price)}</div>
                  <StatusBadge status={s.status} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 650 }}>
              Recent price alerts
            </div>
            <span
              className="dash-section-link"
              onClick={() => navigate("/price-alert")}
            >
              View all →
            </span>
          </div>
          <div className="dash-alert-list">
            {alertsQuery.isLoading ? (
              <div style={{ padding: "8px 0" }}>
                <Loading />
              </div>
            ) : alertsQuery.isError ? (
              <div style={{ padding: "8px 0" }}>
                <ErrorState message="Failed to load alerts." />
              </div>
            ) : alerts.length === 0 ? (
              <div style={{ padding: "8px 0" }}>
                <EmptyState
                  title="No price alerts"
                  message="Price alerts will appear here."
                />
              </div>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="dash-alert">
                  <div
                    className={`dash-alert-dot ${
                      SEVERITY_DOT[a.severity] ?? "green"
                    }`}
                  />
                  <div className="dash-alert-body">
                    <div className="dash-alert-title">{a.title}</div>
                    <div className="dash-alert-desc">{a.message}</div>
                    <div className="dash-alert-time">
                      {relativeTime(a.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="dash-section-header">
        <div className="dash-section-title">Recent activity</div>
        <span
          className="dash-section-link"
          onClick={() => navigate("/activity-log")}
        >
          View full log →
        </span>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {recentActivity.length === 0 ? (
          <div className="card-body">
            <EmptyState
              title="No recent activity"
              message="Workspace activity will appear here."
            />
          </div>
        ) : (
          <table className="dash-activity-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Time</th>
                <th>Activity</th>
                <th style={{ width: 160 }}>Actor</th>
                <th style={{ width: 150 }}>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((a) => (
                <tr key={a.id}>
                  <td style={{ color: "var(--text-3)", fontSize: 12 }}>
                    {relativeTime(a.createdAt)}
                  </td>
                  <td style={{ fontWeight: 550 }}>{a.summary}</td>
                  <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {a.actor || "—"}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {a.action || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
