import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";

// Phosphor Icons — inline SVG symbols for ChainSentinel-specific nav items
// Using simple path-based SVGs at 16×16 to keep it self-contained and testable

function IconOverview() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
    </svg>
  );
}

function IconDisruption() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
      <path d="M8 6.5V9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <circle cx="8" cy="11" r="0.6" fill="currentColor"/>
    </svg>
  );
}

function IconFleet() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="6" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M11 8.5L14.5 8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <path d="M11 10.5L14.5 10.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <circle cx="4" cy="13.5" r="1.25" stroke="currentColor" strokeWidth="1.1"/>
      <circle cx="8.5" cy="13.5" r="1.25" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M1 6L3.5 2.5H8L11 6" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
    </svg>
  );
}

function IconColdChain() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1V15M4.27 3.27L11.73 12.73M3 8H13M4.27 12.73L11.73 3.27" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <circle cx="8" cy="8" r="1.5" fill="currentColor" opacity="0.6"/>
    </svg>
  );
}

function IconSensor() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="9" r="2" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5.2 6.2A4 4 0 0 1 10.8 6.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <path d="M3 4A7 7 0 0 1 13 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
      <path d="M8 11V14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
    </svg>
  );
}

function IconAudit() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2.5H10L13 5.5V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
      <path d="M9.5 2.5V6H13" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
      <path d="M5.5 7.5H10.5M5.5 9.5H10.5M5.5 11.5H8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function IconBob() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25"/>
      <path d="M5.5 9.5C5.5 9.5 6.5 11 8 11C9.5 11 10.5 9.5 10.5 9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <circle cx="6" cy="7" r="0.8" fill="currentColor"/>
      <circle cx="10" cy="7" r="0.8" fill="currentColor"/>
    </svg>
  );
}

function IconPanelToggle({ collapsed }) {
  return (
    <svg className="nav-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={collapsed ? "M6 3L11 8L6 13" : "M10 3L5 8L10 13"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 3V13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg className="nav-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  { group: "CONTROL" },
  { to: "/", label: "Overview", end: true, Icon: IconOverview },
  { group: "OPERATIONS" },
  { to: "/disruptions", label: "Disruptions", Icon: IconDisruption },
  { to: "/fleet", label: "Fleet", Icon: IconFleet },
  { to: "/coldchain", label: "Cold Chain", Icon: IconColdChain },
  { to: "/sensors", label: "Sensor Health", Icon: IconSensor },
  { group: "DECISIONS" },
  { to: "/audit", label: "Audit Trail", Icon: IconAudit },
  { group: "BOB" },
  { to: "/chat", label: "Bob Chat", Icon: IconBob },
];

export function Navigation({ collapsed, mobileOpen, onToggle, onClose }) {
  return (
    <>
      <button
        type="button"
        className={`nav-scrim ${mobileOpen ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={onClose}
      />
      <nav className={`app-nav ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="nav-topline">
      <div className="nav-brand">
        <span className="nav-brand-name">ChainSentinel</span>
        <span className="nav-brand-tagline">L2 Control Tower</span>
      </div>
      <button
        type="button"
        className="nav-collapse-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        <IconPanelToggle collapsed={collapsed} />
      </button>
      </div>
      {NAV.map((item, index) =>
        item.group ? (
          <div className="nav-group" key={`group-${index}`}>
            {item.group}
          </div>
        ) : (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onClose} title={collapsed ? item.label : undefined}>
            {item.Icon ? <item.Icon /> : null}
            <span className="nav-link-label">{item.label}</span>
          </NavLink>
        ),
      )}
      </nav>
    </>
  );
}

export function AppShell({ children }) {
  const health = useApi(() => api.health(), []);
  const up = health.data?.status === "ok";
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("chainsentinel-nav-collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("chainsentinel-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("chainsentinel-nav-collapsed", String(collapsed));
  }, [collapsed]);

  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const nextTheme = theme === "dark" ? "Light" : "Dark";

  return (
    <div className={`app-shell ${collapsed ? "nav-collapsed" : ""}`}>
      <Navigation
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed((current) => !current)}
        onClose={() => setMobileOpen(false)}
      />
      <main className="app-main">
        <div className="app-header">
          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <IconMenu />
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${nextTheme} Mode`}
            title={`Switch to ${nextTheme} Mode`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
            {nextTheme} Mode
          </button>
          <span className={`health-dot ${up ? "up" : health.error ? "down" : ""}`}>
            <span className="dot" />
            {up ? "backend ok" : health.error ? "backend down" : "checking…"}
          </span>
        </div>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div className="page-header-left">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, noPad }) {
  return (
    <section className="card">
      {title || actions ? (
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      <div className={noPad ? undefined : "card-body"}>
        {children}
      </div>
    </section>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? "active" : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children }) {
  return <div className="filters">{children}</div>;
}

export function FilterField({ label, children }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

export function RefreshButton({ onClick, loading }) {
  return (
    <button type="button" onClick={onClick} disabled={loading}>
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  );
}
