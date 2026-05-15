import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { cn } from '@/lib/utils';
import GeneralSettings from './settings/General';
import TeamSettings from './settings/Team';
import MarketplaceSettings from './settings/Marketplaces';
import TagSettings from './settings/Tags';
import NotificationSettings from './settings/Notifications';
import ApiKeySettings from './settings/ApiKeys';
import WebhookSettings from './settings/Webhooks';

const TABS = [
  { to: 'general', label: 'General' },
  { to: 'team', label: 'Team Members' },
  { to: 'marketplaces', label: 'Marketplaces' },
  { to: 'tags', label: 'Tags' },
  { to: 'notifications', label: 'Notifications' },
  { to: 'api-keys', label: 'API Keys' },
  { to: 'webhooks', label: 'Webhooks' },
];

export default function Settings() {
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: '200px 1fr' }}>
      <aside className="flex flex-col gap-px">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                'rounded-sm px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-surface-2',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </aside>
      <div>
        <Routes>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<GeneralSettings />} />
          <Route path="team" element={<TeamSettings />} />
          <Route path="marketplaces" element={<MarketplaceSettings />} />
          <Route path="tags" element={<TagSettings />} />
          <Route path="notifications" element={<NotificationSettings />} />
          <Route path="api-keys" element={<ApiKeySettings />} />
          <Route path="webhooks" element={<WebhookSettings />} />
        </Routes>
      </div>
    </div>
  );
}
