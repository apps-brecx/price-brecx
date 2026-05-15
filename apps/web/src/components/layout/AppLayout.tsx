import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen" style={{ gridTemplateColumns: '240px 1fr' }}>
      <Sidebar />
      <main className="min-w-0">
        <Topbar />
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
