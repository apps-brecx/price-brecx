import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { formatMoney, cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';

type Schedule = {
  id: string;
  startAt: string;
  endAt?: string | null;
  type: 'SINGLE' | 'WEEKLY' | 'WEEKLY_REVERT' | 'MONTHLY' | 'SALE';
  status: 'UPCOMING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  newPrice: string;
  revertPrice?: string | null;
  notes?: string | null;
  sku: { id: string; sku: string; product: { name: string } };
};

const TYPE_COLOR: Record<string, string> = {
  SINGLE: 'chip-info',
  SALE: 'chip-danger',
  WEEKLY: 'chip-brand',
  WEEKLY_REVERT: 'chip-brand',
  MONTHLY: 'chip-purple',
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Calendar() {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Schedule | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);

  const { data: schedules } = useQuery<Schedule[]>({
    queryKey: ['schedules', 'calendar', monthStart.toISOString(), monthEnd.toISOString()],
    queryFn: () =>
      api(`/api/schedules/calendar?from=${monthStart.toISOString()}&to=${monthEnd.toISOString()}`),
  });

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    (schedules ?? []).forEach((s) => {
      const k = new Date(s.startAt).toDateString();
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    });
    return map;
  }, [schedules]);

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Schedule cancelled');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      setSelected(null);
    },
  });

  const execute = useMutation({
    mutationFn: (id: string) => api(`/api/schedules/${id}/execute`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Executed now');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      setSelected(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft size={14} />
            </button>
            <div className="text-[15px] font-semibold">
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight size={14} />
            </button>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </button>
        </div>

        <div className="grid grid-cols-7 border-b text-[11px] font-semibold uppercase tracking-wider text-ink-3" style={{ borderColor: 'var(--border)' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="px-3 py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((day, i) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const events = eventsByDay.get(day.toDateString()) ?? [];
            const today = sameDay(day, new Date());
            return (
              <div
                key={i}
                className={cn(
                  'min-h-[100px] border-b border-r p-2',
                  !inMonth && 'bg-surface-2 text-ink-4',
                )}
                style={{ borderColor: 'var(--border)' }}
              >
                <div className={cn('mb-1 text-[12px] font-semibold', today && 'text-brand-700')}>
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-1">
                  {events.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelected(e)}
                      className={cn('chip w-full justify-start truncate text-[10.5px]', TYPE_COLOR[e.type])}
                    >
                      {formatMoney(e.newPrice)} · {e.sku.sku}
                    </button>
                  ))}
                  {events.length > 3 && (
                    <div className="text-[10.5px] text-ink-3">+{events.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(schedules?.length ?? 0) === 0 && (
        <div className="card">
          <EmptyState
            icon={CalendarIcon}
            title="No schedules this month"
            description="Create a schedule from the SKUs page to see it on the calendar."
          />
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="text-[14px] font-semibold">{selected.sku.product.name}</div>
                <div className="mono text-[11.5px] text-ink-3">{selected.sku.sku}</div>
              </div>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body space-y-3 text-[13px]">
              <Row k="Type" v={<span className={cn('chip', TYPE_COLOR[selected.type])}>{selected.type.replace('_', ' ').toLowerCase()}</span>} />
              <Row k="Status" v={<span className="chip">{selected.status.toLowerCase()}</span>} />
              <Row k="New price" v={formatMoney(selected.newPrice)} />
              {selected.revertPrice && <Row k="Revert price" v={formatMoney(selected.revertPrice)} />}
              <Row k="Start" v={new Date(selected.startAt).toLocaleString()} />
              {selected.endAt && <Row k="End" v={new Date(selected.endAt).toLocaleString()} />}
              {selected.notes && <Row k="Notes" v={selected.notes} />}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-secondary btn-sm"
                disabled={selected.status !== 'UPCOMING'}
                onClick={() => execute.mutate(selected.id)}
              >
                Execute now
              </button>
              <button
                className="btn btn-danger btn-sm"
                disabled={selected.status !== 'UPCOMING'}
                onClick={() => cancel.mutate(selected.id)}
              >
                Cancel schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-2" style={{ borderColor: 'var(--border)' }}>
      <span className="text-ink-3">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function buildMonthGrid(cursor: Date) {
  const first = startOfMonth(cursor);
  // shift so Monday is first column
  const dayOfWeek = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - dayOfWeek);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}
