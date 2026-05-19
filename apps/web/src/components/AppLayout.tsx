import "./AppLayout.css";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/useRealtime";
import { relativeTime } from "../lib/format";
import { Logo } from "./Logo";

interface NavCounts {
  products: number;
  skus: number;
  inventoryUnits: number;
  automation: number;
  priceAlerts: number;
  salesAlerts: number;
}

interface Alert {
  id: string;
  kind: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  acknowledged: boolean;
  createdAt: string;
}

/** Route → [page title, breadcrumb label] — mirrors the redesign's switchPage() titles map. */
const TITLES: Record<string, [string, string]> = {
  "/": ["Dashboard", "Dashboard"],
  "/calendar": ["Calendar", "Calendar"],
  "/products": ["Products", "Products"],
  "/skus": ["SKUs", "SKUs"],
  "/inventory": ["Inventory", "Inventory"],
  "/price-alert": ["Pricing", "Pricing"],
  "/pricing-v2": ["Pricing v2", "Pricing v2"],
  "/automation": ["Automation Rules", "Automation"],
  "/buybox": ["Lost Buy Box", "Lost Buy Box"],
  "/price-alert-v2": ["Price Alert", "Price Alert"],
  "/sales-alert": ["Sales Alert", "Sales Alert"],
  "/report": ["Sales Report", "Reports"],
  "/activity-log": ["Activity Log", "Activity Log"],
  "/status": ["Schedule Status", "Status"],
  "/history": ["Price Change History", "History"],
  "/settings": ["Settings", "Settings"],
};

