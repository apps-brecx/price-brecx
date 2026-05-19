import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AppLayout } from "./components/AppLayout";
import { SignIn } from "./pages/SignIn";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Dashboard } from "./pages/Dashboard";
import { Calendar } from "./pages/Calendar";
import { Products } from "./pages/Products";
import { SKUs } from "./pages/SKUs";
import { Inventory } from "./pages/Inventory";
import { PriceAlert } from "./pages/PriceAlert";
import { PricingV2 } from "./pages/PricingV2";
import { Automation } from "./pages/Automation";
import { LostBuyBox } from "./pages/LostBuyBox";
import { BuyBoxAlert } from "./pages/BuyBoxAlert";
import { PriceAlertV2 } from "./pages/PriceAlertV2";
import { SalesAlert } from "./pages/SalesAlert";
import { Report } from "./pages/Report";
import { ActivityLog } from "./pages/ActivityLog";
import { Status } from "./pages/Status";
import { History } from "./pages/History";
import { Settings } from "./pages/Settings";

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="center-fill">
        <div className="spinner" />
      </div>
    );
  if (!user)
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/products" element={<Products />} />
        <Route path="/skus" element={<SKUs />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/price-alert" element={<PriceAlert />} />
        <Route path="/pricing-v2" element={<PricingV2 />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/buybox" element={<LostBuyBox />} />
        <Route path="/buybox-alert" element={<BuyBoxAlert />} />
        <Route path="/price-alert-v2" element={<PriceAlertV2 />} />
        <Route path="/sales-alert" element={<SalesAlert />} />
        <Route path="/report" element={<Report />} />
        <Route path="/activity-log" element={<ActivityLog />} />
        <Route path="/status" element={<Status />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
