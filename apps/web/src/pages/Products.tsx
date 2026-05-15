import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney, formatNumber } from '@/lib/utils';
import { MarketplacePill } from '@/components/ui/MarketplacePill';

type Listing = { id: string; currentPrice: string; connection: { marketplace: string } };
type SKU = { id: string; sku: string; listings: Listing[] };
type Product = { id: string; name: string; basePrice: string; imageUrl?: string | null; createdAt: string; skus: SKU[] };
type ProductsResp = { total: number; items: Product[] };

export default function Products() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', basePrice: '', imageUrl: '', description: '' });

  const { data, isLoading } = useQuery<ProductsResp>({
    queryKey: ['products', search],
    queryFn: () =>
      api(`/api/products?${new URLSearchParams(search ? { search } : {}).toString()}`),
  });

  const create = useMutation({
    mutationFn: () =>
      api('/api/products', {
        method: 'POST',
        json: {
          name: form.name,
          basePrice: Number(form.basePrice),
          imageUrl: form.imageUrl || undefined,
          description: form.description || undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Product created');
      setOpen(false);
      setForm({ name: '', basePrice: '', imageUrl: '', description: '' });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            className="input pl-8"
            style={{ width: 320 }}
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={14} /> New product
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Create your first product to start tracking SKUs and prices."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
                <Plus size={14} /> New product
              </button>
            }
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Base price</th>
                <th>SKUs</th>
                <th>Listings</th>
                <th>Channels</th>
                <th style={{ width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => {
                const channels = new Set(p.skus.flatMap((s) => s.listings.map((l) => l.connection.marketplace)));
                const listingCount = p.skus.reduce((a, s) => a + s.listings.length, 0);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
                        ) : (
                          <div className="grid h-9 w-9 place-items-center rounded bg-surface-2 text-ink-3">
                            <Package size={14} />
                          </div>
                        )}
                        <div className="font-medium">{p.name}</div>
                      </div>
                    </td>
                    <td>{formatMoney(p.basePrice)}</td>
                    <td>{formatNumber(p.skus.length)}</td>
                    <td>{formatNumber(listingCount)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(channels).map((c) => (
                          <MarketplacePill key={c} id={c} />
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-icon btn-sm text-danger-fg"
                        onClick={() => {
                          if (confirm(`Delete ${p.name}? This deletes all SKUs and listings.`)) del.mutate(p.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New product"
        footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!form.name || !form.basePrice || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Base price</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.basePrice}
              onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Image URL (optional)</label>
            <input className="input" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
