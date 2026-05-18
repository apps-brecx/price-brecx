import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money, num, relativeTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/Badges";
import "./Dashboard.css";

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

export function Dashboard() {
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
  });

  if (query.isLoading) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          subtitle="Your pricing operation at a glance"
        />
        <Loading />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          subtitle="Your pricing operation at a glance"
        />
        <ErrorState />
      </div>
    );
  }

  const { stats, recentSchedules, recentActivity, topSkus } = query.data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your pricing operation at a glance"
      />

      <div className="kpi-grid">
        <div className="stat-card">
          <div className="stat-label">SKUs</div>
          <div className="stat-value">{num(stats.skuCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Schedules</div>
          <div className="stat-value">{num(stats.activeSchedules)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Alerts</div>
          <div className="stat-value">{num(stats.openAlerts)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">30d Revenue</div>
          <div className="stat-value">{money(stats.revenue30d)}</div>
        </div>
      </div>

      <div className="dash-cols">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent schedules</span>
          </div>
          <div className="card-body">
            {recentSchedules.length === 0 ? (
              <EmptyState
                title="No recent schedules"
                message="Scheduled price changes will appear here."
              />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Title</th>
                      <th className="right">Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSchedules.map((s) => (
                      <tr key={s.id}>
                        <td className="mono">{s.sku}</td>
                        <td className="dash-title">{s.title}</td>
                        <td className="right strong">{money(s.price)}</td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent activity</span>
          </div>
          <div className="card-body">
            {recentActivity.length === 0 ? (
              <EmptyState
                title="No recent activity"
                message="Workspace activity will appear here."
              />
            ) : (
              <ul className="activity-list">
                {recentActivity.map((a) => (
                  <li key={a.id} className="activity-item">
                    <div className="activity-main">
                      <span className="activity-actor">{a.actor}</span>{" "}
                      <span className="muted">{a.action}</span>
                      <div className="activity-summary">{a.summary}</div>
                    </div>
                    <span className="muted activity-time">
                      {relativeTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Top SKUs by 30d sales</span>
        </div>
        <div className="card-body">
          {topSkus.length === 0 ? (
            <EmptyState
              title="No sales data"
              message="Top performing SKUs will appear here."
            />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Title</th>
                    <th className="right">30d Sales</th>
                    <th className="right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {topSkus.map((s) => (
                    <tr key={s.id}>
                      <td className="mono">{s.sku}</td>
                      <td className="dash-title">{s.title}</td>
                      <td className="right">{num(s.sales30d)}</td>
                      <td className="right strong">{money(s.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
