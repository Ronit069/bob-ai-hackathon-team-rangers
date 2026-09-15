// Bob query proxy (endpoint 23). Decision D2: the 503 path is implemented now; the
// enabled forwarding path stays behind BOB_ENABLED and never exposes credentials.

import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { AppError } from "../common/errors.js";
import { config } from "../common/config.js";
import { parse, bobQuerySchema } from "../common/validation.js";
import { GROUNDING_PROMPT } from "./prompt.js";

export function createBobRouter() {
  const router = Router();

  router.post(
    "/bob/query",
    asyncHandler(async (req, res) => {
      const body = parse(bobQuerySchema, req.body);

      if (!config.bobEnabled) {
        throw new AppError("BOB_UNAVAILABLE", "Bob is disabled (BOB_ENABLED=false)", {
          reason: "bob_disabled",
        });
      }
      if (!config.bobApiUrl) {
        throw new AppError("BOB_UNAVAILABLE", "Bob endpoint is not configured (BOB_API_URL)", {
          reason: "bob_not_configured",
        });
      }

      try {
        const response = await fetch(`${config.bobApiUrl.replace(/\/+$/, "")}/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.bobApiKey ? { authorization: `Bearer ${config.bobApiKey}` } : {}),
          },
          body: JSON.stringify({
            prompt: body.prompt,
            context: body.context ?? {},
            system: GROUNDING_PROMPT,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Bob responded with ${response.status}`);
        const payload = await response.json();
        res.json({
          answer: payload.answer ?? "",
          evidence: payload.evidence ?? [],
          tool_calls: payload.tool_calls ?? 0,
        });
      } catch (error) {
        throw new AppError("BOB_UNAVAILABLE", "Bob is unreachable", {
          reason: "bob_unreachable",
          detail: error.message,
        });
      }
    }),
  );

  return router;
}
