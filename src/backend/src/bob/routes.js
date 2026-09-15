// Bob query handler — local grounded engine (no external API required).
// Intent detection → MCP tool calls → grounded answer synthesis.
// Returns { answer, evidence, tool_calls } — same contract as the original proxy.

import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { parse, bobQuerySchema } from "../common/validation.js";
import { config } from "../common/config.js";
import { runLocalEngine } from "./engine.js";

export function createBobRouter() {
  const router = Router();

  router.post(
    "/bob/query",
    asyncHandler(async (req, res) => {
      const body = parse(bobQuerySchema, req.body);
      const baseUrl = `http://localhost:${config.port}`;
      const result = await runLocalEngine(baseUrl, body.prompt, body.context ?? {});
      res.json(result);
    }),
  );

  return router;
}
