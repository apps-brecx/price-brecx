import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, DollarSign } from 'lucide-react';
import { api } from '@/lib/api';
import { MarketplaceLogo, MarketplacePill } from '@/components/ui/MarketplacePill';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney, formatNumber, marketplaceMeta } from '@/lib/utils';

type Listing = {
  id: string;
  currentPrice: string;
  stockAvailable: number;
  connection: { marketplace: string };
  sku: { id: string; sku: string; product: { id: string; name: string; imageUrl?: string | null } };
};

const MAIN = 3;

export default function PricingV2() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useQuery<Listing[]>({
    queryKey: ['listings'],
    queryFn: () => api('/api/listings'),
  });

  const groups = useMemo(() => {
    const map = new Map<string, { product: Listing['sku']['product']; rows: Listing[] }>();
    (data ?? []).forEach((l) => {
      const k = l.sku.product.id;
      const g = map.get(k) ?? { product: l.sku.product, rows: [] };
      g.rows.push(l);
      map.set(k, g);
    });
    return Array.from(map.values()).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [data]);

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="card p-6 text-sm text-ink-3">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={DollarSign} title="No listings" description="Connect marketplaces and import SKUs to see them here." />
        </div>
      ) : (
        groups.map((g) => {
          const visible = g.rows.slice(0, MAIN);
          const more = g.rows.slice(MAIN);
          const isOpen = expanded.has(g.product.id);
          return (
            <div key={g.product.id} className="card overflow-hidden">
              <div className="flex items-center gap-4 px-4 py-3">
                {g.product.imageUrl ? (
                  <img src={g.product.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded-md bg-surface-2 text-ink-3">
                    <DollarSign size={16} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.product.name}</div>
                  <div className="text-[12px] text-ink-3">{g.rows.length} listing(s)</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {visible.map((l) => (
                    <PriceCell key={l.id} l={l} />
                  ))}
                  {more.length > 0 && (
                    <button
                      className="filter-chip"
                      onClick={() =>
                        setExpanded((prev) => {
                          const n = new Set(prev);
                          n.has(g.product.id) ? n.delete(g.product.id) : n.add(g.product.id);
                          return n;
                        })
                      }
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      +{more.length} more
                    </button>
                  )}
                </div>
              </div>
              {isOpen && more.length > 0 && (
                <div className="border-t bg-surface-2 px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {more.map((l) => (
                      <PriceCell key={l.id} l={l} block />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PriceCell({ l, block }: { l: Listing; block?: boolean }) {
  const m = marketplaceMeta(l.connection.marketplace);
  return (
    <div className={`flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 ${block ? 'w-full' : ''}`} style={{ borderColor: 'var(--border)' }}>
      <MarketplaceLogo id={l.connection.marketplace} size={22} />
      <div className="min-w-0">
        <div className="text-[11px] text-ink-3">{m.label}</div>
        <div className="text-[13px] font-semibold leading-tight">{formatMoney(l.currentPrice)}</div>
      </div>
      <div className="ml-auto text-right text-[11px] text-ink-3">{formatNumber(l.stockAvailable)} in stock</div>
    </div>
  );
}
