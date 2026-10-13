import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicLlm } from "../src/anthropic";
import { OpenAiCompatLlm } from "../src/openai-compat";
import { chooseLlm, modelTuning } from "../src/provider";

describe("chooseLlm", () => {
  it("defaults to anthropic when its key is set", () => {
    const c = chooseLlm({ ANTHROPIC_API_KEY: "a", FEATHERLESS_API_KEY: "f" });
    expect(c.provider).toBe("anthropic");
    expect(c.llm).toBeInstanceOf(AnthropicLlm);
    expect(c.model).toBe("claude-sonnet-5-5");
  });
  it("falls back to featherless with its default model", () => {
    const c = chooseLlm({ FEATHERLESS_API_KEY: "f" });
    expect(c).toMatchObject({ provider: "featherless", model: "openai/gpt-oss-120b" });
    expect(c.llm).toBeInstanceOf(OpenAiCompatLlm);
  });
  it("MIA_MODEL overrides the model", () => {
    expect(chooseLlm({ FEATHERLESS_API_KEY: "f", MIA_MODEL: "other/m" }).model).toBe("other/m");
    expect(chooseLlm({ ANTHROPIC_API_KEY: "a", MIA_MODEL: "claude-x" }).model).toBe("claude-x");
  });
  it("throws naming both keys when none is set", () => {
    expect(() => chooseLlm({})).toThrow(/ANTHROPIC_API_KEY.*FEATHERLESS_API_KEY/);
  });
  it("LLM_PROVIDER forces a provider and requires its key", () => {
    expect(chooseLlm({ LLM_PROVIDER: "featherless", ANTHROPIC_API_KEY: "a", FEATHERLESS_API_KEY: "f" }).provider).toBe("featherless");
    expect(() => chooseLlm({ LLM_PROVIDER: "featherless", ANTHROPIC_API_KEY: "a" })).toThrow(/FEATHERLESS_API_KEY/);
    expect(() => chooseLlm({ LLM_PROVIDER: "anthropic", FEATHERLESS_API_KEY: "f" })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it("openai needs LLM_BASE_URL, LLM_API_KEY and MIA_MODEL", () => {
    const env = { LLM_PROVIDER: "openai", LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", MIA_MODEL: "m" };
    expect(chooseLlm(env)).toMatchObject({ provider: "openai", model: "m" });
    for (const missing of ["LLM_BASE_URL", "LLM_API_KEY", "MIA_MODEL"]) {
      const { [missing]: _drop, ...rest } = env as Record<string, string>;
      expect(() => chooseLlm(rest)).toThrow(new RegExp(missing));
    }
  });
  it("rejects an unknown provider", () => {
    expect(() => chooseLlm({ LLM_PROVIDER: "nope" })).toThrow(/LLM_PROVIDER/);
  });
  it("never puts a key in an error message", () => {
    try { chooseLlm({ LLM_PROVIDER: "openai", LLM_API_KEY: "sk-leak" }); } catch (e) { expect((e as Error).message).not.toContain("sk-leak"); }
  });
  describe("gpt-oss keeps reasoning short", () => {
    afterEach(() => vi.unstubAllGlobals());
    /** The body chooseLlm's model would send, through a stubbed global fetch. */
    async function bodyFor(env: Record<string, string>): Promise<Record<string, unknown>> {
      let body: Record<string, unknown> = {};
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
      });
      await chooseLlm(env).llm.next({ system: "s", messages: [{ role: "user", text: "hi" }], tools: [] });
      return body;
    }
    it("only a gpt-oss model gets reasoning_effort low and room for its reasoning", () => {
      expect(modelTuning("openai/gpt-oss-120b")).toEqual({ reasoningEffort: "low", maxTokens: 1024 });
      expect(modelTuning("openai/gpt-oss-20b")).toEqual({ reasoningEffort: "low", maxTokens: 1024 });
      // M-4: the model id is matched case-insensitively.
      expect(modelTuning("openai/GPT-OSS-120B")).toEqual({ reasoningEffort: "low", maxTokens: 1024 });
      expect(modelTuning("GPT-OSS-20B")).toEqual({ reasoningEffort: "low", maxTokens: 1024 });
      expect(modelTuning("mistralai/Mistral-Large-Instruct-2411")).toEqual({});
      expect(modelTuning("moonshotai/Kimi-K2-Instruct-0905")).toEqual({});
    });
    it("featherless default (gpt-oss) sends reasoning_effort low with max_tokens 1024", async () => {
      expect(await bodyFor({ FEATHERLESS_API_KEY: "f" })).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", max_tokens: 1024 });
    });
    it("another featherless or openai-compatible model sends neither", async () => {
      const mistral = await bodyFor({ FEATHERLESS_API_KEY: "f", MIA_MODEL: "mistralai/Mistral-Large-Instruct-2411" });
      expect(mistral).not.toHaveProperty("reasoning_effort");
      expect(mistral.max_tokens).toBe(400);
      expect(await bodyFor({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", MIA_MODEL: "m" })).not.toHaveProperty("reasoning_effort");
    });
    it("gpt-oss behind LLM_PROVIDER=openai is tuned the same way", async () => {
      const env = { LLM_PROVIDER: "openai", LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", MIA_MODEL: "gpt-oss-120b" };
      expect(await bodyFor(env)).toMatchObject({ reasoning_effort: "low", max_tokens: 1024 });
    });
  });
});
