import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Copy, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate, relativeTime } from '@/lib/utils';

type Key = { id: string; name: string; prefix: string; lastUsedAt: string | null; expiresAt: string | null; createdAt: string };

export default function ApiKeySettings() {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const { data, isLoading } = useQuery<Key[]>({ queryKey: ['api-keys'], queryFn: () => api('/api/api-keys') });

  const create = useMutation({
    mutationFn: (name: string) => api('/api/api-keys', { method: 'POST', json: { name } }),
    onSuccess: (res: any) => {
      setNewKey(res.plainKey);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">API keys</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenCreate(true)}>
          <Plus size={14} /> New key
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={Key} title="No API keys" description="Generate a key to call the Priceobo API from your own integrations." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Last used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td className="mono">{k.prefix}…</td>
                  <td>{k.lastUsedAt ? relativeTime(k.lastUsedAt) : 'never'}</td>
                  <td>{formatDate(k.createdAt)}</td>
                  <td>
                    <button className="btn btn-ghost btn-icon btn-sm text-danger-fg" onClick={() => {
                      if (confirm(`Revoke key "${k.name}"?`)) del.mutate(k.id);
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

      {openCreate && (
        <CreateModal
          onClose={() => {
            setOpenCreate(false);
            setNewKey(null);
          }}
          onCreate={(name) => create.mutate(name)}
          newKey={newKey}
        />
      )}
    </div>
  );
}

function CreateModal({
  onClose,
  onCreate,
  newKey,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
  newKey: string | null;
}) {
  const [name, setName] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={newKey ? 'API key generated' : 'New API key'}
      footer={
        newKey ? (
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!name} onClick={() => onCreate(name)}>
              Generate
            </button>
          </>
        )
      }
    >
      {newKey ? (
        <div className="space-y-3">
          <div className="rounded-sm border bg-warning-bg p-3 text-[12.5px]" style={{ borderColor: 'var(--warning-border)', color: 'var(--warning-fg)' }}>
            Copy this key now — we won't show it again.
          </div>
          <div className="flex items-center gap-2 rounded-sm border bg-surface-2 px-3 py-2 mono" style={{ borderColor: 'var(--border)' }}>
            <span className="flex-1 truncate">{newKey}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
              navigator.clipboard.writeText(newKey);
              toast.success('Copied');
            }}>
              <Copy size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Key name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production server" />
        </div>
      )}
    </Modal>
  );
}
