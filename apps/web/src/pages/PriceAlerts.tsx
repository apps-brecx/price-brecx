import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, relativeTime } from '@/lib/utils';

type Alert = {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'RESOLVED';
  status: 'OPEN' | 'SNOOZED' | 'RESOLVED' | 'DISMISSED';
  title: string;
  description: string;
  triggeredAt: string;
  metadata?: any;
};

export default function PriceAlerts() {
  return <AlertsView title="Price alerts" endpoint="/api/alerts/price" />;
}

export function AlertsView({ title, endpoint }: { title: string; endpoint: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'SNOOZED' | 'RESOLVED' | 'DISMISSED'>('OPEN');
  const { data, isLoading } = useQuery<Alert[]>({
    queryKey: [endpoint, filter],
    queryFn: () => api(`${endpoint}${filter === 'ALL' ? '' : '?status=' + filter}`),
  });

  const action = useMutation({
    mutationFn: ({ id, action, payload }: { id: string; action: string; payload?: any }) =>
      api(`/api/alerts/${id}/${action}`, { method: 'PATCH', json: payload ?? {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [endpoint] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'OPEN', 'SNOOZED', 'RESOLVED', 'DISMISSED'] as const).map((s) => (
          <button key={s} className={cn('filter-chip', filter === s && 'active')} onClick={() => setFilter(s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={BellRing} title={`No ${title.toLowerCase()}`} description="Alerts will appear when conditions you configure are triggered." />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`severity-dot ${a.severity.toLowerCase()}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[13.5px] font-semibold">{a.title}</div>
                    <span className="chip">{a.type.replace(/_/g, ' ').toLowerCase()}</span>
                    <span
                      className={cn(
                        'chip',
                        a.status === 'OPEN' && 'chip-danger',
                        a.status === 'RESOLVED' && 'chip-success',
                        a.status === 'SNOOZED' && 'chip-warning',
                      )}
                    >
                      {a.status.toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-3">{a.description}</div>
                  <div className="mt-1 text-[11.5px] text-ink-4">{relativeTime(a.triggeredAt)}</div>
                </div>
                {a.status === 'OPEN' && (
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-sm" onClick={() => action.mutate({ id: a.id, action: 'snooze', payload: { minutes: 60 } })}>
                      Snooze 1h
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => action.mutate({ id: a.id, action: 'resolve' })}>
                      Resolve
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => action.mutate({ id: a.id, action: 'dismiss' })}>
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
