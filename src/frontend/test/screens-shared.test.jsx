import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import { alertsList, auditList, bobAnswer, bobUnavailable, disruptionsList, riskOverview } from "./fixtures.js";
import { OverviewScreen } from "../src/screens/OverviewScreen.jsx";
import { BobChatScreen } from "../src/screens/BobChatScreen.jsx";
import { AuditScreen } from "../src/screens/AuditScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S1 Overview", () => {
  it("renders the ranked worklist and active disruptions", async () => {
    mockFetch([
      { match: "/api/risk/overview", payload: riskOverview },
      { match: "/api/alerts/coldchain", payload: alertsList },
      { match: "/api/disruptions", payload: disruptionsList },
    ]);
    renderAt(<OverviewScreen />, { route: "/", path: "/" });
    expect((await screen.findAllByText("S039")).length).toBeGreaterThan(0);
    expect(screen.getByText("D01")).toBeInTheDocument();
    expect(screen.getByText("Excursion alerts")).toBeInTheDocument();
    expect(screen.getByText("Sensor-failure alerts")).toBeInTheDocument();
  });

  it("shows the no-risk empty state", async () => {
    mockFetch([
      { match: "/api/risk/overview", payload: { data: [], count: 0 } },
      { match: "/api/alerts/coldchain", payload: { data: [], count: 0 } },
      { match: "/api/disruptions", payload: { data: [], count: 0 } },
    ]);
    renderAt(<OverviewScreen />, { route: "/", path: "/" });
    expect(await screen.findByText(/no active risk items/i)).toBeInTheDocument();
    expect(screen.getByText(/no active disruptions/i)).toBeInTheDocument();
  });
});

describe("S13 Bob chat", () => {
  it("renders the grounded answer with the evidence panel", async () => {
    mockFetch([{ match: "/api/bob/query", payload: bobAnswer, status: 200 }]);
    renderAt(<BobChatScreen />, { route: "/chat", path: "/chat" });
    fireEvent.change(screen.getByPlaceholderText(/which shipments are affected/i), {
      target: { value: "Which shipments are affected by the port strike?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    expect(await screen.findByText(/3 shipments are affected/i)).toBeInTheDocument();
    expect(screen.getAllByText(/get_affected_shipments/).length).toBeGreaterThan(0);
    expect(screen.getByText(/raw tool output/i)).toBeInTheDocument();
  });

  it("treats the 503 as a first-class fallback state (no fake answers)", async () => {
    mockFetch([{ match: "/api/bob/query", payload: bobUnavailable, status: 503 }]);
    renderAt(<BobChatScreen />, { route: "/chat", path: "/chat" });
    fireEvent.change(screen.getByPlaceholderText(/which shipments are affected/i), {
      target: { value: "Give me an action plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
    expect(await screen.findByText(/bob is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/fully functional/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/which shipments are affected/i)).toBeDisabled();
  });
});

describe("S14 Audit", () => {
  it("renders audit records with actions", async () => {
    mockFetch([{ match: "/api/audit", payload: auditList }]);
    renderAt(<AuditScreen />, { route: "/audit", path: "/audit" });
    expect((await screen.findAllByText("REC-0001")).length).toBeGreaterThan(0);
    expect(screen.getByText(/decided accepted/)).toBeInTheDocument();
    expect(screen.getAllByText("operator-1").length).toBeGreaterThan(0);
  });

  it("shows the empty state when nothing is recorded", async () => {
    mockFetch([{ match: "/api/audit", payload: { data: [], count: 0 } }]);
    renderAt(<AuditScreen />, { route: "/audit", path: "/audit" });
    expect(await screen.findByText(/no decisions recorded yet/i)).toBeInTheDocument();
  });
});

