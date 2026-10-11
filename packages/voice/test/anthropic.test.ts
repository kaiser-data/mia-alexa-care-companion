import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicLlm, fromAnthropic, toAnthropic, type MessagesClient } from "../src/anthropic";
import { RESPOND_TOOL } from "../src/compose";
import { LlmError, type LlmRequest } from "../src/llm";

/** A fake SDK client: records each request body and options, answers from a list. No network. */
function fakeClient(replies: Partial<Anthropic.Message>[]) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; options?: { signal?: AbortSignal } }[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (body, options) => {
        calls.push({ body: structuredClone(body), ...(options ? { options } : {}) });
        const r = replies.shift();
        if (!r) throw new Error("no more replies");
        return { stop_reason: "end_turn", ...r } as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

const MIA_TOOL = { name: "get_today", description: "The day.", inputSchema: { type: "object", properties: {} } };
const REQ: LlmRequest = { system: "You are Mia.", messages: [{ role: "user", text: "What day is it?" }], tools: [MIA_TOOL, RESPOND_TOOL] };

describe("Anthropic adapter", () => {
  it("maps our messages to the Messages API format", () => {
    expect(toAnthropic([
      { role: "user", text: "Did I take my pills?" },
      { role: "assistant", text: "", calls: [{ id: "t1", name: "get_medication_status", input: {} }] },
      { role: "tool_results", results: [{ id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", text: "Not yet." },
    ])).toEqual([
      { role: "user", content: "Did I take my pills?" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_medication_status", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", content: [{ type: "text", text: "Not yet." }] },
    ]);
  });
  it("reads tool calls and text from a response, keeping the raw content", () => {
    const content = [
      { type: "text", text: "Let me check.", citations: null },
      { type: "tool_use", id: "t2", name: "get_today", input: {} },
    ];
    expect(fromAnthropic({ content } as never)).toEqual({ kind: "tools", text: "Let me check.", calls: [{ id: "t2", name: "get_today", input: {} }], raw: content });
    expect(fromAnthropic({ content: [{ type: "text", text: " Hello, Rose. ", citations: null }] } as never))
      .toEqual({ kind: "text", text: "Hello, Rose." });
  });
  it("stop_sequence counts as end_turn; an empty end_turn is plain empty text", () => {
    expect(fromAnthropic({ content: [], stop_reason: "stop_sequence" } as never)).toEqual({ kind: "text", text: "" });
    expect(fromAnthropic({ content: [], stop_reason: "end_turn" } as never)).toEqual({ kind: "text", text: "" });
  });
  it("max_tokens, refusal, a full context and pause_turn throw an LlmError", () => {
    for (const stop_reason of ["max_tokens", "refusal", "model_context_window_exceeded", "pause_turn"]) {
      expect(() => fromAnthropic({ content: [{ type: "tool_use", id: "t", name: "respond", input: {} }], stop_reason } as never)).toThrow(LlmError);
    }
  });
});

describe("AnthropicLlm request", () => {
  it("fits Sonnet 5.5: between_tools thinking, low effort, 1024 tokens, no tool_choice or temperature", async () => {
    const { client, calls } = fakeClient([{ content: [{ type: "tool_use", id: "t1", name: "get_today", input: {} }] as never, stop_reason: "tool_use" }]);
    const signal = new AbortController().signal;
    await new AnthropicLlm(client).next(REQ, signal);
    const { body, options } = calls[0]!;
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5", max_tokens: 1024, thinking: { type: "between_tools" }, output_config: { effort: "low" }, system: "You are Mia.",
    });
    for (const k of ["tool_choice", "temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(k);
    expect(body.tools!.map((t) => (t as Anthropic.Tool).name)).toEqual(["get_today", "respond"]);
    expect(body.tools!.at(-1)).toMatchObject({ name: "respond", strict: true, input_schema: { additionalProperties: false } });
    expect(body.tools![0]).not.toHaveProperty("strict");
    expect(options?.signal).toBe(signal);
  });
  it("the raw assistant content (thinking included) round-trips unchanged within a turn", async () => {
    const content = [
      { type: "thinking", thinking: "She asks the day.", signature: "abc" },
      { type: "tool_use", id: "t1", name: "get_today", input: {} },
    ];
    const { client, calls } = fakeClient([{ content: content as never, stop_reason: "tool_use" }, { content: [] as never, stop_reason: "end_turn" }]);
    const llm = new AnthropicLlm(client);
    const step = await llm.next(REQ);
    expect(step.kind).toBe("tools");
    if (step.kind !== "tools") return;
    await llm.next({ ...REQ, messages: [
      ...REQ.messages,
      { role: "assistant", text: step.text, calls: step.calls, ...(step.raw ? { raw: step.raw } : {}) },
      { role: "tool_results", results: [{ id: "t1", content: "{}" }] },
    ] });
    expect(calls[1]!.body.messages[1]).toEqual({ role: "assistant", content });
    // system and tools stay byte-identical across the requests of a turn
    expect(JSON.stringify(calls[1]!.body.tools)).toBe(JSON.stringify(calls[0]!.body.tools));
    expect(calls[1]!.body.system).toBe(calls[0]!.body.system);
  });
  it("a max_tokens stop throws an LlmError", async () => {
    const { client } = fakeClient([{ content: [] as never, stop_reason: "max_tokens" }]);
    await expect(new AnthropicLlm(client).next(REQ)).rejects.toBeInstanceOf(LlmError);
  });
});
