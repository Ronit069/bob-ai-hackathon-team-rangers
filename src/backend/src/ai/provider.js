import { config } from "../common/config.js";

export class ProviderError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.reason = reason;
    this.details = details;
  }
}

export function createDisabledProvider() {
  return {
    name: "none",
    available: false,
    async generate() {
      throw new ProviderError("provider_not_configured", "No AI provider is configured");
    },
  };
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
