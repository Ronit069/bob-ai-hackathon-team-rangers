// Bob query handler. Decision D2 contract (api-contract.md §3.23) with three modes:
//   BOB_ENABLED=false                       -> 503 BOB_UNAVAILABLE (bob_disabled)
//   BOB_ENABLED=true + BOB_API_URL          -> forward to the Bob/MCP gateway
//   BOB_ENABLED=true without BOB_API_URL    -> LLM grounded tool agent when an AI
//                                              provider is configured, else the
//                                              credential-free local grounded engine
// Every enabled mode returns { answer, evidence, tool_calls }.
// LLM paths add status/source/provider_name/grounding (additive).

import { Router } from "express";
import { asyncHandler } from "../common/http.js";
import { AppError } from "../common/errors.js";
import { parse, bobQuerySchema } from "../common/validation.js";
import { config } from "../common/config.js";
import { resolveDefaultProvider } from "../ai/provider.js";
import { runToolAgent } from "../ai/toolAgent.js";
import { validateGroundedText } from "../ai/grounding.js";
import { ProviderError } from "../ai/providerError.js";
import { BOB_AGENT_SYSTEM_PROMPT, BOB_SYNTHESIS_SYSTEM_PROMPT, GROUNDING_PROMPT } from "./prompt.js";
import { runLocalEngine } from "./engine.js";

function logAgentEvent(event, details = {}) {
  const parts = Object.entries(details)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(",")}]` : String(value)}`)
    .join(" ");
  console.log(`[BOB-AGENT] ${event}${parts ? ` ${parts}` : ""}`);
}

// Single-shot grounded synthesis: used when the multi-turn agent fails but evidence was
// already collected. Returns null on provider failure so the caller can degrade safely.
async function synthesizeAnswer({ provider, question, evidence }) {
  try {
    const output = await provider.generate({
      system: BOB_SYNTHESIS_SYSTEM_PROMPT,
      prompt: JSON.stringify({ question, evidence }),
    });
    const text = typeof output?.text === "string" ? output.text.trim() : "";
    return text === "" ? null : text;
  } catch (error) {
    if (error instanceof ProviderError) return null;
    throw error;
  }
}

export function createBobRouter({ provider = null } = {}) {
  const router = Router();

  const resolveProvider = () => provider ?? resolveDefaultProvider();

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

      const baseUrl = `http://localhost:${config.port}`;

      if (config.bobApiUrl) {
        res.json(await forwardToGateway(body));
        return;
      }

      const activeProvider = resolveProvider();

      // LLM path: the model chooses read-only tools; the server validates and executes.
      if (activeProvider && activeProvider.available !== false) {
        const agent = await runToolAgent({
          system: BOB_AGENT_SYSTEM_PROMPT,
          task: body.prompt,
          provider: activeProvider,
          baseUrl,
          maxToolCalls: config.aiAgentMaxToolCalls,
          maxPromptChars: config.aiAgentMaxPromptChars,
          onEvent: logAgentEvent,
        });

        if (agent.ok) {
          const answerText = typeof agent.answer === "string" ? agent.answer : JSON.stringify(agent.answer);
          const grounding = validateGroundedText(answerText, agent.evidence);
          if (grounding.ok) {
            res.json({
              answer: answerText,
              evidence: agent.evidence,
              tool_calls: agent.tool_calls,
              status: "VALIDATED_AI",
              source: "llm",
              provider_name: activeProvider.name,
              grounding,
            });
            return;
          }
          const fallback = await runLocalEngine(baseUrl, body.prompt, body.context ?? {});
          logAgentEvent("answer_rejected", {
            violations: grounding.violations.slice(0, 3),
            draft: answerText.slice(0, 300),
          });
          res.json({
            ...fallback,
            status: "GROUNDING_FAILED",
            source: "deterministic",
            provider_name: activeProvider.name,
            grounding,
            fallback_reason: "grounding_violations",
          });
          return;
        }

        // Multi-turn agent failed: try one single-shot grounded synthesis from the
        // evidence already collected before degrading to the deterministic engine.
        if ((agent.evidence ?? []).length > 0) {
          const synthesized = await synthesizeAnswer({
            provider: activeProvider,
            question: body.prompt,
            evidence: agent.evidence,
          });
          if (synthesized) {
            const grounding = validateGroundedText(synthesized, agent.evidence);
            if (grounding.ok) {
              res.json({
                answer: synthesized,
                evidence: agent.evidence,
                tool_calls: agent.tool_calls,
                status: "VALIDATED_AI",
                source: "llm",
                provider_name: activeProvider.name,
                grounding,
                fallback_reason: agent.reason ?? agent.status,
              });
              return;
            }
            const fallback = await runLocalEngine(baseUrl, body.prompt, body.context ?? {});
            res.json({
              ...fallback,
              status: "GROUNDING_FAILED",
              source: "deterministic",
              provider_name: activeProvider.name,
              grounding,
              fallback_reason: "grounding_violations",
            });
            return;
          }
        }

        const fallback = await runLocalEngine(baseUrl, body.prompt, body.context ?? {});
        res.json({
          ...fallback,
          status: "PROVIDER_UNAVAILABLE",
          source: "deterministic",
          provider_name: activeProvider.name,
          fallback_reason: agent.reason ?? agent.status,
        });
        return;
      }

      // Deterministic fallback (no provider configured): unchanged contract.
      res.json(await runLocalEngine(baseUrl, body.prompt, body.context ?? {}));
    }),
  );

  return router;
}
