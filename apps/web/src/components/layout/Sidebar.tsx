import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  Package,
  Boxes,
  Warehouse,
  DollarSign,
  Settings as SettingsIcon,
  Zap,
  ShoppingBag,
  BellRing,
  TrendingDown,
  FileText,
  ScrollText,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type NavItem = { to: string; label: string; icon: LucideIcon; sub?: boolean };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/skus', label: 'SKUs', icon: Boxes },
      { to: '/inventory', label: 'Inventory', icon: Warehouse },
    ],
  },
  {
    title: 'Pricing',
    items: [
      { to: '/pricing', label: 'Pricing', icon: DollarSign },
      { to: '/pricing/v2', label: 'Pricing v2', icon: DollarSign, sub: true },
      { to: '/automation', label: 'Automation', icon: Zap },
      { to: '/buybox', label: 'Buy Box', icon: ShoppingBag },
    ],
  },
  {
    title: 'Alerts',
    items: [
      { to: '/price-alert', label: 'Price Alert', icon: BellRing },
      { to: '/sales-alert', label: 'Sales Alert', icon: TrendingDown },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/activity-log', label: 'Activity Log', icon: ScrollText },
    ],
  },
];

export function Sidebar() {
  const { user, workspace, signOut } = useAuth();
  const location = useLocation();
  const initials = (user?.name ?? user?.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r bg-white px-3 py-4" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2.5 border-b px-2.5 pb-4" style={{ borderColor: 'var(--border)' }}>
        <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="poGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1f47e5" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="15" fill="url(#poGrad)" />
          <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2" />
          <circle cx="16" cy="16" r="4" fill="#fff" />
        </svg>
        <div className="text-[15px] font-semibold tracking-tight">Priceobo</div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto pr-1">
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <div className="nav-section-label">{s.title}</div>
            <div className="flex flex-col gap-px">
              {s.items.map((it) => {
                const Icon = it.icon;
                const isActive =
                  location.pathname === it.to ||
                  (it.to !== '/' && location.pathname.startsWith(it.to + '/'));
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={cn('nav-item', isActive && 'active', it.sub && 'pl-8 text-[12.5px]')}
                  >
                    {!it.sub && <Icon size={16} className="flex-shrink-0" />}
                    {it.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}

        <div className="nav-section-label">Account</div>
        <NavLink
          to="/settings"
          className={({ isActive }) => cn('nav-item', isActive && 'active')}
        >
          <SettingsIcon size={16} className="flex-shrink-0" />
          Settings
        </NavLink>
      </div>

      <div
        className="mt-2 flex items-center gap-2.5 rounded-md border bg-white p-2.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-[0_0_0_1px_var(--border)]"
          style={{ background: 'linear-gradient(135deg, #ff9a3d, #e85d04)' }}>
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{user?.name ?? user?.email}</div>
          <div className="truncate text-[11px] text-ink-3">{workspace?.name ?? '—'}</div>
        </div>
        <button onClick={signOut} className="btn btn-ghost btn-icon btn-sm" title="Sign out">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
