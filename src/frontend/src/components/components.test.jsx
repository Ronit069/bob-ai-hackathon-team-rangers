import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EmptyState,
  ErrorState,
  FieldErrors,
  LoadingSkeleton,
  NotActionableBanner,
  UnknownReviewBanner,
} from "./states.jsx";
import { DataTable, EvidencePanel, ScoreBar, StatusBadge } from "./display.jsx";
import { ApiError } from "../api/ApiError.js";

describe("state components", () => {
  it("LoadingSkeleton exposes a status region", () => {
    render(<LoadingSkeleton rows={3} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("EmptyState renders the title, message and action", () => {
    render(<EmptyState title="No disruptions recorded" message="Create one." action={<button>Go</button>} />);
    expect(screen.getByText("No disruptions recorded")).toBeInTheDocument();
    expect(screen.getByText("Create one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("ErrorState renders the code/message and triggers retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError(500, "INTERNAL_ERROR", "Unexpected server error")} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("INTERNAL_ERROR");
    expect(screen.getByRole("alert")).toHaveTextContent("Unexpected server error");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("UnknownReviewBanner never claims the cargo is safe", () => {
    render(<UnknownReviewBanner reason="missing_readings_in_window" />);
    expect(screen.getByText(/unknown \/ review required/i)).toBeInTheDocument();
    expect(screen.getByText(/do not assume the cargo is safe/i)).toBeInTheDocument();
  });

  it("NotActionableBanner explains read-only state", () => {
    render(<NotActionableBanner reason="delivered" />);
    expect(screen.getByText(/not actionable \(delivered\)/i)).toBeInTheDocument();
  });

  it("FieldErrors lists backend validation issues", () => {
    const error = new ApiError(400, "VALIDATION_ERROR", "Invalid input", {
      issues: [{ path: "region_code", message: "must be a valid region" }],
    });
    render(<FieldErrors error={error} />);
    expect(screen.getByText(/region_code/)).toBeInTheDocument();
    expect(screen.getByText(/must be a valid region/)).toBeInTheDocument();
  });
});

describe("display components", () => {
  it("StatusBadge maps known values and humanises unknown ones", () => {
    const { rerender } = render(<StatusBadge value="unknown_review" />);
    expect(screen.getByText(/unknown \/ review/i)).toBeInTheDocument();
    rerender(<StatusBadge value="something_new" />);
    expect(screen.getByText(/something new/i)).toBeInTheDocument();
  });

  it("ScoreBar renders the backend score as a display percentage", () => {
    render(<ScoreBar score={0.856} />);
    expect(screen.getByText("86%")).toBeInTheDocument();
  });

  it("EvidencePanel shows the tool name, input and raw output JSON", () => {
    render(
      <EvidencePanel
        evidence={[{ tool: "get_active_disruptions", input: { a: 1 }, output: { data: [], count: 0 } }]}
      />,
    );
    expect(screen.getByText(/get_active_disruptions/)).toBeInTheDocument();
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/"count": 0/)).toBeInTheDocument();
  });

  it("DataTable renders rows and the empty message", () => {
    const { rerender } = render(
      <DataTable columns={[{ key: "id", header: "ID" }]} rows={[{ id: "X1" }]} rowKey={(row) => row.id} />,
    );
    expect(screen.getByText("X1")).toBeInTheDocument();
    rerender(<DataTable columns={[{ key: "id", header: "ID" }]} rows={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});


