import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/ui/KpiCard';
import { formatMoney, formatNumber, cn } from '@/lib/utils';

type BB = {
  stats: { total: number; won: number; lost: number; autoReprice: number };
  listings: {
    id: string;
    currentPrice: string;
    buyboxOwner?: string | null;
    buyboxPrice?: string | null;
    autoReprice: boolean;
    sku: { sku: string; product: { name: string } };
    connection: { marketplace: string };
  }[];
};

export default function BuyBox() {
  const qc = useQueryClient();
  const [repriceFor, setRepriceFor] = useState<BB['listings'][number] | null>(null);
  const { data, isLoading } = useQuery<BB>({ queryKey: ['buybox'], queryFn: () => api('/api/buybox') });

  const toggle = useMutation({
    mutationFn: ({ id, autoReprice }: { id: string; autoReprice: boolean }) =>
      api(`/api/buybox/${id}/auto`, { method: 'PATCH', json: { autoReprice } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['buybox'] }),
  });

  const reprice = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      api(`/api/buybox/${id}/reprice`, { method: 'POST', json: { price } }),
    onSuccess: () => {
      toast.success('Reprice applied');
      qc.invalidateQueries({ queryKey: ['buybox'] });
      setRepriceFor(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Amazon" value={formatNumber(data?.stats.total ?? 0)} />
        <KpiCard label="Won" value={formatNumber(data?.stats.won ?? 0)} />
        <KpiCard label="Lost" value={formatNumber(data?.stats.lost ?? 0)} />
        <KpiCard label="Auto-reprice on" value={formatNumber(data?.stats.autoReprice ?? 0)} />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.listings.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No Amazon listings"
            description="Buy Box management works on Amazon listings. Connect Amazon SP-API to see them here."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product / SKU</th>
                <th>Our price</th>
                <th>Buy Box price</th>
                <th>Owner</th>
                <th>Auto-reprice</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.listings.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="font-medium">{l.sku.product.name}</div>
                    <div className="mono text-[11.5px] text-ink-3">{l.sku.sku}</div>
                  </td>
                  <td className="font-semibold">{formatMoney(l.currentPrice)}</td>
                  <td>{l.buyboxPrice ? formatMoney(l.buyboxPrice) : '—'}</td>
                  <td>
                    {l.buyboxOwner ? (
                      <span className={cn('chip', l.buyboxOwner === 'us' ? 'chip-success' : 'chip-warning')}>
                        {l.buyboxOwner === 'us' ? 'Won' : `Lost · ${l.buyboxOwner}`}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={l.autoReprice}
                        onChange={(e) => toggle.mutate({ id: l.id, autoReprice: e.target.checked })}
                      />
                      <span className="text-[12px]">{l.autoReprice ? 'on' : 'off'}</span>
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => setRepriceFor(l)}>
                      <RefreshCw size={13} /> Reprice
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {repriceFor && (
        <RepriceModal
          listing={repriceFor}
          onClose={() => setRepriceFor(null)}
          onSave={(price) => reprice.mutate({ id: repriceFor.id, price })}
          saving={reprice.isPending}
        />
      )}
    </div>
  );
}

function RepriceModal({
  listing,
  onClose,
  onSave,
  saving,
}: {
  listing: BB['listings'][number];
  onClose: () => void;
  onSave: (price: number) => void;
  saving: boolean;
}) {
  const [price, setPrice] = useState(String(listing.buyboxPrice ?? listing.currentPrice));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reprice — ${listing.sku.sku}`}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!price || saving} onClick={() => onSave(Number(price))}>
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-[12.5px] text-ink-3">
          Current: {formatMoney(listing.currentPrice)} · Buy Box: {listing.buyboxPrice ? formatMoney(listing.buyboxPrice) : 'unknown'}
        </div>
        <div>
          <label className="label">Target price</label>
          <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
