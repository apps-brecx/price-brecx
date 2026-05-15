import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Clock, Plug } from 'lucide-react';
import { api } from '@/lib/api';
import { KpiCard } from '@/components/ui/KpiCard';
import { MarketplaceLogo } from '@/components/ui/MarketplacePill';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber, formatMoney, relativeTime } from '@/lib/utils';

type DashboardData = {
  kpis: { skuCount: number; listingCount: number; priceChanges30d: number; activeSchedules: number; openAlerts: number };
  marketplaces: { id: string; marketplace: string; status: string; displayName: string | null; skuCount: number; lastSyncAt: string | null }[];
  upcomingSchedules: { id: string; startAt: string; type: string; newPrice: string; skuCode: string; productName: string }[];
  recentAlerts: { id: string; title: string; description: string; severity: string; triggeredAt: string }[];
  recentActivity: { id: string; type: string; description: string; createdAt: string; userName: string | null }[];
};

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => api('/api/dashboard'),
  });

  if (isLoading || !data) {
    return <div className="text-ink-3 text-sm">Loading…</div>;
  }

  const { kpis, marketplaces, upcomingSchedules, recentAlerts, recentActivity } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="SKUs" value={formatNumber(kpis.skuCount)} hint="across all marketplaces" />
        <KpiCard label="Listings" value={formatNumber(kpis.listingCount)} hint="connected channels" />
        <KpiCard label="Price changes · 30d" value={formatNumber(kpis.priceChanges30d)} hint="manual + automation" />
        <KpiCard label="Active schedules" value={formatNumber(kpis.activeSchedules)} hint={`${kpis.openAlerts} open alerts`} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Connected marketplaces</h2>
          <Link to="/settings/marketplaces" className="text-[12.5px] font-medium text-brand-700">
            Manage →
          </Link>
        </div>
        {marketplaces.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Plug}
              title="No marketplaces connected"
              description="Connect Amazon, Walmart, Shopify, TikTok, eBay, Etsy or Faire to start syncing listings."
              action={
                <Link to="/settings/marketplaces" className="btn btn-primary btn-sm">
                  Connect a marketplace
                </Link>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {marketplaces.map((m) => (
              <div key={m.id} className="card card-pad">
                <div className="mb-2 flex items-center justify-between">
                  <MarketplaceLogo id={m.marketplace} />
                  <span
                    className={`chip ${m.status === 'CONNECTED' ? 'chip-success' : m.status === 'ERROR' ? 'chip-danger' : ''}`}
                  >
                    {m.status.toLowerCase()}
                  </span>
                </div>
                <div className="text-[14px] font-semibold">{m.displayName || m.marketplace}</div>
                <div className="text-[12.5px] text-ink-3">{formatNumber(m.skuCount)} listings</div>
                <div className="mt-2 text-[11.5px] text-ink-4">
                  {m.lastSyncAt ? `Synced ${relativeTime(m.lastSyncAt)}` : 'Never synced'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-ink-3" />
              <h3 className="text-[14px] font-semibold">Upcoming schedules</h3>
            </div>
            <Link to="/calendar" className="text-[12px] font-medium text-brand-700">
              View calendar →
            </Link>
          </div>
          {upcomingSchedules.length === 0 ? (
            <EmptyState icon={Clock} title="No upcoming changes" description="Create a schedule from the Calendar or SKUs page." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {upcomingSchedules.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.productName}</div>
                    <div className="mono text-ink-3">{s.skuCode}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatMoney(s.newPrice)}</div>
                    <div className="text-[11.5px] text-ink-3">{new Date(s.startAt).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-ink-3" />
              <h3 className="text-[14px] font-semibold">Open alerts</h3>
            </div>
            <Link to="/price-alert" className="text-[12px] font-medium text-brand-700">
              View all →
            </Link>
          </div>
          {recentAlerts.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No open alerts" description="You'll see price drifts, Buy Box losses, and stock issues here." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {recentAlerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
                  <span className={`severity-dot ${a.severity.toLowerCase()}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="truncate text-[12px] text-ink-3">{a.description}</div>
                  </div>
                  <div className="text-[11.5px] text-ink-3">{relativeTime(a.triggeredAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-ink-3" />
            <h3 className="text-[14px] font-semibold">Recent activity</h3>
          </div>
          <Link to="/activity-log" className="text-[12px] font-medium text-brand-700">
            View log →
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <EmptyState icon={Activity} title="No activity yet" description="Sign-ins, price changes, and rule edits will appear here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {recentActivity.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <span className="font-medium">{a.userName ?? 'System'}</span>
                  <span className="ml-2 text-ink-3">{a.description}</span>
                </div>
                <div className="text-[11.5px] text-ink-3">{relativeTime(a.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
