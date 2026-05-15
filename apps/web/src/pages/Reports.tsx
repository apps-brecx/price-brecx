import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, formatNumber, marketplaceMeta } from '@/lib/utils';

type Sales = { from: string; to: string; total: number; series: { date: string; changes: number; failures: number; deltaSum: number }[] };
type ByMonth = { month: string; total: number; success: number; failed: number }[];
type ByMarketplace = { id: string; marketplace: string; displayName: string | null; listings: number; priceChanges: number }[];

const RANGES: { id: string; label: string; days: number }[] = [
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: 'mtd', label: 'MTD', days: 0 },
  { id: 'ytd', label: 'YTD', days: 0 },
];

function rangeToDates(id: string): { from: string; to: string } {
  const to = new Date();
  let from: Date;
  if (id === 'mtd') from = new Date(to.getFullYear(), to.getMonth(), 1);
  else if (id === 'ytd') from = new Date(to.getFullYear(), 0, 1);
  else {
    const days = RANGES.find((r) => r.id === id)?.days ?? 30;
    from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function Reports() {
  const [range, setRange] = useState('30d');
  const dr = rangeToDates(range);

  const sales = useQuery<Sales>({
    queryKey: ['report', 'sales', dr.from, dr.to],
    queryFn: () => api(`/api/reports/sales?from=${dr.from}&to=${dr.to}`),
  });
  const byMonth = useQuery<ByMonth>({ queryKey: ['report', 'by-month'], queryFn: () => api('/api/reports/by-month') });
  const byMp = useQuery<ByMarketplace>({ queryKey: ['report', 'by-marketplace'], queryFn: () => api('/api/reports/by-marketplace') });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.id} className={cn('filter-chip', range === r.id && 'active')} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-[14px] font-semibold">Price changes over time</h3>
          <div className="text-[12px] text-ink-3">Total {formatNumber(sales.data?.total ?? 0)} changes</div>
        </div>
        <div className="p-4" style={{ height: 280 }}>
          {sales.isLoading ? (
            <div className="text-sm text-ink-3">Loading…</div>
          ) : (sales.data?.series.length ?? 0) === 0 ? (
            <EmptyState icon={FileText} title="No data in this range" description="Price changes will show up here once they happen." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sales.data!.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--text-3)" fontSize={11} />
                <YAxis stroke="var(--text-3)" fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="changes" stroke="var(--brand-600)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failures" stroke="var(--danger-fg)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <h3 className="text-[14px] font-semibold">Monthly volume</h3>
          </div>
          <div className="p-4" style={{ height: 260 }}>
            {(byMonth.data?.length ?? 0) === 0 ? (
              <EmptyState icon={FileText} title="No monthly data yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" stroke="var(--text-3)" fontSize={11} />
                  <YAxis stroke="var(--text-3)" fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="success" stackId="a" fill="var(--brand-600)" />
                  <Bar dataKey="failed" stackId="a" fill="var(--danger-fg)" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="card">
          <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <h3 className="text-[14px] font-semibold">By marketplace</h3>
          </div>
          <div className="p-4" style={{ height: 260 }}>
            {(byMp.data?.length ?? 0) === 0 ? (
              <EmptyState icon={FileText} title="No marketplace data yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byMp.data!} dataKey="priceChanges" nameKey="marketplace" outerRadius={90}>
                    {byMp.data!.map((m) => (
                      <Cell key={m.id} fill={marketplaceMeta(m.marketplace).color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
