import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Pause, Trash2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, relativeTime } from '@/lib/utils';

type Rule = {
  id: string;
  name: string;
  type: 'COMPETITOR_BASED' | 'STOCK_BASED' | 'TIME_BASED' | 'BUYBOX' | 'CUSTOM';
  status: 'ACTIVE' | 'PAUSED' | 'DRAFT';
  matchMode: 'ALL' | 'ANY';
  conditions: any[];
  adjustment: { type: 'percent' | 'amount' | 'absolute'; value: number };
  affectedSkus: string[];
  lastRunAt?: string | null;
  createdAt: string;
};

type SKULookup = { total: number; items: { id: string; sku: string; product: { name: string } }[] };

export default function Automation() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const { data, isLoading } = useQuery<Rule[]>({
    queryKey: ['automation'],
    queryFn: () => api('/api/automation'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' }) =>
      api(`/api/automation/${id}`, { method: 'PATCH', json: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/automation/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation'] }),
  });

  const run = useMutation({
    mutationFn: (id: string) => api(`/api/automation/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Rule executed');
      qc.invalidateQueries({ queryKey: ['automation'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button className="btn btn-primary" onClick={() => setOpenCreate(true)}>
          <Plus size={14} /> New rule
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No automation rules"
            description="Create rules to auto-reprice based on competitor, stock, time, or Buy Box state."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setOpenCreate(true)}>
                <Plus size={14} /> New rule
              </button>
            }
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Type</th>
                <th>Adjustment</th>
                <th>SKUs</th>
                <th>Status</th>
                <th>Last run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td><span className="chip">{r.type.replace('_', ' ').toLowerCase()}</span></td>
                  <td>
                    {r.adjustment.type === 'percent'
                      ? `${r.adjustment.value > 0 ? '+' : ''}${r.adjustment.value}%`
                      : r.adjustment.type === 'absolute'
                      ? `set to ${r.adjustment.value}`
                      : `${r.adjustment.value > 0 ? '+' : ''}${r.adjustment.value}`}
                  </td>
                  <td>{r.affectedSkus.length}</td>
                  <td>
                    <span
                      className={cn(
                        'chip',
                        r.status === 'ACTIVE' && 'chip-success',
                        r.status === 'PAUSED' && 'chip-warning',
                        r.status === 'DRAFT' && 'chip',
                      )}
                    >
                      {r.status.toLowerCase()}
                    </span>
                  </td>
                  <td>{r.lastRunAt ? relativeTime(r.lastRunAt) : 'never'}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-icon btn-sm" title="Run now" onClick={() => run.mutate(r.id)}>
                        <Play size={13} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        title={r.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                        onClick={() => toggle.mutate({ id: r.id, status: r.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
                      >
                        {r.status === 'ACTIVE' ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-sm text-danger-fg"
                        onClick={() => {
                          if (confirm(`Delete rule "${r.name}"?`)) del.mutate(r.id);
                        }}
                      >
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

      {openCreate && (
        <CreateRuleModal
          onClose={() => setOpenCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['automation'] })}
        />
      )}
    </div>
  );
}

function CreateRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    type: 'COMPETITOR_BASED' as Rule['type'],
    matchMode: 'ALL' as 'ALL' | 'ANY',
    field: 'competitor_price',
    op: 'lt',
    value: '',
    adjType: 'percent' as 'percent' | 'amount' | 'absolute',
    adjValue: '',
    selectedSkus: new Set<string>(),
    skuSearch: '',
  });

  const { data: skuData } = useQuery<SKULookup>({
    queryKey: ['skus', 'lookup', form.skuSearch],
    queryFn: () => api(`/api/skus?pageSize=50${form.skuSearch ? '&search=' + encodeURIComponent(form.skuSearch) : ''}`),
  });

  const m = useMutation({
    mutationFn: () =>
      api('/api/automation', {
        method: 'POST',
        json: {
          name: form.name,
          type: form.type,
          matchMode: form.matchMode,
          conditions: [{ field: form.field, op: form.op, value: form.value }],
          adjustment: { type: form.adjType, value: Number(form.adjValue) },
          affectedSkus: Array.from(form.selectedSkus),
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
    <Modal
      open
      onClose={onClose}
      title="New automation rule"
      maxWidth={640}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!form.name || !form.adjValue || form.selectedSkus.size === 0 || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? 'Creating…' : 'Create rule'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Undercut competitor by 1%" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
              <option value="COMPETITOR_BASED">Competitor</option>
              <option value="STOCK_BASED">Stock</option>
              <option value="TIME_BASED">Time</option>
              <option value="BUYBOX">Buy Box</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </div>
          <div>
            <label className="label">Match</label>
            <select className="input" value={form.matchMode} onChange={(e) => setForm({ ...form, matchMode: e.target.value as any })}>
              <option value="ALL">All conditions</option>
              <option value="ANY">Any condition</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Condition</label>
          <div className="grid grid-cols-3 gap-2">
            <input className="input" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} placeholder="field" />
            <select className="input" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
              <option value="lt">&lt;</option>
              <option value="lte">≤</option>
              <option value="gt">&gt;</option>
              <option value="gte">≥</option>
              <option value="eq">=</option>
            </select>
            <input className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="value" />
          </div>
        </div>

        <div>
          <label className="label">Adjustment</label>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={form.adjType} onChange={(e) => setForm({ ...form, adjType: e.target.value as any })}>
              <option value="percent">Percent (%)</option>
              <option value="amount">Amount (±)</option>
              <option value="absolute">Set absolute price</option>
            </select>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.adjValue}
              onChange={(e) => setForm({ ...form, adjValue: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Apply to SKUs</label>
          <input
            className="input mb-2"
            value={form.skuSearch}
            onChange={(e) => setForm({ ...form, skuSearch: e.target.value })}
            placeholder="Search SKUs to add…"
          />
          <div className="max-h-60 overflow-y-auto rounded-sm border" style={{ borderColor: 'var(--border)' }}>
            {(skuData?.items ?? []).map((s) => {
              const checked = form.selectedSkus.has(s.id);
              return (
                <label key={s.id} className="flex items-center gap-2 border-b px-3 py-1.5 text-[13px] last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(form.selectedSkus);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      setForm({ ...form, selectedSkus: next });
                    }}
                  />
                  <span className="mono">{s.sku}</span>
                  <span className="text-ink-3">— {s.product.name}</span>
                </label>
              );
            })}
            {(skuData?.items?.length ?? 0) === 0 && (
              <div className="p-3 text-[12px] text-ink-3">No SKUs found.</div>
            )}
          </div>
          <div className="mt-2 text-[12px] text-ink-3">{form.selectedSkus.size} selected</div>
        </div>
      </div>
    </Modal>
  );
}