const ICONS: Record<string, JSX.Element> = {
  dashboard: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="9" rx="1.2" />
      <rect x="14" y="3" width="7" height="5" rx="1.2" />
      <rect x="14" y="12" width="7" height="9" rx="1.2" />
      <rect x="3" y="16" width="7" height="5" rx="1.2" />
    </svg>
  ),
  calendar: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  products: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  skus: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </svg>
  ),
  inventory: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  pricing: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 2v3M4.93 4.93l2.12 2.12M2 12h3M4.93 19.07l2.12-2.12M12 22v-3M19.07 19.07l-2.12-2.12M22 12h-3M19.07 4.93l-2.12 2.12" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
  automation: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  buybox: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <polyline points="16 3 12 7 8 3" />
    </svg>
  ),
  bell: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  sales: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-5" />
    </svg>
  ),
  report: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  ),
  activity: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  ),
  settings: (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

function navClass({ isActive }: { isActive: boolean }) {
  return "nav-item" + (isActive ? " active" : "");
}

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useRealtime();

  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const topbarRef = useRef<HTMLDivElement>(null);

  const { data: counts } = useQuery({
    queryKey: ["nav-counts"],
    queryFn: () => api.get<NavCounts>("/nav-counts"),
    staleTime: 30_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ["alerts", "all"],
    queryFn: () => api.get<{ items: Alert[]; total: number }>("/alerts"),
    staleTime: 30_000,
  });

  const unread = (alertsData?.items ?? []).filter((a) => !a.acknowledged);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (topbarRef.current && !topbarRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setHelpOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Close popovers and the mobile nav drawer on navigation.
  useEffect(() => {
    setNotifOpen(false);
    setHelpOpen(false);
    setNavOpen(false);
  }, [pathname]);

  const [title, crumb] = TITLES[pathname] ?? ["Priceobo", "Priceobo"];
  const initials = (user?.name ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function markAllRead() {
    await Promise.allSettled(
      unread.map((a) => api.post(`/alerts/${a.id}/ack`)),
    );
    await qc.invalidateQueries({ queryKey: ["alerts"] });
    await qc.invalidateQueries({ queryKey: ["nav-counts"] });
  }

  const navBadge = (n: number | undefined) =>
    typeof n === "number" ? n.toLocaleString("en-US") : null;

  return (
    <div className="app-shell">
      <div
        className={"nav-overlay" + (navOpen ? " show" : "")}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside className={"sidebar" + (navOpen ? " open" : "")}>
        <div className="logo-wrap">
          <div className="logo-mark">
            <Logo size={30} />
          </div>
          <div className="logo-text">Priceobo</div>
          <div
            style={{
              marginLeft: "auto",
              padding: "3px 6px",
              background: "var(--surface-2)",
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 600,
              color: "var(--text-3)",
              border: "1px solid var(--border)",
            }}
          >
            v3.0
          </div>
        </div>

        <div className="nav-section-label">Main</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <NavLink to="/" end className={navClass}>
            {ICONS.dashboard}
            Dashboard
          </NavLink>
          <NavLink to="/calendar" className={navClass}>
            {ICONS.calendar}
            Calendar
          </NavLink>
          <NavLink to="/products" className={navClass}>
            {ICONS.products}
            Products
            {navBadge(counts?.products) && (
              <span className="nav-badge">{navBadge(counts?.products)}</span>
            )}
          </NavLink>
          <NavLink to="/skus" className={navClass}>
            {ICONS.skus}
            SKUs
            {navBadge(counts?.skus) && (
              <span className="nav-badge">{navBadge(counts?.skus)}</span>
            )}
          </NavLink>
          <NavLink to="/inventory" className={navClass}>
            {ICONS.inventory}
            Inventory
            {navBadge(counts?.inventoryUnits) && (
              <span
                className="nav-badge"
                style={{ background: "var(--info-bg)", color: "var(--info-fg)", border: "none" }}
              >
                {navBadge(counts?.inventoryUnits)}
              </span>
            )}
          </NavLink>
        </div>

        <div className="nav-section-label">Pricing</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <NavLink to="/price-alert" className={navClass}>
            {ICONS.pricing}
            Pricing
          </NavLink>
          <NavLink to="/automation" className={navClass}>
            {ICONS.automation}
            Automation
            {navBadge(counts?.automation) && (
              <span className="nav-badge">{navBadge(counts?.automation)}</span>
            )}
          </NavLink>
          <NavLink to="/buybox" className={navClass}>
            {ICONS.buybox}
            Lost Buy Box
          </NavLink>
        </div>

        <div className="nav-section-label">Alerts</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <NavLink to="/price-alert-v2" className={navClass}>
            {ICONS.bell}
            Price Alert
            {!!counts?.priceAlerts && (
              <span
                className="nav-badge"
                style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", border: "none" }}
              >
                {counts.priceAlerts}
              </span>
            )}
          </NavLink>
          <NavLink to="/sales-alert" className={navClass}>
            {ICONS.sales}
            Sales Alert
            {!!counts?.salesAlerts && (
              <span
                className="nav-badge"
                style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", border: "none" }}
              >
                {counts.salesAlerts}
              </span>
            )}
          </NavLink>
        </div>

        <div className="nav-section-label">Analytics</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <NavLink to="/report" className={navClass}>
            {ICONS.report}
            Reports
          </NavLink>
          <NavLink to="/activity-log" className={navClass}>
            {ICONS.activity}
            Activity Log
          </NavLink>
        </div>

        <div style={{ flex: 1 }} />

        <div className="nav-section-label">Account</div>
        <NavLink to="/settings" className={navClass}>
          {ICONS.settings}
          Settings
        </NavLink>

        <div className="user-card" style={{ marginTop: 10 }}>
          <div className="avatar">{initials}</div>
          <div className="user-meta">
            <div className="user-name">{user?.name}</div>
            <div className="user-email">{user?.email}</div>
          </div>
          <button
            className="btn-ghost btn btn-icon btn-sm"
            title="Logout"
            onClick={() => void signOut()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>

      <main>
        <div className="topbar" ref={topbarRef}>
          <button
            className="btn btn-secondary btn-icon nav-toggle"
            title="Menu"
            aria-label="Toggle navigation"
            onClick={() => setNavOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="page-title-wrap">
            <div className="breadcrumb">
              <span>{crumb}</span>
            </div>
            <div className="page-title">{title}</div>
          </div>

          <div className="input-wrap topbar-search">
            <svg className="input-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input className="input" placeholder="Search ASIN, SKU, title…" />
            <span className="kbd">⌘K</span>
          </div>

          <div style={{ position: "relative" }}>
            <button
              className="btn btn-secondary btn-icon"
              title="Notifications"
              onClick={() => {
                setNotifOpen((v) => !v);
                setHelpOpen(false);
              }}
              style={{ position: "relative" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unread.length > 0 && (
                <span
                  className="pulse-dot"
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--danger-fg)",
                    border: "2px solid #fff",
                  }}
                />
              )}
            </button>
            <div className={"notif-panel" + (notifOpen ? " show" : "")}>
              <div className="notif-head">
                <div>
                  <div style={{ fontWeight: 650, fontSize: 14 }}>Notifications</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }}>
                    {unread.length} unread
                  </div>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => void markAllRead()}>
                  Mark all read
                </button>
              </div>
              <div className="notif-list">
                {unread.length === 0 && (
                  <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    No unread notifications
                  </div>
                )}
                {unread.slice(0, 12).map((a) => {
                  const tone =
                    a.severity === "critical"
                      ? { background: "var(--danger-bg)", color: "var(--danger-fg)" }
                      : a.severity === "warning"
                        ? { background: "var(--warning-bg)", color: "var(--warning-fg)" }
                        : { background: "var(--info-bg)", color: "var(--info-fg)" };
                  return (
                    <div key={a.id} className="notif-item unread">
                      <div className="notif-icon" style={tone}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                      </div>
                      <div className="notif-content">
                        <div className="notif-title">{a.title}</div>
                        <div className="notif-time">{relativeTime(a.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="notif-foot">
                <a
                  style={{ fontSize: 12.5, fontWeight: 550, color: "var(--brand-700)", cursor: "pointer" }}
                  onClick={() => {
                    setNotifOpen(false);
                    navigate("/price-alert-v2");
                  }}
                >
                  View all notifications →
                </a>
              </div>
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <button
              className="btn btn-secondary btn-icon"
              title="Help"
              onClick={() => {
                setHelpOpen((v) => !v);
                setNotifOpen(false);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
            <div
              className={"dropdown-menu" + (helpOpen ? " show" : "")}
              style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 200 }}
            >
              <a
                className="dropdown-item"
                href="https://priceobo.com/docs"
                target="_blank"
                rel="noreferrer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Documentation
              </a>
              <a
                className="dropdown-item"
                href="mailto:support@priceobo.com"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                Contact Support
              </a>
            </div>
          </div>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
