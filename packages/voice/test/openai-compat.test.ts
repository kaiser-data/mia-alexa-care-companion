import { describe, expect, it } from "vitest";
import { RESPOND_TOOL } from "../src/compose";
import { LlmError, type LlmRequest } from "../src/llm";
import { OpenAiCompatLlm } from "../src/openai-compat";

/** A fake fetch: records each request, answers from a list. No network. */
function fakeFetch(replies: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const llmWith = (replies: { status?: number; body: unknown }[]) => {
  const f = fakeFetch(replies);
  return { ...f, llm: new OpenAiCompatLlm({ baseUrl: "https://x.test/v1", apiKey: "sk-secret", model: "m1", fetch: f.fetch }) };
};
const choice = (message: unknown, finish_reason = "stop") => ({ choices: [{ message, finish_reason }] });

const MIA_TOOL = { name: "get_today", description: "The day.", inputSchema: { type: "object", properties: {} } };
const REQ: LlmRequest = { system: "You are Mia.", messages: [{ role: "user", text: "What day is it?" }], tools: [MIA_TOOL, { ...RESPOND_TOOL }] };

describe("OpenAiCompatLlm request", () => {
  it("posts to /chat/completions with auth, model, max_tokens, tools and tool_choice", async () => {
    const { llm, calls } = llmWith([{ body: choice({ content: "Hi" }) }]);
    await llm.next(REQ);
    const c = calls[0]!;
    expect(c.url).toBe("https://x.test/v1/chat/completions");
    expect(c.init.method).toBe("POST");
    expect(c.init.headers).toEqual({ authorization: "Bearer sk-secret", "content-type": "application/json" });
    expect(c.body).toMatchObject({ model: "m1", max_tokens: 400, tool_choice: "auto" });
    expect(c.body).not.toHaveProperty("temperature");
    const tools = c.body.tools as { type: string; function: Record<string, unknown> }[];
    expect(tools[0]).toEqual({ type: "function", function: { name: "get_today", description: "The day.", parameters: MIA_TOOL.inputSchema } });
    expect(tools.every((t) => t.type === "function" && !("strict" in t.function))).toBe(true);
    expect(c.body.messages).toEqual([{ role: "system", content: "You are Mia." }, { role: "user", content: "What day is it?" }]);
  });
  it("maps a full round-trip history", async () => {
    const { llm, calls } = llmWith([{ body: choice({ content: "ok" }) }]);
    await llm.next({
      ...REQ,
      messages: [
        { role: "user", text: "Pills?" },
        { role: "assistant", text: "", calls: [{ id: "a", name: "x", input: { q: 1 } }, { id: "b", name: "y", input: {} }], raw: [{ ignored: true }] },
        { role: "tool_results", results: [{ id: "a", content: "A" }, { id: "b", content: "B" }] },
        { role: "assistant", text: "Done." },
      ],
    });
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "You are Mia." },
      { role: "user", content: "Pills?" },
      { role: "assistant", content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "x", arguments: "{\"q\":1}" } },
        { id: "b", type: "function", function: { name: "y", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "a", content: "A" },
      { role: "tool", tool_call_id: "b", content: "B" },
      { role: "assistant", content: "Done." },
    ]);
  });
});

describe("OpenAiCompatLlm response", () => {
  it("parses tool calls", async () => {
    const { llm } = llmWith([{ body: choice({ content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "respond", arguments: "{\"pick\":\"hello\"}" } }] }, "tool_calls") }]);
    expect(await llm.next(REQ)).toEqual({ kind: "tools", text: "", calls: [{ id: "t1", name: "respond", input: { pick: "hello" } }] });
  });
  it("malformed arguments become {} instead of throwing", async () => {
    const { llm } = llmWith([{ body: choice({ content: "hm", tool_calls: [{ id: "t1", type: "function", function: { name: "respond", arguments: "{oops" } }] }) }]);
    expect(await llm.next(REQ)).toEqual({ kind: "tools", text: "hm", calls: [{ id: "t1", name: "respond", input: {} }] });
  });
  it("returns a text reply", async () => {
    const { llm } = llmWith([{ body: choice({ content: "Hello, Rose." }) }]);
    expect(await llm.next(REQ)).toEqual({ kind: "text", text: "Hello, Rose." });
  });
  it("a non-2xx status is an LlmError with at most 200 chars of body", async () => {
    const { llm } = llmWith([{ status: 500, body: "x".repeat(500) }]);
    const err = await llm.next(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toContain("500");
    expect((err as Error).message).not.toContain("x".repeat(201));
  });
  it("a body without choices is an LlmError", async () => {
    const { llm } = llmWith([{ body: { error: "nope" } }]);
    await expect(llm.next(REQ)).rejects.toBeInstanceOf(LlmError);
  });
  it("finish_reason length and content_filter are LlmErrors", async () => {
    for (const reason of ["length", "content_filter"]) {
      const { llm } = llmWith([{ body: choice({ content: "cut" }, reason) }]);
      await expect(llm.next(REQ)).rejects.toBeInstanceOf(LlmError);
    }
  });
  it("an already-aborted signal rejects", async () => {
    const f = new OpenAiCompatLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: ((_u: string, init: RequestInit) =>
      init.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(new Response("{}"))) as unknown as typeof fetch });
    await expect(f.next(REQ, AbortSignal.abort())).rejects.toBeDefined();
  });
});
