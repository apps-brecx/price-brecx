import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Webhook as WebhookIcon, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';

type Webhook = { id: string; url: string; events: string[]; active: boolean; secret: string; createdAt: string };

const EVENTS = [
  'price.changed',
  'schedule.executed',
  'schedule.cancelled',
  'alert.triggered',
  'alert.resolved',
  'automation.run',
  'marketplace.connected',
  'sku.created',
];

export default function WebhookSettings() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const { data, isLoading } = useQuery<Webhook[]>({ queryKey: ['webhooks'], queryFn: () => api('/api/webhooks') });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/api/webhooks/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Webhooks</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenCreate(true)}>
          <Plus size={14} /> New webhook
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={WebhookIcon} title="No webhooks" description="Receive HTTP callbacks when events happen in your workspace." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id}>
                  <td className="mono truncate" style={{ maxWidth: 400 }}>{w.url}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {w.events.map((e) => <span key={e} className="chip">{e}</span>)}
                    </div>
                  </td>
                  <td>
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={w.active}
                        onChange={(e) => toggle.mutate({ id: w.id, active: e.target.checked })}
                      />
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-icon btn-sm text-danger-fg" onClick={() => {
                      if (confirm('Delete this webhook?')) del.mutate(w.id);
                    }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openCreate && <CreateModal onClose={() => setOpenCreate(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['webhooks'] })} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ url: '', events: new Set<string>(['price.changed']) });
  const m = useMutation({
    mutationFn: () =>
      api('/api/webhooks', { method: 'POST', json: { url: form.url, events: Array.from(form.events) } }),
    onSuccess: () => {
      toast.success('Webhook created');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New webhook"
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!form.url || form.events.size === 0 || m.isPending} onClick={() => m.mutate()}>
            Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">URL</label>
          <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/webhooks/priceobo" />
        </div>
        <div>
          <label className="label">Events</label>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((ev) => {
              const on = form.events.has(ev);
              return (
                <button
                  key={ev}
                  type="button"
                  className={`filter-chip ${on ? 'active' : ''}`}
                  onClick={() => {
                    const next = new Set(form.events);
                    on ? next.delete(ev) : next.add(ev);
                    setForm({ ...form, events: next });
                  }}
                >
                  {ev}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
