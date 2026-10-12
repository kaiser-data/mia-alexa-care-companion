import { describe, expect, it } from "vitest";
import { AnthropicLlm } from "../src/anthropic";
import { OpenAiCompatLlm } from "../src/openai-compat";
import { chooseLlm } from "../src/provider";

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
});
