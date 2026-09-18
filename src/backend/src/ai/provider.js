import { config } from "../common/config.js";

export class ProviderError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.reason = reason;
    this.details = details;
  }
}

export function createDisabledProvider(
  reason = "provider_not_configured",
  message = "No AI provider is configured",
) {
  return {
    name: "none",
    available: false,
    reason,
    async generate() {
      throw new ProviderError(reason, message);
    },
  };
}

// Safe view of the Granite/watsonx boundary: exposes only non-secret status fields.
// Never returns the API key or any other credential.
export function graniteRuntimeStatus({ watsonx = config.watsonx } = {}) {
  const missing = [...(watsonx?.missing ?? [])];
  return {
    provider: "granite_watsonx",
    model_id: watsonx?.modelId ?? "ibm/granite-3-8b-instruct",
    configured: Boolean(watsonx?.configured),
    // The watsonx runtime adapter is deliberately not implemented yet; configuration
    // is wired and validated, but no Granite request is ever attempted.
    available: false,
    reason: watsonx?.configured ? "granite_runtime_pending" : "provider_not_configured",
    missing,
  };
}

// Default provider selection for the existing AI infrastructure.
// Precedence (backward compatible with Feature 1):
//   1. BOB_API_URL gateway (current working path)
//   2. Granite configured but runtime pending -> controlled unavailable provider
//   3. nothing configured -> controlled unavailable provider
export function resolveDefaultProvider({
  apiUrl = config.bobApiUrl,
  apiKey = config.bobApiKey,
  watsonx = config.watsonx,
} = {}) {
  if (apiUrl) return createHttpProvider({ apiUrl, apiKey });
  if (watsonx?.configured) {
    return createDisabledProvider(
      "granite_runtime_pending",
      "Granite configuration is present but the watsonx runtime adapter is not implemented yet",
    );
  }
  return createDisabledProvider();
}

export function createHttpProvider({
  apiUrl = config.bobApiUrl,
  apiKey = config.bobApiKey,
  timeoutMs = config.aiBriefProviderTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  return {
    name: "bob_http",
    available: Boolean(apiUrl),
    async generate({ system, prompt }) {
      if (!apiUrl) {
        throw new ProviderError("provider_not_configured", "No AI provider endpoint is configured");
      }

      let response;
      try {
        response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ prompt, system, context: {} }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.code === "ABORT_ERR" || error?.name === "AbortError") {
          throw new ProviderError("provider_timeout", "AI provider timed out", { timeout_ms: timeoutMs });
        }
        throw new ProviderError("provider_unreachable", "AI provider is unreachable", { detail: error?.message });
      }

      if (!response.ok) {
        throw new ProviderError("provider_error", `AI provider responded with ${response.status}`, {
          status: response.status,
        });
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderError("provider_invalid_response", "AI provider returned a non-JSON response");
      }

      const text = typeof payload?.answer === "string" ? payload.answer : "";
      if (text.trim() === "") {
        throw new ProviderError("provider_empty_response", "AI provider returned an empty answer");
      }
      return { text, tool_calls: payload.tool_calls ?? 0 };
    },
  };
}
