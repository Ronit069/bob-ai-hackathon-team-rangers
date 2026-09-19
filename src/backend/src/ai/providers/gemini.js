// Google Gemini provider (generateContent). The API key is sent only in the
// x-goog-api-key header and never appears in errors or logs.

import { config } from "../../common/config.js";
import { ProviderError, emptyAnswerError, requestJson } from "../providerError.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function createGeminiProvider({
  apiKey = config.gemini.apiKey,
  modelId = config.gemini.modelId,
  timeoutMs = config.aiBriefProviderTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const available = Boolean(apiKey);

  return {
    name: "gemini",
    available,
    modelId,
    async generate({ system, prompt }) {
      if (!available) {
        throw new ProviderError("provider_not_configured", "Gemini API key is not configured");
      }
      const payload = await requestJson({
        fetchImpl,
        url: `${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent`,
        options: {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 2048 },
          }),
        },
        timeoutMs,
        providerLabel: "Gemini",
      });

      const text = (payload?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();
      if (text === "") throw emptyAnswerError("Gemini");
      return { text, tool_calls: 0 };
    },
  };
}
