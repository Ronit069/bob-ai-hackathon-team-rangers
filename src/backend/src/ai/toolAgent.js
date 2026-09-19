// Provider-agnostic grounded tool agent (Feature 2 / Bob Chat).
// The LLM chooses which of the 11 frozen READ-ONLY MCP tools to call; the server
// validates every tool name and input, executes only through callTool, caps the number
// of calls, and never executes mutations (none exist in the tool layer).

import { callTool, findTool, validateToolInput } from "../../../mcp-server/src/tools.js";
import { extractJsonObject } from "./brief.schema.js";
import { ProviderError } from "./providerError.js";
import { AGENT_TOOLS } from "./toolCatalog.js";

export const AGENT_STATUS = Object.freeze({
  COMPLETED: "COMPLETED",
  MAX_STEPS: "MAX_STEPS",
  INVALID_PROTOCOL: "INVALID_PROTOCOL",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROMPT_TOO_LARGE: "PROMPT_TOO_LARGE",
});

const truncate = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
};

export function buildAgentPrompt({ task, transcript, toolCalls, maxToolCalls, correction, maxChars }) {
  const base = {
    task,
    tool_calls_used: toolCalls,
    tool_call_limit: maxToolCalls,
    reply_format:
      'reply with exactly one JSON object: {"tool":"<tool_name>","input":{...}} to call a tool, or {"final": <final output>} to finish',
    available_tools: AGENT_TOOLS,
    previous_steps: transcript,
    correction: correction ?? null,
  };

  let json = JSON.stringify(base);
  if (json.length > maxChars) {
    for (const entry of base.previous_steps) {
      if (typeof entry.output === "string" && entry.output.length > 1000) {
        entry.output = `${entry.output.slice(0, 1000)}…[truncated]`;
      }
    }
    json = JSON.stringify(base);
  }
  return json.length <= maxChars ? { ok: true, prompt: json } : { ok: false, prompt: json };
}

