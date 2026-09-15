import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import {
  alertsList,
  excursionsList,
  policies,
  readings,
  risk,
  shipmentsList,
} from "./fixtures.js";
import { ColdChainScreen } from "../src/screens/ColdChainScreen.jsx";
import { TemperatureHistoryScreen } from "../src/screens/TemperatureHistoryScreen.jsx";
import { ExcursionDetailScreen } from "../src/screens/ExcursionDetailScreen.jsx";
import { SensorHealthScreen } from "../src/screens/SensorHealthScreen.jsx";
import { RiskExplanationScreen } from "../src/screens/RiskExplanationScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S8 Cold-chain monitoring", () => {
  it("renders excursion and sensor-failure alerts plus policies", async () => {
    mockFetch([
      { match: "/api/alerts/coldchain", payload: alertsList },
      { match: "/api/temperature-policies", payload: policies },
      { match: "/api/shipments", payload: shipmentsList },
    ]);
    renderAt(<ColdChainScreen />, { route: "/coldchain", path: "/coldchain" });
    expect(await screen.findByText("S038")).toBeInTheDocument();
    expect(screen.getByText("Excursion")).toBeInTheDocument();
    expect(screen.getByText("Sensor failure")).toBeInTheDocument();
    expect(screen.getByText("TP-VACCINE")).toBeInTheDocument();
    expect(screen.getByText(/sensors are not reporting/i)).toBeInTheDocument();
  });

  it("shows the no-alerts empty state", async () => {
    mockFetch([
      { match: "/api/alerts/coldchain", payload: { data: [], count: 0 } },
      { match: "/api/temperature-policies", payload: policies },
      { match: "/api/shipments", payload: shipmentsList },
    ]);
    renderAt(<ColdChainScreen />, { route: "/coldchain", path: "/coldchain" });
    expect(await screen.findByText(/no active cold-chain alerts/i)).toBeInTheDocument();
  });
});

describe("S9 Temperature history", () => {
  it("renders the quality block, policy bounds and excursion table", async () => {
    mockFetch([
      { match: "/api/excursions", payload: excursionsList },
      { match: "/api/shipments/S026/sensor-readings", payload: readings },
    ]);
    renderAt(<TemperatureHistoryScreen />, { route: "/shipments/S026/temperature", path: "/shipments/:id/temperature" });
    expect(await screen.findByText("Reporting")).toBeInTheDocument();
    expect(screen.getByText("2 … 8 °C")).toBeInTheDocument();
    expect(screen.getByText("EX-0001")).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
  });

  it("surfaces a failed sensor as a review state", async () => {
    mockFetch([
      { match: "/api/excursions", payload: { data: [], count: 0 } },
      {
        match: "/api/shipments/S031/sensor-readings",
        payload: { ...readings, sensor: { ...readings.sensor, status: "failed", minutes_since_last: 600 } },
      },
    ]);
    renderAt(<TemperatureHistoryScreen />, { route: "/shipments/S031/temperature", path: "/shipments/:id/temperature" });
    expect(await screen.findByText(/sensor failed/)).toBeInTheDocument();
  });
});

describe("S10 Excursion detail", () => {
  it("renders classification, rationale and review actions", async () => {
    mockFetch([{ match: "/api/excursions", payload: excursionsList }]);
    renderAt(<ExcursionDetailScreen />, { route: "/excursions/EX-0001", path: "/excursions/:id" });
    expect(await screen.findByText(/excursion EX-0001/i)).toBeInTheDocument();
    expect(screen.getByText(/duration>tolerance;magnitude<=major/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("handles an unknown excursion id", async () => {
    mockFetch([{ match: "/api/excursions", payload: { data: [], count: 0 } }]);
    renderAt(<ExcursionDetailScreen />, { route: "/excursions/EX-9999", path: "/excursions/:id" });
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0);
  });
});

describe("S11 Sensor health", () => {
  it("lists per-shipment sensor status from the backend block", async () => {
    mockFetch([
      { match: "/api/shipments/S026/sensor-readings", payload: readings },
      { match: "/api/shipments", payload: shipmentsList },
    ]);
    renderAt(<SensorHealthScreen />, { route: "/sensors", path: "/sensors" });
    expect(await screen.findByText("SEN-026")).toBeInTheDocument();
    expect(screen.getByText("Reporting")).toBeInTheDocument();
  });
});

describe("S12 Risk explanation", () => {
  it("renders the nested factors, weights and review banner", async () => {
    mockFetch([{ match: "/api/shipments/S039/risk", payload: risk }]);
    renderAt(<RiskExplanationScreen />, { route: "/shipments/S039/risk", path: "/shipments/:id/risk" });
    expect(await screen.findByText("73%")).toBeInTheDocument();
    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.getByText("Weights")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("EX-0002")).toBeInTheDocument();
  });
});

