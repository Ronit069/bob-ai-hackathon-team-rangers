import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUrl, request } from "./client.js";
import { ApiError } from "./ApiError.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse({ ok = true, status = 200, payload = {} }) {
  return { ok, status, json: async () => payload };
}

describe("buildUrl", () => {
  it("drops undefined, null and empty values", () => {
    expect(
      buildUrl("/shipments", { status: "in_transit", is_cold_chain: undefined, limit: null, region_code: "" }),
    ).toBe("/api/shipments?status=in_transit");
  });

  it("returns the bare path when there is no query", () => {
    expect(buildUrl("/health")).toBe("/api/health");
  });
});

describe("request", () => {
  it("returns parsed JSON on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({ payload: { data: [], count: 0 } }));
    await expect(request("/shipments")).resolves.toEqual({ data: [], count: 0 });
  });

  it("throws ApiError preserving the backend validation envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        payload: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            details: { issues: [{ path: "region_code", message: "must be valid" }] },
          },
        },
      }),
    );
    try {
      await request("/disruptions", { method: "POST", body: {} });
      expect.unreachable("expected a validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.isValidation()).toBe(true);
      expect(error.details.issues[0].path).toBe("region_code");
    }
  });

  it("classifies 404, 409 and 503 errors", async () => {
    const cases = [
      { status: 404, code: "NOT_FOUND", check: (error) => error.isNotFound() },
      { status: 409, code: "CONFLICT", check: (error) => error.isConflict() },
      { status: 503, code: "BOB_UNAVAILABLE", check: (error) => error.isBobUnavailable() },
    ];
    for (const item of cases) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ ok: false, status: item.status, payload: { error: { code: item.code, message: "x", details: {} } } }),
      );
      try {
        await request("/x");
        expect.unreachable("expected an error");
      } catch (error) {
        expect(item.check(error)).toBe(true);
      }
      vi.restoreAllMocks();
    }
  });

  it("maps a network failure to a NETWORK_ERROR ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    try {
      await request("/health");
      expect.unreachable("expected a network error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(0);
      expect(error.code).toBe("NETWORK_ERROR");
    }
  });
});
