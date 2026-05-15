import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

type Rule = {
  id: string;
  name: string;
  category: 'STOCK_ALERT' | 'BACK_IN_STOCK' | 'WALMART_STOCK' | 'PRICE_ALERT' | 'SALES_ALERT';
  active: boolean;
  time: string;
  emails: string[];
  channels: { email?: boolean; slack?: boolean; sms?: boolean; webhook?: boolean };
  lastSentAt?: string | null;
};

const CATEGORIES: Rule['category'][] = ['STOCK_ALERT', 'BACK_IN_STOCK', 'WALMART_STOCK', 'PRICE_ALERT', 'SALES_ALERT'];

export default function NotificationSettings() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | Rule['category']>('ALL');
  const [openCreate, setOpenCreate] = useState(false);

  const { data, isLoading } = useQuery<Rule[]>({
    queryKey: ['notif-rules', filter],
    queryFn: () => api(`/api/notification-rules${filter === 'ALL' ? '' : '?category=' + filter}`),
  });

  const test = useMutation({
    mutationFn: (id: string) => api(`/api/notification-rules/${id}/test`, { method: 'POST' }),
    onSuccess: () => toast.success('Test sent'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/notification-rules/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-rules'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/notification-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-rules'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Notifications</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenCreate(true)}>
          <Plus size={14} /> New rule
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={cn('filter-chip', filter === 'ALL' && 'active')} onClick={() => setFilter('ALL')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} className={cn('filter-chip', filter === c && 'active')} onClick={() => setFilter(c)}>
            {c.replace(/_/g, ' ').toLowerCase()}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={Bell} title="No notification rules" description="Configure when and how the team gets notified about stock, prices, and sales." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Recipients</th>
                <th>Channels</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td><span className="chip">{r.category.replace(/_/g, ' ').toLowerCase()}</span></td>
                  <td>{r.emails.length ? r.emails.join(', ') : <span className="text-ink-4">none</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      {Object.entries(r.channels).filter(([, v]) => v).map(([k]) => <span key={k} className="chip">{k}</span>)}
                    </div>
                  </td>
                  <td>
                    <label className="inline-flex cursor-pointer items-center">
                      <input type="checkbox" checked={r.active} onChange={(e) => toggle.mutate({ id: r.id, active: e.target.checked })} />
                    </label>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-icon btn-sm" title="Send test" onClick={() => test.mutate(r.id)}>
                        <Send size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm text-danger-fg" onClick={() => {
                        if (confirm(`Delete "${r.name}"?`)) del.mutate(r.id);
                      }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openCreate && <CreateRule onClose={() => setOpenCreate(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['notif-rules'] })} />}
    </div>
  );
}

function CreateRule({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    category: 'PRICE_ALERT' as Rule['category'],
    time: '09:00',
    emails: '',
    channels: { email: true, slack: false, sms: false, webhook: false },
  });
  const m = useMutation({
    mutationFn: () =>
      api('/api/notification-rules', {
        method: 'POST',
        json: {
          name: form.name,
          category: form.category,
          time: form.time,
          emails: form.emails.split(',').map((s) => s.trim()).filter(Boolean),
          channels: form.channels,
        },
      }),
    onSuccess: () => {
      toast.success('Rule created');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="New notification rule" maxWidth={520} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!form.name || m.isPending} onClick={() => m.mutate()}>
          Create
        </button>
      </>
    }>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as any })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Send time</label>
            <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Recipients (comma-separated emails)</label>
          <input className="input" value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} placeholder="ops@brecx.com, alerts@brecx.com" />
        </div>
        <div>
          <label className="label">Channels</label>
          <div className="flex gap-3">
            {(['email', 'slack', 'sms', 'webhook'] as const).map((c) => (
              <label key={c} className="inline-flex items-center gap-1.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={form.channels[c]}
                  onChange={(e) => setForm({ ...form, channels: { ...form.channels, [c]: e.target.checked } })}
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
