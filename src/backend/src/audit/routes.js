// Recommendation lifecycle + audit endpoints (20/21/22).
// Single pending -> decided transition (D4); audit is append-only.

import { Router } from "express";
import { asyncHandler, sendList } from "../common/http.js";
import { conflict, notFound } from "../common/errors.js";
import { parse, recommendationsQuerySchema, decisionInputSchema, auditQuerySchema } from "../common/validation.js";
import * as recommendationRepo from "./recommendation.repository.js";
import { appendAuditRecord, listAuditRecords } from "./repository.js";

const DECISION_ACTION = {
  accepted: "decided_accepted",
  rejected: "decided_rejected",
  modified: "decided_modified",
};

export function createAuditRouter(db) {
  const router = Router();

  router.get(
    "/recommendations",
    asyncHandler(async (req, res) => {
      const query = parse(recommendationsQuerySchema, req.query);
      const rows = await recommendationRepo.listRecommendations(db, query);
      sendList(res, rows);
    }),
  );

  router.post(
    "/recommendations/:id/decision",
    asyncHandler(async (req, res) => {
      const body = parse(decisionInputSchema, req.body);
      const recommendation = await recommendationRepo.getRecommendation(db, req.params.id);
      if (!recommendation) throw notFound("Recommendation", req.params.id);
      if (recommendation.status !== "pending") {
        throw conflict(`Recommendation already ${recommendation.status}`, {
          recommendation_id: recommendation.id,
          status: recommendation.status,
        });
      }

      const updated = await recommendationRepo.updateRecommendationDecision(db, recommendation.id, {
        status: body.decision,
        actor: body.actor,
        notes: body.notes,
      });
      if (!updated) {
        throw conflict("Recommendation is no longer pending", { recommendation_id: recommendation.id });
      }

      // D4: modified_payload is recorded in the audit trail only — the target, score
      // and factors are never mutated and nothing is executed.
      const audit = await appendAuditRecord(db, {
        entity_type: "recommendation",
        entity_id: recommendation.id,
        action: DECISION_ACTION[body.decision],
        actor: body.actor,
        details: {
          decision: body.decision,
          notes: body.notes ?? null,
          modified_payload: body.modified_payload ?? null,
        },
      });

      res.json({ ...updated, audit_record_id: audit.id });
    }),
  );

  router.get(
    "/audit",
    asyncHandler(async (req, res) => {
      const query = parse(auditQuerySchema, req.query);
      const rows = await listAuditRecords(db, query);
      sendList(res, rows);
    }),
  );

  return router;
}
