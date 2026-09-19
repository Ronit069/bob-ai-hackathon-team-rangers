# AI provider configuration (watsonx / Gemini / Groq)

Bob Chat and the AI Incident Commander use a **real LLM** to choose the frozen read-only
MCP tools and to write the answers/summaries. The provider layer lives behind the existing
abstraction in `src/backend/src/ai/provider.js`; credentials stay server-side and are never
returned by APIs, logged, or bundled into the frontend.

## Provider selection

```env
# auto = BOB_API_URL gateway > watsonx > gemini > groq; or force one:
# AI_PROVIDER=watsonx | gemini | groq | bob_gateway | none
AI_PROVIDER=auto
AI_AGENT_MAX_TOOL_CALLS=6
AI_AGENT_MAX_PROMPT_CHARS=30000
```

With no provider configured the features still work in deterministic fallback mode and the
response is explicitly labelled `DETERMINISTIC_FALLBACK` (`source: deterministic`).

## IBM watsonx.ai / Granite (preferred)

| Variable | Meaning | Required | Secret |
|---|---|---|---|
| `WATSONX_API_KEY` | IBM Cloud API key (exchanged for an IAM token server-side) | Yes | Yes |
| `WATSONX_PROJECT_ID` | watsonx.ai project that scopes the model | Yes | No |
| `WATSONX_URL` | Regional runtime endpoint (region is encoded in the URL) | Yes | No |
| `WATSONX_MODEL_ID` | Chat model supported by your project | No (defaults to `ibm/granite-4-h-small`) | No |
| `WATSONX_API_VERSION` | watsonx API version query parameter | No (defaults to `2024-10-01`) | No |

Model IDs change over time. To list the chat models your project supports:

```text
GET {WATSONX_URL}/ml/v1/foundation_model_specs?version=2024-10-01&filters=function_text_chat
```

Example (verified against the current project): `ibm/granite-4-h-small`.
If a model was deprecated, watsonx returns `404 model_not_supported` and the app degrades
to the deterministic fallback instead of crashing.

## Google Gemini (alternative)

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
GEMINI_MODEL_ID=gemini-2.0-flash
```

The key is sent only in the `x-goog-api-key` header to
`generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.

## Groq (alternative)

```env
GROQ_API_KEY=YOUR_GROQ_API_KEY_HERE
GROQ_MODEL_ID=llama-3.3-70b-versatile
```

OpenAI-compatible endpoint `api.groq.com/openai/v1/chat/completions`; the key is sent only
in the `Authorization` header.

## Safety while credentials are missing or invalid

- Placeholders (`YOUR_*_HERE`) and empty values are treated as "not configured".
- Missing/invalid credentials produce a controlled provider error; the deterministic
  grounded engine answers instead and the response says so.
- The model never sees credentials and never receives tool schemas beyond the 11 frozen
  read-only MCP tools.
- All model output is grounding-checked (IDs, numbers, category words, recommendation
  conflicts) before it is returned.

## Quota, rate limits and provider switching

- `429` responses are classified as `provider_rate_limited`; `403` responses containing
  "quota" are classified as `provider_quota_exceeded`. In both cases the deterministic
  engine answers and the response records the reason.
- watsonx.ai trial projects have finite token quotas. If the quota is exhausted, either
  reset/upgrade the project or switch providers explicitly:

  ```env
  AI_PROVIDER=gemini    # or groq
  GEMINI_API_KEY=...
  ```

  `AI_PROVIDER=auto` keeps using watsonx while it is configured, even if its quota is
  exhausted, so set the provider explicitly to switch.
