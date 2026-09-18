import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { config } from "../common/config.js";
import { parse, incidentBriefInputSchema } from "../common/validation.js";
import { resolveDefaultProvider } from "./provider.js";
import { generateIncidentBrief } from "./service.js";
import { incidentCommandInputSchema } from "./commander.schema.js";
import { runIncidentCommand } from "./commander.service.js";

export function createAiRouter(db, { provider = null } = {}) {
  const router = Router();

  const resolveProvider = () => provider ?? resolveDefaultProvider();

  router.post(
    "/ai/incident-brief",
    asyncHandler(async (req, res) => {
      const body = parse(incidentBriefInputSchema, req.body);
      const result = await generateIncidentBrief({
        db,
        shipmentId: body.shipment_id,
        provider: resolveProvider(),
      });
      res.json(result);
    }),
  );

  // Feature 2 — AI Incident Commander (feature-flagged; disabled by default).
  router.post(
    "/ai/incident-command",
    asyncHandler(async (req, res) => {
      const body = parse(incidentCommandInputSchema, req.body);
      const baseUrl = `http://${req.headers.host ?? `localhost:${config.port}`}`;
      const result = await runIncidentCommand({
        db,
        command: body.command,
        provider: resolveProvider(),
        baseUrl,
      });
      res.json(result);
    }),
  );

  return router;
}
