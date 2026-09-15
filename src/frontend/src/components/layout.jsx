import { NavLink } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";

const NAV = [
  { group: "Control tower" },
  { to: "/", label: "Overview" },
  { to: "/disruptions", label: "Disruptions" },
  { to: "/fleet", label: "Fleet" },
  { to: "/coldchain", label: "Cold chain" },
  { to: "/sensors", label: "Sensor health" },
  { to: "/audit", label: "Audit trail" },
  { group: "Assistant" },
  { to: "/chat", label: "Bob chat" },
];

export function Navigation() {
  return (
    <nav className="app-nav">
      <h1>ChainSentinel</h1>
      <div className="nav-sub">L2 control tower · live REST API</div>
      {NAV.map((item, index) =>
        item.group ? (
          <div className="nav-group" key={`group-${index}`}>
            {item.group}
          </div>
        ) : (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            {item.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

export function AppShell({ children }) {
  const health = useApi(() => api.health(), []);
  const up = health.data?.status === "ok";

  return (
    <div className="app-shell">
      <Navigation />
      <main className="app-main">
        <div className="app-header">
          <span className="small muted">All data comes from the frozen REST API — no mock data.</span>
          <span className={`health-dot ${up ? "up" : health.error ? "down" : ""}`}>
            <span className="dot" />
            {up ? "backend ok" : health.error ? "backend down" : "checking…"}
            {health.data?.bob ? ` · bob ${health.data.bob}` : ""}
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children }) {
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
      {children}
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
