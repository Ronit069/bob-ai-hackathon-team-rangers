import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { config } from "../common/config.js";
import { parse, incidentBriefInputSchema } from "../common/validation.js";
import { createDisabledProvider, createHttpProvider } from "./provider.js";
import { generateIncidentBrief } from "./service.js";

export function createAiRouter(db, { provider = null } = {}) {
  const router = Router();

  const resolveProvider = () => {
    if (provider) return provider;
    if (!config.bobApiUrl) return createDisabledProvider();
    return createHttpProvider();
  };

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

  return router;
}
