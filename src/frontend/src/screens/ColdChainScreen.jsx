import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, StatusBadge } from "../components/display.jsx";
import { PolicyEditor } from "../components/domain.jsx";
import { Banner, EmptyState, ErrorState, LoadingSkeleton, Toast } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const POLL_MS = 30_000; // A2: alerts poll every 30 s, paused while the tab is hidden

export function ColdChainScreen() {
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [toast, setToast] = useState(null);

  const alerts = useApi(() => api.alerts(), []);
  const shipments = useApi(() => api.listShipments({ is_cold_chain: true, limit: 100 }), []);
  const policies = useApi(() => api.listPolicies(), []);

  usePolling(alerts.refresh, POLL_MS);

  const openEditor = async (policy) => {
    try {
      const full = await api.listPolicies({ include_history: false });
      const latest = full.data.find((row) => row.cargo_type === policy.cargo_type);
      setSelectedPolicy(latest ?? policy);
    } catch {
      setSelectedPolicy(policy);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cold-chain monitoring"
        subtitle="Alerts combine backend-detected excursions and sensor failures."
        actions={<RefreshButton onClick={alerts.refresh} loading={alerts.loading} />}
      />

      <Card title="Active alerts" subtitle={`Auto-refresh every ${POLL_MS / 1000} s (paused when the tab is hidden).`}>
        {alerts.loading ? <LoadingSkeleton rows={4} /> : null}
        {alerts.error ? <ErrorState error={alerts.error} onRetry={alerts.refresh} /> : null}
        {alerts.data && alerts.data.count === 0 ? (
          <EmptyState title="No active cold-chain alerts" message="Excursions and sensor failures will appear here." />
        ) : null}
        {alerts.data && alerts.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "type", header: "Type", render: (row) => <StatusBadge value={row.type} kind="alert" /> },
              { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
              { key: "shipment_id", header: "Shipment", render: (row) => row.shipment_id },
              { key: "summary", header: "Summary" },
              {
                key: "review",
                header: "Human review",
                render: (row) => (row.human_review_required ? <span className="badge review">required</span> : <span className="muted">optional</span>),
              },
              {
                key: "open",
                header: "",
                render: (row) =>
                  row.excursion_id ? (
                    <Link className="link" to={`/excursions/${row.excursion_id}`}>
                      open excursion
                    </Link>
                  ) : (
                    <Link className="link" to={`/shipments/${row.shipment_id}/temperature`}>
                      readings
                    </Link>
                  ),
              },
            ]}
            rows={alerts.data.data}
            rowKey={(row, index) => `${row.type}-${row.shipment_id}-${index}`}
          />
        ) : null}
      </Card>

      <Card title="Cold-chain shipments" subtitle="Unfiltered list; unknown-policy shipments are surfaced by the backend risk/alert layer.">
        {shipments.loading ? <LoadingSkeleton rows={5} /> : null}
        {shipments.error ? <ErrorState error={shipments.error} onRetry={shipments.refresh} /> : null}
        {shipments.data && shipments.data.count === 0 ? <EmptyState title="No cold-chain shipments" /> : null}
        {shipments.data && shipments.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "id", header: "Shipment", render: (row) => row.id },
              { key: "cargo_type", header: "Cargo", render: (row) => row.cargo_type.replace(/_/g, " ") },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
              { key: "deadline", header: "Deadline", render: (row) => formatDateTime(row.deadline) },
              {
                key: "links",
                header: "",
                render: (row) => (
                  <div className="row">
                    <Link className="link" to={`/shipments/${row.id}/temperature`}>
                      history
                    </Link>
                    <Link className="link" to={`/shipments/${row.id}/risk`}>
                      risk
                    </Link>
                  </div>
                ),
              },
            ]}
            rows={shipments.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </Card>

      <Card title="Temperature policies" subtitle="Configurable and versioned (D7). Values are illustrative placeholders, not regulatory limits.">
        {policies.loading ? <LoadingSkeleton rows={3} /> : null}
        {policies.error ? <ErrorState error={policies.error} onRetry={policies.refresh} /> : null}
        {policies.data && policies.data.count === 0 ? <EmptyState title="No policies configured" /> : null}
        {policies.data && policies.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "id", header: "Policy" },
              { key: "cargo_type", header: "Cargo" },
              { key: "range", header: "Range °C", render: (row) => `${row.min_c} … ${row.max_c}` },
              { key: "tolerance", header: "Tolerance (min)", render: (row) => row.max_excursion_minutes },
              { key: "critical", header: "Critical duration (min)", render: (row) => row.critical_duration_minutes },
              { key: "version", header: "Version", render: (row) => `v${row.version}` },
              {
                key: "edit",
                header: "",
                render: (row) => (
                  <button type="button" className="link" onClick={() => openEditor(row)}>
                    edit
                  </button>
                ),
              },
            ]}
            rows={policies.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </Card>

      {selectedPolicy ? (
        <Card
          title={`Edit policy · ${selectedPolicy.cargo_type} (v${selectedPolicy.version})`}
          subtitle="Saving creates a new version; the previous version is retained and the change is audited."
          actions={
            <button type="button" onClick={() => setSelectedPolicy(null)}>
              Close
            </button>
          }
        >
          <PolicyEditor
            policy={selectedPolicy}
            onUpdated={(updated) => {
              setToast({ message: `${updated.id} saved (v${updated.version}).`, tone: "ok" });
              setSelectedPolicy(null);
              policies.refresh();
            }}
          />
        </Card>
      ) : null}

      {alerts.data && alerts.data.data.some((row) => row.type === "sensor_failure") ? (
        <Banner tone="warn" title="Some sensors are not reporting">
          Historical fixtures age out after the anchor time; run the simulator (POST /api/sensor-readings) for live
          feeds. This is the backend sensor-failure state, not a UI error.
        </Banner>
      ) : null}

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
