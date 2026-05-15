import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag as TagIcon, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

type Tag = { id: string; name: string; color: string; _count?: { skus: number } };

const COLORS = ['blue', 'red', 'green', 'amber', 'purple', 'gray'] as const;

export default function TagSettings() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const { data, isLoading } = useQuery<Tag[]>({ queryKey: ['tags'], queryFn: () => api('/api/tags') });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Tags</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenCreate(true)}>
          <Plus size={14} /> New tag
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={TagIcon} title="No tags" description="Tags help you group SKUs for automation, filtering, and notifications." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Color</th>
                <th>SKUs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td><span className={cn('chip', colorClass(t.color))}>{t.color}</span></td>
                  <td>{t._count?.skus ?? 0}</td>
                  <td>
                    <button className="btn btn-ghost btn-icon btn-sm text-danger-fg" onClick={() => {
                      if (confirm(`Delete tag "${t.name}"?`)) del.mutate(t.id);
                    }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openCreate && <CreateTagModal onClose={() => setOpenCreate(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['tags'] })} />}
    </div>
  );
}

function colorClass(c: string) {
  switch (c) {
    case 'blue':
      return 'chip-info';
    case 'red':
      return 'chip-danger';
    case 'green':
      return 'chip-success';
    case 'amber':
      return 'chip-warning';
    case 'purple':
      return 'chip-purple';
    default:
      return 'chip';
  }
}

function CreateTagModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', color: 'blue' as (typeof COLORS)[number] });
  const m = useMutation({
    mutationFn: () => api('/api/tags', { method: 'POST', json: form }),
    onSuccess: () => {
      toast.success('Tag created');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="New tag" footer={
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
        <div>
          <label className="label">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={cn('chip', colorClass(c), form.color === c && 'ring-2 ring-brand-500')}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
