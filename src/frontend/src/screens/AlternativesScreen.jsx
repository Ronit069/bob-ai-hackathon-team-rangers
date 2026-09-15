import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton, Tabs } from "../components/layout.jsx";
import { DataTable, FactorList, ReasonList, ScoreBar, StatusBadge } from "../components/display.jsx";
import { DecisionButtons } from "../components/domain.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, NotActionableBanner, Toast } from "../components/states.jsx";
import { formatMoneyUsd } from "../utils/format.js";

export function AlternativesScreen() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "carriers" ? "carriers" : "routes";
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const shipment = useApi(() => api.getShipment(id), [id]);
  const routes = useApi(() => api.routeAlternatives(id, { limit: 10 }), [id], { enabled: tab === "routes" });
  const carriers = useApi(() => api.carrierAlternatives(id, { limit: 10 }), [id], { enabled: tab === "carriers" });

  const active = tab === "routes" ? routes : carriers;

  const create = async (type, option) => {
    setBusy(true);
    try {
      const body =
        type === "reroute"
          ? { type, shipment_id: id, route_id: option.route.id }
          : { type, shipment_id: id, carrier_id: option.carrier.id };
      const recommendation = await api.createRecommendation(body);
      setCreated(recommendation);
      setToast({ message: `${recommendation.id} created (pending approval).`, tone: "ok" });
    } catch (error) {
      setToast({
        message: error.isConflict?.() ? `${error.message} — refreshing options.` : error.message,
        tone: error.isConflict?.() ? "warn" : "danger",
      });
      active.refresh();
    } finally {
      setBusy(false);
    }
  };

  const notActionable = routes.data?.not_actionable || carriers.data?.not_actionable;

  const renderOption = (option, type) => {
    const title = type === "reroute" ? option.route.id : option.carrier.name;
    const subtitle =
      type === "reroute"
        ? `${option.route.origin_node} → ${option.route.destination_node} · carrier ${option.carrier?.name ?? option.route.carrier_id}`
        : `backing route ${option.backing_route?.id ?? option.factors?.backing_route_id ?? "—"}`;

    return (
      <div className="card" key={title} style={{ marginBottom: 12 }}>
        <header>
          <div>
            <h3 style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, textTransform: "none", letterSpacing: "0.01em", color: "var(--text)" }}>
              {title} {option.carrier ? <StatusBadge value={option.carrier.status} kind="carrier" /> : null}
            </h3>
            <p className="card-sub">{subtitle}</p>
          </div>
          <ScoreBar score={option.score} label="ranking score" />
        </header>
        <div className="card-body">
          <FactorList factors={option.factors} />
          <ReasonList reasons={option.reasons} />
          <p className="small muted" style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>
            cost {formatMoneyUsd(option.factors?.estimated_cost_usd)} · constraints: {(option.constraints_checked ?? []).join(", ")}
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={busy || Boolean(created)} onClick={() => create(type, option)}>
              Create pending recommendation
            </button>
            <span className="small muted">Human approval required.</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={`Alternatives · ${id}`}
        subtitle="Feasible options only; rejected candidates carry the backend reason"
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>Shipment detail</Link>
            <RefreshButton onClick={active.refresh} loading={active.loading} />
          </>
        }
      />

      {notActionable ? <NotActionableBanner reason={shipment.data?.status ?? "not actionable"} /> : null}

      <Tabs
        tabs={[
          { id: "routes", label: "Routes" },
          { id: "carriers", label: "Carriers" },
        ]}
        active={tab}
        onChange={(next) => setSearchParams({ tab: next })}
      />

      <Card title={tab === "routes" ? "Ranked Route Options" : "Ranked Carrier Options"} subtitle="Backend scores, factors and reasons rendered verbatim">
        {active.loading ? <LoadingSkeleton rows={5} /> : null}
        {active.error ? <ErrorState error={active.error} onRetry={active.refresh} /> : null}
        {active.data && active.data.count === 0 ? (
          <EmptyState
            title="No feasible alternatives"
            message={
              active.data.rejected?.length
                ? `Rejected: ${active.data.rejected.map((row) => `${row.route_id ?? row.carrier_id} (${String(row.rejected_reason).replace(/_/g, " ")})`).join(", ")}`
                : "No candidate routes exist for this origin–destination pair."
            }
          />
        ) : null}
        {active.data?.data?.map((option) => renderOption(option, tab === "routes" ? "reroute" : "carrier_change"))}
      </Card>

      {created ? (
        <Card title={`Decision · ${created.id}`} subtitle="The decision is written to the audit trail; nothing is executed automatically.">
          <DecisionButtons recommendation={created} onDecided={(updated) => setCreated(updated)} />
        </Card>
      ) : null}

      {active.data?.rejected?.length > 0 ? (
        <Card title="Rejected Options" subtitle="Hard-constraint failures — backend rejection reasons">
          <DataTable
            columns={[
              { key: "target", header: "Candidate", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{row.route_id ?? row.carrier_id}</span> },
              { key: "rejected_reason", header: "Reason", render: (row) => <span className="badge warn" style={{ textTransform: "none" }}>{String(row.rejected_reason).replace(/_/g, " ")}</span> },
              { key: "details", header: "Details", render: (row) => <span className="small muted">{row.details ? JSON.stringify(row.details) : "—"}</span> },
            ]}
            rows={active.data.rejected}
            rowKey={(row, index) => `${row.route_id ?? row.carrier_id}-${index}`}
          />
        </Card>
      ) : null}

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
