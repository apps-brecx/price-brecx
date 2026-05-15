import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ScrollText } from 'lucide-react';
import { api, getToken, getWorkspaceId } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { relativeTime } from '@/lib/utils';

type Resp = {
  total: number;
  items: {
    id: string;
    type: string;
    description: string;
    createdAt: string;
    user?: { name: string | null; email: string } | null;
  }[];
};

export default function ActivityLog() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const pageSize = 50;
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['activity-log', page, typeFilter],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (typeFilter) p.set('type', typeFilter);
      return api(`/api/activity-log?${p.toString()}`);
    },
  });

  function exportCsv() {
    const token = getToken();
    const ws = getWorkspaceId();
    fetch('/api/activity-log/export', {
      headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': ws ?? '' },
    })
      .then((r) => r.text())
      .then((csv) => {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'activity.csv';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 120px)' }}>
      <div className="flex items-center gap-3">
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="Filter by type (e.g. price.changed)"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-ink-3">{data?.total ?? 0} entries</span>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-sm text-ink-3">Loading…</div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={ScrollText} title="No activity yet" description="Sign-ins, price changes, schedules and rule edits will appear here." />
          ) : (
            <table className="data-table">
              <thead className="sticky top-0">
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[11.5px] text-ink-3" title={r.createdAt}>
                      {relativeTime(r.createdAt)}
                    </td>
                    <td>{r.user?.name ?? r.user?.email ?? 'System'}</td>
                    <td className="mono text-[11.5px]">{r.type}</td>
                    <td>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-surface-2 px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[12px] text-ink-3">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
