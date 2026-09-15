import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, FilterBar, FilterField, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, StatusBadge } from "../components/display.jsx";
import { DisruptionForm } from "../components/domain.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, Toast } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function DisruptionsScreen() {
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const disruptions = useApi(
    () => api.listDisruptions({ status: statusFilter || undefined, limit: 100 }),
    [statusFilter],
  );

  const transition = async (row, nextStatus) => {
    try {
      await api.updateDisruption(row.id, { status: nextStatus });
      setToast({ message: `${row.id} set to ${nextStatus}.`, tone: "ok" });
      disruptions.refresh();
    } catch (error) {
      setToast({ message: error.message, tone: error.isConflict() ? "warn" : "danger" });
    }
  };

  const columns = [
    {
      key: "id",
      header: "ID",
      render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, letterSpacing: "0.01em" }}>{row.id}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <span className="badge neutral no-dot" style={{ textTransform: "none", fontSize: 11 }}>{row.type.replace(/_/g, " ")}</span>,
    },
    { key: "region_code", header: "Region" },
    { key: "severity", header: "Sev" },
    {
      key: "window",
      header: "Window",
      render: (row) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
          {formatDateTime(row.start_time)} → {row.end_time ? formatDateTime(row.end_time) : "open"}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
    {
      key: "currently_active",
      header: "Active now",
      render: (row) => (row.is_currently_active ? <StatusBadge value="active" /> : <span className="muted small">—</span>),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="row">
          <button type="button" className="link" onClick={() => navigate(`/disruptions/${row.id}/affected`)}>
            affected →
          </button>
          {row.status === "scheduled" ? (
            <button type="button" className="link" onClick={() => transition(row, "active")}>
              activate
            </button>
          ) : null}
          {row.status === "active" ? (
            <button type="button" className="link" onClick={() => transition(row, "resolved")}>
              resolve
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Disruptions"
        subtitle="Create and manage events that drive impact analysis"
        actions={
          <>
            <RefreshButton onClick={disruptions.refresh} loading={disruptions.loading} />
            <button type="button" className="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "Create disruption"}
            </button>
          </>
        }
      />

      {showForm ? (
        <Card title="Create disruption" subtitle="Validated server-side; duplicates are rejected with 409">
          <DisruptionForm
            onCreated={(created) => {
              setToast({ message: `${created.id} created.`, tone: "ok" });
              setShowForm(false);
              disruptions.refresh();
            }}
          />
        </Card>
      ) : null}

      <Card
        title="All Disruptions"
        subtitle="is_currently_active is computed by the backend window rule"
        actions={
          <FilterBar>
            <FilterField label="Status">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">all</option>
                <option value="active">active</option>
                <option value="scheduled">scheduled</option>
                <option value="resolved">resolved</option>
              </select>
            </FilterField>
          </FilterBar>
        }
      >
        {disruptions.loading ? <LoadingSkeleton rows={4} /> : null}
        {disruptions.error ? <ErrorState error={disruptions.error} onRetry={disruptions.refresh} /> : null}
        {disruptions.data && disruptions.data.count === 0 ? (
          <EmptyState title="No disruptions recorded" message="Create one to start the impact analysis." />
        ) : null}
        {disruptions.data && disruptions.data.count > 0 ? (
          <DataTable columns={columns} rows={disruptions.data.data} rowKey={(row) => row.id} />
        ) : null}
      </Card>

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
