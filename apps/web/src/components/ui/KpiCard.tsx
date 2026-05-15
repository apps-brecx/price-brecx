import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { value: string; direction: 'up' | 'down' | 'flat' };
}) {
  return (
    <div className="card card-pad">
      <div className="text-[12px] font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-2 text-[26px] font-semibold tracking-tight">{value}</div>
      {(trend || hint) && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
          {trend && (
            <span
              className={cn(
                'chip',
                trend.direction === 'up' && 'chip-success',
                trend.direction === 'down' && 'chip-danger',
                trend.direction === 'flat' && 'chip',
              )}
            >
              {trend.direction === 'up' && '↑'} {trend.direction === 'down' && '↓'} {trend.direction === 'flat' && '→'}
              <span className="ml-0.5">{trend.value}</span>
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}
