import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/useRealtime";
import "./AppLayout.css";

interface NavEntry {
  to: string;
  label: string;
  section?: string;
}

const NAV: NavEntry[] = [
  { to: "/", label: "Dashboard", section: "Overview" },
  { to: "/calendar", label: "Calendar" },
  { to: "/products", label: "Products" },
  { to: "/skus", label: "SKUs" },
  { to: "/inventory", label: "Inventory" },
  { to: "/price-alert", label: "Price Alert", section: "Pricing" },
  { to: "/pricing-v2", label: "Pricing v2" },
  { to: "/automation", label: "Automation" },
  { to: "/buybox", label: "Buy Box" },
  { to: "/price-alert-v2", label: "Price Alert v2", section: "Alerts" },
  { to: "/sales-alert", label: "Sales Alert" },
  { to: "/report", label: "Report", section: "Insights" },
  { to: "/activity-log", label: "Activity Log" },
  { to: "/status", label: "Status" },
  { to: "/history", label: "History" },
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  useRealtime();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo-wrap">
          <div className="logo-mark">
            <svg width="28" height="28" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="#1f47e5" />
              <path
                d="M9 23V9h7.2c3 0 4.9 1.8 4.9 4.5S19.2 18 16.2 18H12v5H9z"
                fill="#fff"
              />
            </svg>
          </div>
          <span className="logo-text">Priceobo</span>
        </div>

        <nav className="nav-scroll">
          {NAV.map((item) => (
            <div key={item.to}>
              {item.section && (
                <div className="nav-section-label">{item.section}</div>
              )}
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  "nav-item" + (isActive ? " active" : "")
                }
              >
                {item.label}
              </NavLink>
            </div>
          ))}
        </nav>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            "nav-item nav-settings" + (isActive ? " active" : "")
          }
        >
          Settings
        </NavLink>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-search">
            <input
              className="input input-search"
              placeholder="Search SKUs, ASINs, schedules…"
            />
          </div>
          <div className="topbar-right">
            <div className="user-menu">
              <button
                className="user-chip"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span className="avatar">
                  {(user?.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="user-name">{user?.name}</span>
              </button>
              {menuOpen && (
                <div className="user-dropdown">
                  <div className="user-dropdown-head">
                    <strong>{user?.name}</strong>
                    <span className="muted">{user?.email}</span>
                  </div>
                  <button
                    className="user-dropdown-item"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="page-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
