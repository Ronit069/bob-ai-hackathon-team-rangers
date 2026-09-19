// Groq provider (OpenAI-compatible chat completions). The API key is sent only in the
// Authorization header and never appears in errors or logs.

import { config } from "../../common/config.js";
import { ProviderError, emptyAnswerError, requestJson } from "../providerError.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function createGroqProvider({
  apiKey = config.groq.apiKey,
  modelId = config.groq.modelId,
  timeoutMs = config.aiBriefProviderTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const available = Boolean(apiKey);

  return {
    name: "groq",
    available,
    modelId,
    async generate({ system, prompt }) {
      if (!available) {
        throw new ProviderError("provider_not_configured", "Groq API key is not configured");
      }
      const payload = await requestJson({
        fetchImpl,
        url: GROQ_URL,
        options: {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            temperature: 0,
            max_tokens: 2048,
          }),
        },
        timeoutMs,
        providerLabel: "Groq",
      });

      const content = payload?.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      if (text === "") throw emptyAnswerError("Groq");
      return { text, tool_calls: 0 };
    },
  };
}