// Runs the grounded tool loop:
//   provider call -> validated step -> (tool execution | final output) -> repeat
// `validateFinal` optionally validates the final payload (e.g. the brief schema).
export async function runToolAgent({
  system,
  task,
  provider,
  baseUrl,
  toolCaller = callTool,
  maxToolCalls = 6,
  maxStepChars = 4000,
  maxPromptChars = 30000,
  validateFinal = null,
  onEvent = () => {},
} = {}) {
  if (!provider || provider.available === false) {
    return {
      ok: false,
      status: AGENT_STATUS.PROVIDER_UNAVAILABLE,
      reason: provider?.reason ?? "provider_not_configured",
      evidence: [],
      transcript: [],
      tool_calls: 0,
      provider_calls: 0,
    };
  }

  const transcript = [];
  const evidence = [];
  let providerCalls = 0;
  let toolCalls = 0;
  let correction = null;
  const maxIterations = maxToolCalls + 4;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const promptResult = buildAgentPrompt({
      task,
      transcript,
      toolCalls,
      maxToolCalls,
      correction,
      maxChars: maxPromptChars,
    });
    if (!promptResult.ok) {
      return {
        ok: false,
        status: AGENT_STATUS.PROMPT_TOO_LARGE,
        reason: "agent_prompt_too_large",
        evidence,
        transcript,
        tool_calls: toolCalls,
        provider_calls: providerCalls,
      };
    }

    onEvent("provider_call", { iteration: iteration + 1 });
    let output;
    try {
      output = await provider.generate({ system, prompt: promptResult.prompt });
      providerCalls += 1;
    } catch (error) {
      if (error instanceof ProviderError) {
        onEvent("provider_error", { reason: error.reason });
        return {
          ok: false,
          status: AGENT_STATUS.PROVIDER_ERROR,
          reason: error.reason,
          evidence,
          transcript,
          tool_calls: toolCalls,
          provider_calls: providerCalls,
        };
      }
      throw error;
    }

    const parsed = extractJsonObject(output?.text, { maxChars: maxStepChars * 4 });
    if (!parsed.ok) {
      correction = `Your reply was not a single JSON object (${parsed.reason}). Reply with only the JSON step.`;
      onEvent("protocol_error", { reason: parsed.reason });
      continue;
    }

    const step = parsed.data;
    const isObject = step && typeof step === "object" && !Array.isArray(step);
    const hasFinal = isObject && Object.prototype.hasOwnProperty.call(step, "final");
    const hasTool = isObject && typeof step.tool === "string";
    const hasAnswer = isObject && typeof step.answer === "string";
    // Small models sometimes return a bare final payload or {"answer": "..."} instead of
    // {"final": ...}. Those are accepted only when they pass the same validation.
    const rawCandidate = isObject && !hasFinal && !hasTool ? step : null;
    const finalCandidate = hasFinal ? step.final : hasAnswer ? step.answer : rawCandidate;

    if (isObject && !hasTool && (hasFinal || hasAnswer || (rawCandidate && validateFinal))) {
      const verdict = validateFinal ? validateFinal(finalCandidate) : { ok: true };
      if (!verdict.ok) {
        correction = verdict.reason ?? "The final output failed validation. Reply with a corrected final step.";
        onEvent("final_rejected", { reason: verdict.reason ?? "invalid_final" });
        continue;
      }
      onEvent("agent_completed", { tool_calls: toolCalls });
      return {
        ok: true,
        status: AGENT_STATUS.COMPLETED,
        answer: finalCandidate,
        evidence,
        transcript,
        tool_calls: toolCalls,
        provider_calls: providerCalls,
        iterations: iteration + 1,
      };
    }

    if (hasTool) {
      if (toolCalls >= maxToolCalls) {
        correction = `Tool budget exhausted (${maxToolCalls} calls). You must finish now with {"final": ...}.`;
        onEvent("tool_budget_exhausted", {});
        continue;
      }

      const definition = findTool(step.tool);
      if (!definition) {
        correction = `Unknown tool "${truncate(step.tool, 60)}". Use only tools from the available_tools catalog.`;
        onEvent("tool_rejected", { tool: step.tool });
        continue;
      }

      const validation = validateToolInput(definition, step.input ?? {});
      if (!validation.ok) {
        const issues = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
        transcript.push({
          tool: step.tool,
          input: step.input ?? null,
          ok: false,
          output: `invalid input rejected by the server (${issues})`,
        });
        correction = `Invalid input for ${step.tool}: ${issues}. Fix the input and try again.`;
        onEvent("tool_input_rejected", { tool: step.tool });
        continue;
      }

      onEvent("tool_selected", { tool: step.tool });
      let result;
      try {
        result = await toolCaller(baseUrl, step.tool, validation.data);
      } catch (error) {
        result = {
          tool: step.tool,
          ok: false,
          error: { code: "TOOL_CALL_FAILED", message: error?.message ?? "Tool call failed", details: {} },
        };
      }
      toolCalls += 1;

      const ok = result?.ok !== false;
      const { tool: _tool, ok: _ok, ...body } = result ?? {};
      const outputBody = ok ? body : result?.error ?? { code: "TOOL_ERROR" };
      transcript.push({
        tool: step.tool,
        input: validation.data,
        ok,
        output: truncate(JSON.stringify(outputBody), maxStepChars),
      });
      evidence.push({ tool: step.tool, input: validation.data, output: outputBody });
      onEvent("tool_completed", { tool: step.tool, ok });
      correction = ok
        ? null
        : `Tool ${step.tool} returned an error: ${truncate(JSON.stringify(result?.error ?? {}), 300)}. You may try a different tool or state the limitation in your final answer.`;
      continue;
    }

    correction = 'Invalid step. Reply with {"tool":"<name>","input":{...}} or {"final": ...}.';
    onEvent("protocol_error", { reason: "unknown_step" });
  }

  return {
    ok: false,
    status: AGENT_STATUS.MAX_STEPS,
    reason: "agent_step_limit",
    evidence,
    transcript,
    tool_calls: toolCalls,
    provider_calls: providerCalls,
  };
}
