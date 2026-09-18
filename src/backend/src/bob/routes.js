// Bob query handler — contract-compatible with decision D2 (api-contract.md §3.23)
// while preserving the credential-free local grounded engine:
//   BOB_ENABLED=false                       -> 503 BOB_UNAVAILABLE (bob_disabled)
//   BOB_ENABLED=true + BOB_API_URL          -> forward to the Bob/MCP gateway
//   BOB_ENABLED=true without BOB_API_URL    -> local grounded engine (no external API)
// Every enabled mode returns { answer, evidence, tool_calls }.

import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { AppError } from "../common/errors.js";
import { parse, bobQuerySchema } from "../common/validation.js";
import { config } from "../common/config.js";
import { GROUNDING_PROMPT } from "./prompt.js";
import { runLocalEngine } from "./engine.js";

export function createBobRouter() {
  const router = Router();

  async function forwardToGateway(body) {
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
      return {
        answer: payload.answer ?? "",
        evidence: payload.evidence ?? [],
        tool_calls: payload.tool_calls ?? 0,
      };
    } catch (error) {
      throw new AppError("BOB_UNAVAILABLE", "Bob is unreachable", {
        reason: "bob_unreachable",
        detail: error.message,
      });
    }
  }

  router.post(
    "/bob/query",
    asyncHandler(async (req, res) => {
      const body = parse(bobQuerySchema, req.body);

      if (!config.bobEnabled) {
        throw new AppError("BOB_UNAVAILABLE", "Bob is disabled (BOB_ENABLED=false)", {
          reason: "bob_disabled",
        });
      }

      if (config.bobApiUrl) {
        res.json(await forwardToGateway(body));
        return;
      }

      const baseUrl = `http://localhost:${config.port}`;
      res.json(await runLocalEngine(baseUrl, body.prompt, body.context ?? {}));
    }),
  );

  return router;
}
