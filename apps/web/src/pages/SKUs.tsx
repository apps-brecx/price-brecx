import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus, Search, Star, Trash2, CalendarPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney, formatNumber, cn } from '@/lib/utils';
import { MarketplacePill } from '@/components/ui/MarketplacePill';

type Tag = { id: string; name: string; color: string };
type Listing = { id: string; currentPrice: string; connection: { marketplace: string } };
type Product = { id: string; name: string };
type SkuRow = {
  id: string;
  sku: string;
  asin?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  favorite: boolean;
  fbaPrice?: string | null;
  fbmPrice?: string | null;
  shelves: number;
  fbmCount: number;
  product: Product;
  listings: Listing[];
  tags: Tag[];
};

type SkuResp = { total: number; items: SkuRow[] };
type ProductsResp = { total: number; items: Product[] };

export default function SKUs() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'PENDING'>('ALL');
  const [favOnly, setFavOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<SkuRow | null>(null);

  const { data, isLoading } = useQuery<SkuResp>({
    queryKey: ['skus', search, statusFilter, favOnly],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (statusFilter !== 'ALL') p.set('status', statusFilter);
      if (favOnly) p.set('favorite', 'true');
      return api(`/api/skus?${p.toString()}`);
    },
  });

  const products = useQuery<ProductsResp>({
    queryKey: ['products', 'lookup'],
    queryFn: () => api('/api/products?pageSize=200'),
  });

  const toggleFav = useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      api(`/api/skus/${id}`, { method: 'PATCH', json: { favorite } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skus'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/skus/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skus'] }),
  });

  const bulk = useMutation({
    mutationFn: (action: string) =>
      api('/api/skus/bulk-action', { method: 'POST', json: { skuIds: Array.from(selected), action } }),
    onSuccess: () => {
      toast.success('Bulk action applied');
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['skus'] });
    },
  });

  const allChecked = useMemo(
    () => !!data && data.items.length > 0 && data.items.every((r) => selected.has(r.id)),
    [data, selected],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input pl-8"
              style={{ width: 280 }}
              placeholder="Search SKU, ASIN, product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {(['ALL', 'ACTIVE', 'INACTIVE', 'PENDING'] as const).map((s) => (
            <button
              key={s}
              className={cn('filter-chip', statusFilter === s && 'active')}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
          <button className={cn('filter-chip', favOnly && 'active')} onClick={() => setFavOnly((v) => !v)}>
            <Star size={12} /> Favorites
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New SKU
        </button>
      </div>

      {selected.size > 0 && (
        <div className="card flex items-center gap-2 px-4 py-2">
          <span className="text-[12.5px] font-medium">{selected.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => bulk.mutate('activate')}>
              Activate
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => bulk.mutate('deactivate')}>
              Deactivate
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => bulk.mutate('favorite')}>
              Favorite
            </button>
            <button
              className="btn btn-secondary btn-sm text-danger-fg"
              onClick={() => {
                if (confirm(`Delete ${selected.size} SKUs?`)) bulk.mutate('delete');
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No SKUs yet"
            description="Create SKUs under your products to manage marketplace listings, prices, and schedules."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> New SKU
              </button>
            }
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(data.items.map((r) => r.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th style={{ width: 28 }}></th>
                <th>SKU</th>
                <th>Product</th>
                <th>Status</th>
                <th>FBA</th>
                <th>FBM</th>
                <th>Channels</th>
                <th>Tags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => {
                const channels = Array.from(new Set(r.listings.map((l) => l.connection.marketplace)));
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="text-ink-3 hover:text-warning-fg"
                        onClick={() => toggleFav.mutate({ id: r.id, favorite: !r.favorite })}
                      >
                        <Star size={14} fill={r.favorite ? 'currentColor' : 'none'} className={r.favorite ? 'text-warning-fg' : ''} />
                      </button>
                    </td>
                    <td className="mono font-medium">{r.sku}</td>
                    <td>{r.product.name}</td>
                    <td>
                      <span
                        className={cn(
                          'chip',
                          r.status === 'ACTIVE' && 'chip-success',
                          r.status === 'INACTIVE' && 'chip',
                          r.status === 'PENDING' && 'chip-warning',
                        )}
                      >
                        {r.status.toLowerCase()}
                      </span>
                    </td>
                    <td>{formatMoney(r.fbaPrice)}</td>
                    <td>{formatMoney(r.fbmPrice)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {channels.map((c) => (
                          <MarketplacePill key={c} id={c} />
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span key={t.id} className="chip">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Schedule price"
                          onClick={() => setScheduleFor(r)}
                        >
                          <CalendarPlus size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm text-danger-fg"
                          onClick={() => {
                            if (confirm(`Delete ${r.sku}?`)) del.mutate(r.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateSkuModal
          products={products.data?.items ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['skus'] })}
        />
      )}
      {scheduleFor && (
        <ScheduleDrawer
          sku={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['schedules'] })}
        />
      )}
    </div>
  );
}

function CreateSkuModal({
  products,
  onClose,
  onCreated,
}: {
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ productId: '', sku: '', asin: '', upc: '', fbaPrice: '', fbmPrice: '' });
  const m = useMutation({
    mutationFn: () =>
      api('/api/skus', {
        method: 'POST',
        json: {
          productId: form.productId,
          sku: form.sku,
          asin: form.asin || undefined,
          upc: form.upc || undefined,
          fbaPrice: form.fbaPrice ? Number(form.fbaPrice) : undefined,
          fbmPrice: form.fbmPrice ? Number(form.fbmPrice) : undefined,
        },
      }),
    onSuccess: () => {
      toast.success('SKU created');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New SKU"
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!form.productId || !form.sku || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Product</label>
          <select className="input" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
            <option value="">Select…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">SKU code</label>
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <label className="label">ASIN</label>
            <input className="input" value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} />
          </div>
          <div>
            <label className="label">UPC</label>
            <input className="input" value={form.upc} onChange={(e) => setForm({ ...form, upc: e.target.value })} />
          </div>
          <div>
            <label className="label">FBA price</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.fbaPrice}
              onChange={(e) => setForm({ ...form, fbaPrice: e.target.value })}
            />
          </div>
          <div>
            <label className="label">FBM price</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.fbmPrice}
              onChange={(e) => setForm({ ...form, fbmPrice: e.target.value })}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ScheduleDrawer({
  sku,
  onClose,
  onCreated,
}: {
  sku: SkuRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    type: 'SINGLE' as 'SINGLE' | 'WEEKLY' | 'WEEKLY_REVERT' | 'MONTHLY' | 'SALE',
    newPrice: '',
    revertPrice: '',
    startAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16),
    endAt: '',
    notes: '',
  });
  const m = useMutation({
    mutationFn: () =>
      api('/api/schedules', {
        method: 'POST',
        json: {
          skuId: sku.id,
          type: form.type,
          newPrice: Number(form.newPrice),
          revertPrice: form.revertPrice ? Number(form.revertPrice) : undefined,
          startAt: new Date(form.startAt).toISOString(),
          endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
          notes: form.notes || undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Schedule created');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Schedule price — ${sku.sku}`}
      maxWidth={520}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!form.newPrice || !form.startAt || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? 'Scheduling…' : 'Schedule change'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as any })}
          >
            <option value="SINGLE">Single change</option>
            <option value="SALE">Sale (with revert)</option>
            <option value="WEEKLY">Weekly recurring</option>
            <option value="WEEKLY_REVERT">Weekly + revert</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">New price</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.newPrice}
              onChange={(e) => setForm({ ...form, newPrice: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Revert price (optional)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.revertPrice}
              onChange={(e) => setForm({ ...form, revertPrice: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Start at</label>
            <input
              className="input"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
          </div>
          <div>
            <label className="label">End at (optional)</label>
            <input
              className="input"
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => setForm({ ...form, endAt: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="rounded-sm border bg-surface-2 p-3 text-[12px] text-ink-3" style={{ borderColor: 'var(--border)' }}>
          Affects {formatNumber(sku.listings.length)} listing(s).
        </div>
      </div>
    </Modal>
  );
}
