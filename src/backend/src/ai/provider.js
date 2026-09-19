import { config } from "../common/config.js";
import { ProviderError } from "./providerError.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createGroqProvider } from "./providers/groq.js";
import { createWatsonxProvider } from "./providers/watsonx.js";

// Re-exported so existing imports (`./provider.js`) keep working.
export { ProviderError } from "./providerError.js";

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
  const configured = Boolean(watsonx?.configured);
  return {
    provider: "granite_watsonx",
    model_id: watsonx?.modelId ?? "ibm/granite-4-h-small",
    configured,
    available: configured,
    reason: configured ? null : "provider_not_configured",
    missing,
  };
}

// Default provider selection for the AI infrastructure (Bob Chat + Incident Commander).
// `AI_PROVIDER=auto` (default) keeps Feature 1 backward compatibility: an explicitly
// configured BOB_API_URL gateway wins, then Granite/watsonx, then Gemini, then Groq.
// `AI_PROVIDER=watsonx|gemini|groq|bob_gateway|none` forces a specific choice.
export function resolveDefaultProvider({
  apiUrl = config.bobApiUrl,
  apiKey = config.bobApiKey,
  watsonx = config.watsonx,
  gemini = config.gemini,
  groq = config.groq,
  selection = config.aiProvider,
  fetchImpl = fetch,
} = {}) {
  const explicit = String(selection ?? "auto").trim().toLowerCase();

  const watsonxProvider = () =>
    watsonx?.configured
      ? createWatsonxProvider({
          apiKey: watsonx.apiKey,
          projectId: watsonx.projectId,
          url: watsonx.url,
          modelId: watsonx.modelId,
          fetchImpl,
        })
      : createDisabledProvider("provider_not_configured", "Granite/watsonx configuration is incomplete");

  const geminiProvider = () =>
    gemini?.apiKey
      ? createGeminiProvider({ apiKey: gemini.apiKey, modelId: gemini.modelId, fetchImpl })
      : createDisabledProvider("provider_not_configured", "GEMINI_API_KEY is not configured");

  const groqProvider = () =>
    groq?.apiKey
      ? createGroqProvider({ apiKey: groq.apiKey, modelId: groq.modelId, fetchImpl })
      : createDisabledProvider("provider_not_configured", "GROQ_API_KEY is not configured");

  if (explicit === "none") {
    return createDisabledProvider("provider_not_configured", "AI providers are disabled (AI_PROVIDER=none)");
  }
  if (explicit === "watsonx") return watsonxProvider();
  if (explicit === "gemini") return geminiProvider();
  if (explicit === "groq") return groqProvider();
  if (explicit === "bob_gateway") {
    return apiUrl
      ? createHttpProvider({ apiUrl, apiKey, fetchImpl })
      : createDisabledProvider("provider_not_configured", "BOB_API_URL is not configured");
  }
  if (explicit !== "auto") {
    return createDisabledProvider("provider_not_configured", `Unknown AI_PROVIDER "${explicit}"`);
  }

  if (apiUrl) return createHttpProvider({ apiUrl, apiKey, fetchImpl });
  if (watsonx?.configured) return watsonxProvider();
  if (gemini?.apiKey) return geminiProvider();
  if (groq?.apiKey) return groqProvider();
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
