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
    const { llm } = llmWith([{ status: 500, body: "x".repeat(500) }, { status: 500, body: "x".repeat(500) }]);
    const err = await llm.next(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toContain("500");
    expect((err as Error).message).not.toContain("x".repeat(201));
  });
  it("a body without choices is an LlmError", async () => {
    const { llm } = llmWith([{ body: { error: "nope" } }, { body: { error: "nope" } }]);
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

describe("OpenAiCompatLlm hardening (fix round 3)", () => {
  it("skips tool calls without function, function.name or id, never a TypeError", async () => {
    const { llm } = llmWith([{ body: choice({ content: "", tool_calls: [
      { id: "t0", type: "function" },
      { id: "t1", type: "function", function: { arguments: "{}" } },
      { type: "function", function: { name: "get_today", arguments: "{}" } },
      { id: "", type: "function", function: { name: "get_today", arguments: "{}" } },
      null,
      { id: "t2", type: "function", function: { name: "respond", arguments: "{}" } },
    ] }, "tool_calls") }]);
    expect(await llm.next(REQ)).toEqual({ kind: "tools", text: "", calls: [{ id: "t2", name: "respond", input: {} }] });
  });
  it("only odd tool calls: a plain text step", async () => {
    const { llm } = llmWith([{ body: choice({ content: "hm", tool_calls: [{ id: "t0" }] }, "tool_calls") }]);
    expect(await llm.next(REQ)).toEqual({ kind: "text", text: "hm" });
  });
  it("trims trailing slashes from baseUrl", async () => {
    for (const baseUrl of ["https://x.test/v1/", "https://x.test/v1//"]) {
      const f = fakeFetch([{ body: choice({ content: "ok" }) }]);
      await new OpenAiCompatLlm({ baseUrl, apiKey: "k", model: "m", fetch: f.fetch }).next(REQ);
      expect(f.calls[0]!.url).toBe("https://x.test/v1/chat/completions");
    }
  });
  it("a 200 body without choices is retried once, with the same signal", async () => {
    const { llm, calls } = llmWith([{ body: { object: "chat.completion" } }, { body: choice({ content: "Hi" }) }]);
    expect(await llm.next(REQ)).toEqual({ kind: "text", text: "Hi" });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.signal).toBe(calls[0]!.init.signal);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
  });
  it("an unparseable 200 body is retried once", async () => {
    const { llm, calls } = llmWith([{ body: "not json" }, { body: choice({ content: "Hi" }) }]);
    expect(await llm.next(REQ)).toEqual({ kind: "text", text: "Hi" });
    expect(calls).toHaveLength(2);
  });
  it("5xx and 429 are retried once", async () => {
    for (const status of [500, 502, 503, 429]) {
      const { llm, calls } = llmWith([{ status, body: "busy" }, { body: choice({ content: "Hi" }) }]);
      expect(await llm.next(REQ)).toEqual({ kind: "text", text: "Hi" });
      expect(calls).toHaveLength(2);
    }
  });
  it("only one retry: a second failure is an LlmError", async () => {
    const { llm, calls } = llmWith([{ status: 503, body: "busy" }, { body: {} }, { body: choice({ content: "never" }) }]);
    await expect(llm.next(REQ)).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(2);
  });
  it("a 4xx (other than 429) is not retried", async () => {
    for (const status of [400, 401, 404]) {
      const { llm, calls } = llmWith([{ status, body: "bad" }, { body: choice({ content: "never" }) }]);
      await expect(llm.next(REQ)).rejects.toBeInstanceOf(LlmError);
      expect(calls).toHaveLength(1);
    }
  });
  it("finish_reason length is not retried", async () => {
    const { llm, calls } = llmWith([{ body: choice({ content: "cut" }, "length") }, { body: choice({ content: "never" }) }]);
    await expect(llm.next(REQ)).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(1);
  });
  it("an abort or timeout is not retried", async () => {
    let n = 0;
    const fetch = ((_u: string, init: RequestInit) => { n++; return Promise.reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")); }) as unknown as typeof globalThis.fetch;
    const llm = new OpenAiCompatLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch });
    await expect(llm.next(REQ, AbortSignal.abort())).rejects.toBeDefined();
    expect(n).toBe(1);
    const timeout = new OpenAiCompatLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch: (() => { n++; return Promise.reject(new DOMException("timed out", "TimeoutError")); }) as unknown as typeof globalThis.fetch });
    n = 0;
    await expect(timeout.next(REQ)).rejects.toBeDefined();
    expect(n).toBe(1);
  });
  it("no retry once the caller's signal aborted after an empty reply", async () => {
    const ctl = new AbortController();
    let n = 0;
    const fetch = ((_u: string, init: RequestInit) => {
      n++;
      if (init.signal?.aborted) return Promise.reject(init.signal.reason);
      ctl.abort();
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof globalThis.fetch;
    const llm = new OpenAiCompatLlm({ baseUrl: "https://x.test/v1", apiKey: "k", model: "m", fetch });
    await expect(llm.next(REQ, ctl.signal)).rejects.toBeDefined();
    expect(n).toBe(1);
  });
});
