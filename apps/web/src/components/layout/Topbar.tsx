import { useLocation } from 'react-router-dom';
import { Bell, HelpCircle, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const TITLES: Record<string, { title: string; sub?: string }> = {
  '/dashboard': { title: 'Dashboard', sub: 'Overview of all marketplaces and pricing activity.' },
  '/calendar': { title: 'Calendar', sub: 'Schedule price changes across marketplaces.' },
  '/products': { title: 'Products' },
  '/skus': { title: 'SKUs' },
  '/inventory': { title: 'Inventory' },
  '/pricing': { title: 'Pricing' },
  '/pricing/v2': { title: 'Pricing v2' },
  '/automation': { title: 'Automation Rules' },
  '/buybox': { title: 'Buy Box Manager' },
  '/price-alert': { title: 'Price Alert' },
  '/sales-alert': { title: 'Sales Alert' },
  '/reports': { title: 'Reports' },
  '/activity-log': { title: 'Activity Log' },
  '/settings': { title: 'Settings' },
};

export function Topbar() {
  const location = useLocation();
  const { workspace } = useAuth();
  const path = '/' + location.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
  const meta = TITLES[path] ?? TITLES['/' + location.pathname.split('/')[1]] ?? { title: 'Priceobo' };

  return (
    <div className="topbar">
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
          <span>{workspace?.name ?? 'Workspace'}</span>
          <span className="text-ink-4">/</span>
          <span>{meta.title}</span>
        </div>
        <div className="truncate text-[17px] font-semibold tracking-tight">{meta.title}</div>
      </div>

      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className="input pl-9" placeholder="Search ASIN, SKU, title…" style={{ width: 280 }} />
        <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">⌘K</span>
      </div>

      <button className="btn btn-secondary btn-icon" title="Notifications">
        <Bell size={16} />
      </button>
      <button className="btn btn-secondary btn-icon" title="Help">
        <HelpCircle size={16} />
      </button>
    </div>
  );
}
