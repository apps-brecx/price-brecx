import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/layout/AppLayout';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import Products from './pages/Products';
import SKUs from './pages/SKUs';
import Inventory from './pages/Inventory';
import Pricing from './pages/Pricing';
import PricingV2 from './pages/PricingV2';
import Automation from './pages/Automation';
import BuyBox from './pages/BuyBox';
import PriceAlerts from './pages/PriceAlerts';
import SalesAlerts from './pages/SalesAlerts';
import Reports from './pages/Reports';
import ActivityLog from './pages/ActivityLog';
import Settings from './pages/Settings';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-3 text-sm">Loading…</div>
    );
  }
  if (!user) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignUp />} />
      <Route
        path="/*"
        element={
          <Protected>
            <AppLayout>
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="products" element={<Products />} />
                <Route path="skus" element={<SKUs />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="pricing/v2" element={<PricingV2 />} />
                <Route path="automation" element={<Automation />} />
                <Route path="buybox" element={<BuyBox />} />
                <Route path="price-alert" element={<PriceAlerts />} />
                <Route path="sales-alert" element={<SalesAlerts />} />
                <Route path="reports" element={<Reports />} />
                <Route path="activity-log" element={<ActivityLog />} />
                <Route path="settings/*" element={<Settings />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AppLayout>
          </Protected>
        }
      />
    </Routes>
  );
}
