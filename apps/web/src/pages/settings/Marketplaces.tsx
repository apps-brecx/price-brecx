import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn, MARKETPLACES, relativeTime } from '@/lib/utils';
import { MarketplaceLogo } from '@/components/ui/MarketplacePill';

type Conn = {
  id: string;
  marketplace: string;
  displayName: string | null;
  region: string | null;
  status: string;
  sellerId: string | null;
  lastSyncAt: string | null;
  listingCount: number;
};

export default function MarketplaceSettings() {
  const qc = useQueryClient();
  const [openAdd, setOpenAdd] = useState(false);
  const { data, isLoading } = useQuery<Conn[]>({
    queryKey: ['marketplaces'],
    queryFn: () => api('/api/marketplaces'),
  });

  const sync = useMutation({
    mutationFn: (id: string) => api(`/api/marketplaces/${id}/sync`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Sync triggered');
      qc.invalidateQueries({ queryKey: ['marketplaces'] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/marketplaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['marketplaces'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Connected marketplaces</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenAdd(true)}>
          <Plus size={14} /> Add connection
        </button>
      </div>

      {isLoading ? (
        <div className="card p-6 text-sm text-ink-3">Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="card">
          <EmptyState icon={Plug} title="No marketplaces connected" description="Connect a marketplace to start syncing listings." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.map((c) => (
            <div key={c.id} className="card card-pad">
              <div className="mb-2 flex items-center gap-3">
                <MarketplaceLogo id={c.marketplace} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{c.displayName ?? c.marketplace}</div>
                  <div className="text-[11.5px] text-ink-3">
                    {c.region ?? '—'} · seller {c.sellerId ?? '—'}
                  </div>
                </div>
                <span
                  className={cn(
                    'chip',
                    c.status === 'CONNECTED' && 'chip-success',
                    c.status === 'ERROR' && 'chip-danger',
                    c.status === 'PENDING' && 'chip-warning',
                  )}
                >
                  {c.status.toLowerCase()}
                </span>
              </div>
              <div className="text-[12px] text-ink-3">
                {c.listingCount} listing(s) · {c.lastSyncAt ? `synced ${relativeTime(c.lastSyncAt)}` : 'never synced'}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => sync.mutate(c.id)}>
                  <RefreshCw size={13} /> Sync
                </button>
                <button
                  className="btn btn-ghost btn-sm text-danger-fg"
                  onClick={() => {
                    if (confirm(`Disconnect ${c.marketplace}? This deletes its listings.`)) del.mutate(c.id);
                  }}
                >
                  <Trash2 size={13} /> Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openAdd && <AddModal onClose={() => setOpenAdd(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['marketplaces'] })} />}
    </div>
  );
}

function AddModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    marketplace: 'AMAZON',
    displayName: '',
    region: 'US',
    sellerId: '',
    accessToken: '',
    refreshToken: '',
  });
  const m = useMutation({
    mutationFn: () =>
      api('/api/marketplaces', {
        method: 'POST',
        json: {
          marketplace: form.marketplace,
          displayName: form.displayName || undefined,
          region: form.region || undefined,
          sellerId: form.sellerId || undefined,
          accessToken: form.accessToken || undefined,
          refreshToken: form.refreshToken || undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Connected');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add marketplace connection"
      maxWidth={520}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Connecting…' : 'Connect'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Marketplace</label>
          <select className="input" value={form.marketplace} onChange={(e) => setForm({ ...form, marketplace: e.target.value })}>
            {MARKETPLACES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Display name</label>
            <input className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div>
            <label className="label">Region</label>
            <input className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Seller ID</label>
          <input className="input" value={form.sellerId} onChange={(e) => setForm({ ...form, sellerId: e.target.value })} />
        </div>
        <div>
          <label className="label">Access token</label>
          <input className="input" type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
        </div>
        <div>
          <label className="label">Refresh token (optional)</label>
          <input className="input" type="password" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} />
        </div>
        <div className="rounded-sm border bg-warning-bg p-3 text-[12px]" style={{ borderColor: 'var(--warning-border)', color: 'var(--warning-fg)' }}>
          Production OAuth flows aren't wired up yet. For now you can record credentials manually — they're stored as-is. Encrypt at rest before going live.
        </div>
      </div>
    </Modal>
  );
}
