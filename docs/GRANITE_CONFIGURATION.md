# IBM watsonx.ai / Granite configuration (Feature 2 preparation)

Feature 2 (AI Incident Commander) will use IBM watsonx.ai with the Granite model
`ibm/granite-3-8b-instruct`. This stage establishes the **configuration boundary only**:
the values below are placeholders and no Granite request is attempted yet.

All values live in one place — the backend environment file (`src/backend/.env`, copied
from `src/.env.example`). They are loaded by the centralized config module
(`src/backend/src/common/config.js`) and exposed as `config.watsonx.*`. Credentials stay
**server-side**: they are never returned by APIs, never logged, never bundled into the
frontend, and `.env` is git-ignored.

## Required variables

| Variable | Meaning | Where to obtain it | Required | Secret |
|---|---|---|---|---|
| `WATSONX_API_KEY` | IBM Cloud API key used to authenticate to watsonx.ai | IBM Cloud console → Manage → Access (IAM) → API keys | Yes | Yes |
| `WATSONX_PROJECT_ID` | IBM watsonx.ai project identifier that scopes the Granite deployment | watsonx.ai project → Manage → General → Project ID | Yes | No (identifier) |
| `WATSONX_URL` | watsonx.ai regional runtime endpoint (region is encoded in the URL) | IBM watsonx.ai regional endpoint for your account | Yes | No |
| `WATSONX_MODEL_ID` | Granite model identifier | Expected value: `ibm/granite-3-8b-instruct` (default when unset) | No (defaults) | No |

```env
# src/backend/.env (replace placeholders when the real values are provided)
WATSONX_API_KEY=YOUR_WATSONX_API_KEY_HERE
WATSONX_PROJECT_ID=YOUR_WATSONX_PROJECT_ID_HERE
WATSONX_URL=YOUR_WATSONX_URL_HERE
WATSONX_MODEL_ID=ibm/granite-3-8b-instruct
```

## Behaviour while values are missing or placeholders

- `config.watsonx.configured` is `false` and `config.watsonx.missing` lists the
  outstanding variable names.
- Empty values and `YOUR_*_HERE` placeholders are treated identically to "not configured".
- The existing AI provider architecture (`src/backend/src/ai/provider.js`) resolves to a
  controlled disabled provider — Feature 1 and the dashboard keep working with the
  deterministic fallback. Nothing crashes, nothing is fabricated, no credential is used.
- `graniteRuntimeStatus()` exposes a safe, non-secret status view
  (`provider`, `model_id`, `configured`, `available`, `reason`, `missing`).

## Current runtime status

- Configuration: **placeholder-ready** (centralized in `config.watsonx`).
- Granite runtime: **not connected** — the watsonx adapter is intentionally deferred to
  the Feature 2 implementation stage; no endpoint, credential, or request shape is invented
  or hardcoded here.
