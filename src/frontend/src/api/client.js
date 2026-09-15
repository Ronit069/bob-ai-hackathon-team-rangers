// Thin REST client — same-origin /api (Vite dev proxy), no business logic,
// no scoring, no data transformation beyond JSON parsing and error normalisation.

import { ApiError } from "./ApiError.js";

const BASE = "/api";

export function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return `${BASE}${path}${suffix ? `?${suffix}` : ""}`;
}

export async function request(path, { method = "GET", query, body } = {}) {
  const url = buildUrl(path, query);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the backend API", {
      detail: error.message,
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload?.error ?? {};
    throw new ApiError(
      response.status,
      envelope.code ?? "INTERNAL_ERROR",
      envelope.message ?? `Request failed (HTTP ${response.status})`,
      envelope.details ?? {},
    );
  }

  return payload;
}
