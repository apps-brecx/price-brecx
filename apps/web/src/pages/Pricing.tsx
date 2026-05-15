import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketplacePill } from '@/components/ui/MarketplacePill';
import { formatMoney, formatNumber, cn, MARKETPLACES } from '@/lib/utils';

type Listing = {
  id: string;
  currentPrice: string;
  stockAvailable: number;
  buyboxOwner?: string | null;
  buyboxPrice?: string | null;
  fulfillment?: string | null;
  connection: { id: string; marketplace: string };
  sku: { id: string; sku: string; product: { name: string } };
};

export default function Pricing() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('ALL');
  const [editing, setEditing] = useState<Listing | null>(null);
  const { data: listings, isLoading } = useQuery<Listing[]>({
    queryKey: ['listings'],
    queryFn: () => api('/api/listings'),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { sku: Listing['sku']; rows: Listing[] }>();
    (listings ?? []).forEach((l) => {
      const k = l.sku.id;
      const g = map.get(k) ?? { sku: l.sku, rows: [] };
      g.rows.push(l);
      map.set(k, g);
    });
    return Array.from(map.values());
  }, [listings]);

  const filtered =
    filter === 'ALL'
      ? grouped
      : grouped
          .map((g) => ({ ...g, rows: g.rows.filter((r) => r.connection.marketplace === filter) }))
          .filter((g) => g.rows.length > 0);

  const update = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      api(`/api/listings/${id}/price`, { method: 'PATCH', json: { price } }),
    onSuccess: () => {
      toast.success('Price updated');
      qc.invalidateQueries({ queryKey: ['listings'] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={cn('filter-chip', filter === 'ALL' && 'active')} onClick={() => setFilter('ALL')}>
          All channels
        </button>
        {MARKETPLACES.map((m) => (
          <button
            key={m.id}
            className={cn('filter-chip', filter === m.id && 'active')}
            onClick={() => setFilter(m.id)}
          >
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: m.color }}>
              {m.short}
            </span>
            {m.label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No listings yet"
            description="Listings appear after you connect marketplaces and import SKUs."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product / SKU</th>
                <th>Channel</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Fulfillment</th>
                <th>Buy Box</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.flatMap((g) =>
                g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium">{g.sku.product.name}</div>
                      <div className="mono text-[11.5px] text-ink-3">{g.sku.sku}</div>
                    </td>
                    <td><MarketplacePill id={r.connection.marketplace} /></td>
                    <td className="font-semibold">{formatMoney(r.currentPrice)}</td>
                    <td>{formatNumber(r.stockAvailable)}</td>
                    <td>{r.fulfillment ?? '—'}</td>
                    <td>
                      {r.buyboxOwner ? (
                        <span className={cn('chip', r.buyboxOwner === 'us' ? 'chip-success' : 'chip-warning')}>
                          {r.buyboxOwner === 'us' ? 'Won' : `Lost · ${r.buyboxOwner}`}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(r)}>
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditPriceModal
          listing={editing}
          onClose={() => setEditing(null)}
          onSave={(price) => update.mutate({ id: editing.id, price })}
          saving={update.isPending}
        />
      )}
    </div>
  );
}

function EditPriceModal({
  listing,
  onClose,
  onSave,
  saving,
}: {
  listing: Listing;
  onClose: () => void;
  onSave: (price: number) => void;
  saving: boolean;
}) {
  const [price, setPrice] = useState(String(listing.currentPrice));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit price — ${listing.sku.sku}`}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!price || saving}
            onClick={() => onSave(Number(price))}
          >
            {saving ? 'Saving…' : 'Update price'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MarketplacePill id={listing.connection.marketplace} />
          <span className="text-[12.5px] text-ink-3">Current {formatMoney(listing.currentPrice)}</span>
        </div>
        <div>
          <label className="label">New price</label>
          <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="rounded-sm border bg-surface-2 p-3 text-[12px] text-ink-3" style={{ borderColor: 'var(--border)' }}>
          This will push the new price to the marketplace (or record it manually if no integration is active) and log to price history.
        </div>
      </div>
    </Modal>
  );
}
