import { marketplaceMeta } from '@/lib/utils';

export function MarketplacePill({ id }: { id: string }) {
  const m = marketplaceMeta(id);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-white py-0.5 pl-0.5 pr-2 text-[11.5px] font-semibold"
      style={{ borderColor: 'var(--border)' }}>
      <span
        className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ background: m.color }}
      >
        {m.short}
      </span>
      {m.label}
    </span>
  );
}

export function MarketplaceLogo({ id, size = 28 }: { id: string; size?: number }) {
  const m = marketplaceMeta(id);
  return (
    <div
      className="grid place-items-center rounded-md text-white font-bold"
      style={{ background: m.color, width: size, height: size, fontSize: size / 2.4 }}
    >
      {m.short}
    </div>
  );
}
