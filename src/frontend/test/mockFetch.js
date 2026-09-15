import { vi } from "vitest";

// Route-aware fetch mock: [{ match: "substring", payload, status? }]
// Unknown URLs return a 404 error envelope so missing fixtures fail loudly.
export function mockFetch(routes) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    const route = routes.find((entry) => target.includes(entry.match));
    if (!route) {
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: "NOT_FOUND", message: `No fixture for ${target}`, details: {} },
        }),
      };
    }
    const status = route.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => route.payload,
    };
  });
}
