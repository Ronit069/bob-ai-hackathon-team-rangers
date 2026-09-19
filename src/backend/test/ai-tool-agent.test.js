// Grounded tool-agent tests (Feature 2 / Bob Chat): the LLM chooses tools, the server
// validates and executes only frozen read-only tools, caps calls, and extracts the final.
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_STATUS, buildAgentPrompt, runToolAgent } from "../src/ai/toolAgent.js";
import { AGENT_TOOLS, catalogMatchesFrozenTools } from "../src/ai/toolCatalog.js";
import { TOOL_DEFINITIONS } from "../../mcp-server/src/tools.js";
import { ProviderError } from "../src/ai/providerError.js";

function scriptedProvider(steps) {
  let index = 0;
  return {
    name: "scripted",
    available: true,
    async generate() {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return { text: typeof step === "string" ? step : JSON.stringify(step) };
    },
    get calls() {
      return index;
    },
  };
}

function recordingToolCaller(results = {}) {
  const calls = [];
  const caller = async (baseUrl, tool, input) => {
    calls.push({ baseUrl, tool, input });
    return results[tool] ?? { tool, ok: true, data: [{ id: "S039" }], count: 1 };
  };
  caller.calls = calls;
  return caller;
}

const runAgent = (overrides = {}) =>
  runToolAgent({
    system: "system rules",
    task: "investigate",
    baseUrl: "http://test.local",
    onEvent: () => {},
    ...overrides,
  });

test("the model-facing catalog matches the frozen MCP tool list exactly", () => {
  assert.equal(catalogMatchesFrozenTools(), true);
  assert.deepEqual(
    AGENT_TOOLS.map((tool) => tool.name),
    TOOL_DEFINITIONS.map((tool) => tool.name),
  );
  assert.equal(AGENT_TOOLS.length, 11);
});

test("the agent executes LLM-chosen tools and returns the final answer with evidence", async () => {
  const provider = scriptedProvider([
    { tool: "get_active_disruptions", input: {} },
    { tool: "get_combined_risk", input: { shipment_id: "S039" } },
    { final: "Grounded answer." },
  ]);
  const toolCaller = recordingToolCaller();

  const result = await runAgent({ provider, toolCaller });

  assert.equal(result.ok, true);
  assert.equal(result.status, AGENT_STATUS.COMPLETED);
  assert.equal(result.answer, "Grounded answer.");
  assert.deepEqual(
    toolCaller.calls.map((call) => call.tool),
    ["get_active_disruptions", "get_combined_risk"],
  );
  assert.deepEqual(toolCaller.calls[1].input, { shipment_id: "S039" });
  assert.equal(result.evidence.length, 2);
  assert.equal(result.evidence[0].tool, "get_active_disruptions");
  assert.equal(result.tool_calls, 2);
  assert.equal(result.provider_calls, 3);
});

test("unknown tools are rejected by the allowlist without execution", async () => {
  const provider = scriptedProvider([
    { tool: "delete_everything", input: {} },
    { tool: "get_combined_risk", input: { shipment_id: "S039" } },
    { final: "Safe answer." },
  ]);
  const toolCaller = recordingToolCaller();

  const result = await runAgent({ provider, toolCaller });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "Safe answer.");
  assert.deepEqual(toolCaller.calls.map((call) => call.tool), ["get_combined_risk"]);
});

test("invalid tool input is rejected by the frozen schema without execution", async () => {
  const provider = scriptedProvider([
    { tool: "get_combined_risk", input: { shipment_id: "S39" } },
    { final: "Safe answer." },
  ]);
  const toolCaller = recordingToolCaller();

  const result = await runAgent({ provider, toolCaller });

  assert.equal(result.ok, true);
  assert.equal(toolCaller.calls.length, 0);
  assert.ok(result.transcript.some((entry) => /invalid input/i.test(entry.output ?? "")));
});

