// Shared AI-provider error type and HTTP helper (Feature 2 / LLM runtime).
// Credentials are never included in errors, details or messages.

export class ProviderError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.reason = reason;
    this.details = details;
  }
}

// One JSON request with classified failures. Never includes request headers/body in errors.
export async function requestJson({
  fetchImpl = fetch,
  url,
  options = {},
  timeoutMs = 15000,
  providerLabel = "AI provider",
} = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.code === "ABORT_ERR" || error?.name === "AbortError") {
      throw new ProviderError("provider_timeout", `${providerLabel} timed out`, { timeout_ms: timeoutMs });
    }
    throw new ProviderError("provider_unreachable", `${providerLabel} is unreachable`, { detail: error?.message });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // OpenAI-style {error:{message}}, watsonx-style {errors:[{message}]}, Gemini-style {error:{message}}
    const detail = body?.error?.message ?? body?.errors?.[0]?.message ?? body?.message ?? null;
    let reason = "provider_error";
    if (response.status === 429) reason = "provider_rate_limited";
    else if (response.status === 403 && /quota/i.test(detail ?? "")) reason = "provider_quota_exceeded";
    throw new ProviderError(reason, `${providerLabel} responded with ${response.status}`, {
      status: response.status,
      ...(detail ? { detail } : {}),
    });
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderError("provider_invalid_response", `${providerLabel} returned a non-JSON response`);
  }
}

export function emptyAnswerError(providerLabel = "AI provider") {
  return new ProviderError("provider_empty_response", `${providerLabel} returned an empty answer`);
}
