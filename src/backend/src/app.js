// App factory — enables API tests against an ephemeral server and an injected database pool.

import express from "express";
import { getPool, ping } from "./common/db.js";
import { config } from "./common/config.js";
import { errorHandler, unknownRouteHandler } from "./common/http.js";
import { createLogisticsRouter } from "./logistics/routes.js";
import { createColdchainRouter } from "./coldchain/routes.js";
import { createRiskRouter } from "./risk/routes.js";
import { createAuditRouter } from "./audit/routes.js";
import { createBobRouter } from "./bob/routes.js";
import { createAiRouter } from "./ai/routes.js";

export function createApp({ db = getPool(), aiProvider = null } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", async (_req, res) => {
    let database = "down";
    try {
      await ping(db);
      database = "up";
    } catch {
      database = "down";
    }
    res.status(database === "up" ? 200 : 500).json({
      status: database === "up" ? "ok" : "degraded",
      database,
      bob: config.bobEnabled ? "enabled" : "disabled",
      time: new Date().toISOString(),
    });
  });

  app.use("/api", createLogisticsRouter(db));
  app.use("/api", createColdchainRouter(db));
  app.use("/api", createRiskRouter(db));
  app.use("/api", createAuditRouter(db));
  app.use("/api", createBobRouter({ provider: aiProvider }));
  app.use("/api", createAiRouter(db, { provider: aiProvider }));

  // Unknown /api paths -> standard 404 envelope (Phase 6 / F8).
  app.all("/api/*", unknownRouteHandler);

  app.use(errorHandler);
  return app;
}