test("the tool budget is enforced and the model must finish", async () => {
  const provider = scriptedProvider([
    { tool: "get_active_disruptions", input: {} },
    { tool: "get_risk_overview", input: {} },
    { final: "Budget answer." },
  ]);
  const toolCaller = recordingToolCaller();

  const result = await runAgent({ provider, toolCaller, maxToolCalls: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "Budget answer.");
  assert.equal(result.tool_calls, 1);
  assert.deepEqual(toolCaller.calls.map((call) => call.tool), ["get_active_disruptions"]);
});

test("malformed model output is corrected and the final answer still completes", async () => {
  const provider = scriptedProvider(["this is not json", { final: "Recovered." }]);
  const result = await runAgent({ provider, toolCaller: recordingToolCaller() });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "Recovered.");
});

test("a rejected final payload is re-requested and can succeed", async () => {
  const provider = scriptedProvider([{ final: "bad" }, { final: { summary: "good" } }]);
  const validateFinal = (final) =>
    final && typeof final === "object" && "summary" in final
      ? { ok: true }
      : { ok: false, reason: "final must contain summary" };

  const result = await runAgent({ provider, toolCaller: recordingToolCaller(), validateFinal });

  assert.equal(result.ok, true);
  assert.deepEqual(result.answer, { summary: "good" });
});

test("a bare schema-valid payload is accepted as the final step", async () => {
  const provider = scriptedProvider([{ summary: "bare but valid" }]);
  const validateFinal = (final) =>
    final && typeof final === "object" && "summary" in final
      ? { ok: true }
      : { ok: false, reason: "final must contain summary" };

  const result = await runAgent({ provider, toolCaller: recordingToolCaller(), validateFinal });

  assert.equal(result.ok, true);
  assert.deepEqual(result.answer, { summary: "bare but valid" });
});

test("an answer key is accepted as the final answer", async () => {
  const provider = scriptedProvider([{ answer: "The answer." }]);
  const result = await runAgent({ provider, toolCaller: recordingToolCaller() });

  assert.equal(result.ok, true);
  assert.equal(result.answer, "The answer.");
});

test("tool failures are surfaced to the model without fabricating data", async () => {
  const provider = scriptedProvider([
    { tool: "get_combined_risk", input: { shipment_id: "S039" } },
    { final: "The risk tool failed." },
  ]);
  const toolCaller = recordingToolCaller({
    get_combined_risk: { tool: "get_combined_risk", ok: false, error: { code: "NOT_FOUND", message: "missing" } },
  });

  const result = await runAgent({ provider, toolCaller });

  assert.equal(result.ok, true);
  assert.equal(result.evidence[0].output.code, "NOT_FOUND");
  assert.equal(result.evidence[0].output.data, undefined);
});

test("provider errors and unavailable providers return controlled statuses", async () => {
  const failing = {
    name: "broken",
    available: true,
    async generate() {
      throw new ProviderError("provider_timeout", "timed out");
    },
  };
  const errored = await runAgent({ provider: failing, toolCaller: recordingToolCaller() });
  assert.equal(errored.ok, false);
  assert.equal(errored.status, AGENT_STATUS.PROVIDER_ERROR);
  assert.equal(errored.reason, "provider_timeout");

  const unavailable = await runAgent({ provider: null, toolCaller: recordingToolCaller() });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, AGENT_STATUS.PROVIDER_UNAVAILABLE);
});

test("an oversized agent prompt fails before any provider call", async () => {
  const provider = scriptedProvider([{ final: "never reached" }]);
  const result = await runAgent({ provider, toolCaller: recordingToolCaller(), maxPromptChars: 40 });

  assert.equal(result.ok, false);
  assert.equal(result.status, AGENT_STATUS.PROMPT_TOO_LARGE);
  assert.equal(provider.calls, 0);
});

test("the agent prompt exposes the catalog, transcript and correction hint", () => {
  const prompt = buildAgentPrompt({
    task: "investigate",
    transcript: [{ tool: "get_active_disruptions", input: {}, ok: true, output: "{}" }],
    toolCalls: 1,
    maxToolCalls: 6,
    correction: "fix your step",
    maxChars: 30000,
  });

  assert.equal(prompt.ok, true);
  const parsed = JSON.parse(prompt.prompt);
  assert.equal(parsed.available_tools.length, 11);
  assert.equal(parsed.previous_steps.length, 1);
  assert.equal(parsed.correction, "fix your step");
  assert.equal(parsed.tool_calls_used, 1);
});
