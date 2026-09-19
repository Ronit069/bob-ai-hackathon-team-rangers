// IBM watsonx.ai / Granite provider: API key -> IAM token -> text/chat.
// Documented IBM endpoints only; credentials never leave the server and never appear in errors.

import { config } from "../../common/config.js";
import { ProviderError, emptyAnswerError, requestJson } from "../providerError.js";

const IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token";
const IAM_GRANT = "urn:ibm:params:oauth:grant-type:apikey";

export function createWatsonxProvider({
  apiKey = config.watsonx.apiKey,
  projectId = config.watsonx.projectId,
  url = config.watsonx.url,
  modelId = config.watsonx.modelId,
  version = config.watsonxApiVersion,
  timeoutMs = config.aiBriefProviderTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const available = Boolean(apiKey && projectId && url);
  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function accessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    const body = new URLSearchParams({ grant_type: IAM_GRANT, apikey: apiKey });
    const payload = await requestJson({
      fetchImpl,
      url: IAM_TOKEN_URL,
      options: {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
      },
      timeoutMs,
      providerLabel: "IBM IAM",
    });
    const token = payload?.access_token;
    if (!token) throw new ProviderError("provider_error", "IBM IAM returned no access token");
    const expiresIn = Number(payload?.expires_in) || 3600;
    cachedToken = token;
    tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    return cachedToken;
  }

  return {
    name: "granite_watsonx",
    available,
    modelId,
    async generate({ system, prompt }) {
      if (!available) {
        throw new ProviderError("provider_not_configured", "Granite/watsonx configuration is incomplete");
      }
      const token = await accessToken();
      const payload = await requestJson({
        fetchImpl,
        url: `${url}/ml/v1/text/chat?version=${encodeURIComponent(version)}`,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model_id: modelId,
            project_id: projectId,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            parameters: { max_new_tokens: 2048, temperature: 0 },
          }),
        },
        timeoutMs,
        providerLabel: "Granite",
      });

      const content = payload?.choices?.[0]?.message?.content;
      const text = Array.isArray(content)
        ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
        : typeof content === "string"
          ? content
          : "";
      if (text.trim() === "") throw emptyAnswerError("Granite");
      return { text, tool_calls: 0 };
    },
  };
}
