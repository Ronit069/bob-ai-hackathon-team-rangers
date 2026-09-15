import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import {
  affectedList,
  disruptionsList,
  fleetList,
  idleList,
  redeploymentCandidates,
  routeAlternatives,
  carrierAlternatives,
  shipmentDetail,
} from "./fixtures.js";
import { DisruptionsScreen } from "../src/screens/DisruptionsScreen.jsx";
import { AffectedShipmentsScreen } from "../src/screens/AffectedShipmentsScreen.jsx";
import { ShipmentDetailScreen } from "../src/screens/ShipmentDetailScreen.jsx";
import { AlternativesScreen } from "../src/screens/AlternativesScreen.jsx";
import { FleetScreen } from "../src/screens/FleetScreen.jsx";
import { RedeploymentScreen } from "../src/screens/RedeploymentScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S2 Disruptions", () => {
  it("renders the disruption list with the computed active flag", async () => {
    mockFetch([{ match: "/api/disruptions", payload: disruptionsList }]);
    renderAt(<DisruptionsScreen />, { route: "/disruptions", path: "/disruptions" });
    expect(await screen.findByText("D01")).toBeInTheDocument();
    expect(screen.getByText("port strike")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /create disruption/i })).toBeInTheDocument();
  });

  it("shows the empty state when no disruptions exist", async () => {
    mockFetch([{ match: "/api/disruptions", payload: { data: [], count: 0 } }]);
    renderAt(<DisruptionsScreen />, { route: "/disruptions", path: "/disruptions" });
    expect(await screen.findByText(/no disruptions recorded/i)).toBeInTheDocument();
  });
});

describe("S3 Affected shipments", () => {
  it("renders the ranked list with match reason and impact status", async () => {
    mockFetch([
      { match: "/api/disruptions/D01/affected-shipments", payload: affectedList },
      { match: "/api/disruptions", payload: disruptionsList },
    ]);
    renderAt(<AffectedShipmentsScreen />, { route: "/disruptions/D01/affected", path: "/disruptions/:id/affected" });
    expect(await screen.findByText("S001")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText(/currently_in_affected_segment/)).toBeInTheDocument();
  });

  it("shows a valid no-impact empty state", async () => {
    mockFetch([
      { match: "/api/disruptions/D01/affected-shipments", payload: { data: [], count: 0, disruption_id: "D01" } },
      { match: "/api/disruptions", payload: disruptionsList },
    ]);
    renderAt(<AffectedShipmentsScreen />, { route: "/disruptions/D01/affected", path: "/disruptions/:id/affected" });
    expect(await screen.findByText(/no shipments affected by this disruption/i)).toBeInTheDocument();
  });
});

describe("S4 Shipment detail", () => {
  it("renders the route tab from backend data", async () => {
    mockFetch([{ match: "/api/shipments/S001", payload: shipmentDetail }]);
    renderAt(<ShipmentDetailScreen />, { route: "/shipments/S001", path: "/shipments/:id" });
    expect(await screen.findByText(/shipment S001/i)).toBeInTheDocument();
    expect(screen.getByText("INMUM → AEJEA · carrier BlueWave Shipping")).toBeInTheDocument();
    expect(screen.getAllByText("220").length).toBeGreaterThan(0);
  });
});

describe("S5 Alternatives", () => {
  it("renders ranked options with reasons and rejected candidates", async () => {
    mockFetch([
      { match: "/api/shipments/S040/route-alternatives", payload: routeAlternatives },
      { match: "/api/shipments/S040", payload: { ...shipmentDetail, id: "S040", status: "in_transit" } },
    ]);
    renderAt(<AlternativesScreen />, { route: "/shipments/S040/alternatives", path: "/shipments/:id/alternatives" });
    expect(await screen.findByText("R006")).toBeInTheDocument();
    expect(screen.getByText(/capacity margin 25%/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/disrupted region overlap/)).toBeInTheDocument());
  });

  it("shows the no-option state with grouped rejection reasons", async () => {
    mockFetch([
      { match: "/api/shipments/S004/route-alternatives", payload: { data: [], rejected: [{ route_id: "R002", rejected_reason: "disrupted_region_overlap" }], count: 0 } },
      { match: "/api/shipments/S004", payload: { ...shipmentDetail, id: "S004" } },
    ]);
    renderAt(<AlternativesScreen />, { route: "/shipments/S004/alternatives", path: "/shipments/:id/alternatives" });
    expect(await screen.findByText(/no feasible alternatives/i)).toBeInTheDocument();
  });

  it("renders carrier tab rejections (inactive carrier)", async () => {
    mockFetch([
      { match: "/api/shipments/S006/carrier-alternatives", payload: carrierAlternatives },
      { match: "/api/shipments/S006", payload: { ...shipmentDetail, id: "S006" } },
    ]);
    renderAt(<AlternativesScreen />, { route: "/shipments/S006/alternatives?tab=carriers", path: "/shipments/:id/alternatives" });
    expect(await screen.findByText("C09")).toBeInTheDocument();
    expect(screen.getAllByText(/carrier inactive/).length).toBeGreaterThan(0);
  });
});

describe("S6 Fleet", () => {
  it("renders derived states and anomaly flags", async () => {
    mockFetch([
      { match: "/api/fleet/idle", payload: idleList },
      { match: "/api/fleet", payload: fleetList },
    ]);
    renderAt(<FleetScreen />, { route: "/fleet", path: "/fleet" });
    expect(await screen.findByText("A007")).toBeInTheDocument();
    expect(screen.getByText(/missing availability timestamp/)).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
  });

  it("renders the idle tab with exclusion reasons", async () => {
    mockFetch([
      { match: "/api/fleet/idle", payload: idleList },
      { match: "/api/fleet", payload: fleetList },
    ]);
    renderAt(<FleetScreen />, { route: "/fleet?tab=idle", path: "/fleet" });
    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(screen.getByText("A002")).toBeInTheDocument();
    expect(screen.getByText("reserved")).toBeInTheDocument();
  });
});

describe("S7 Redeployment", () => {
  it("renders ranked candidates, contention and rejection reasons", async () => {
    mockFetch([
      { match: "/api/shipments/S039/redeployment-candidates", payload: redeploymentCandidates },
      { match: "/api/shipments/S039", payload: { ...shipmentDetail, id: "S039" } },
    ]);
    renderAt(<RedeploymentScreen />, { route: "/shipments/S039/redeployment", path: "/shipments/:id/redeployment" });
    expect(await screen.findByText(/A021/)).toBeInTheDocument();
    expect(screen.getAllByText(/allocate manually/).length).toBeGreaterThan(0);
    expect(screen.getByText(/outside radius/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create pending recommendation/i })).toBeInTheDocument();
  });
});


