import Anthropic from "@anthropic-ai/sdk";
import { AnthropicLlm, DEFAULT_MODEL } from "./anthropic";
import type { Llm } from "./llm";
import { OpenAiCompatLlm, type OpenAiCompatOptions } from "./openai-compat";

export type Provider = "anthropic" | "featherless" | "openai";
export interface ChosenLlm { llm: Llm; provider: Provider; model: string }
type Env = Record<string, string | undefined>;

export const FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1";
/**
 * Live probe 2026-10-12: gpt-oss-120b picked the right tool 15/15 at 3–5 s per turn. Kimi K2 0905 is faster (~1.7 s per
 * step) but answered both pill questions without calling the pill tool; it stays available via MIA_MODEL.
 */
export const FEATHERLESS_MODEL = "openai/gpt-oss-120b";

/**
 * gpt-oss is a reasoning model, and its reasoning tokens count against max_tokens: with 400 it once stopped with
 * finish_reason "length" on the second step. Featherless accepts reasoning_effort "low" for it (checked 2026-10-12);
 * other models reject the unknown parameter with HTTP 400, so it is sent to gpt-oss only (matched case-insensitively).
 * With LLM_PROVIDER=openai any backend serving a gpt-oss id gets it too: Groq and vLLM accept it, other gateways may not.
 */
export function modelTuning(model: string): Pick<OpenAiCompatOptions, "reasoningEffort" | "maxTokens"> {
  return model.toLowerCase().includes("gpt-oss") ? { reasoningEffort: "low", maxTokens: 1024 } : {};
}

function need(env: Env, name: string, why = ""): string {
  const v = env[name];
  if (!v) throw new Error(`Set ${name}${why}`);
  return v;
}

/** Picks the model provider from the environment. Error messages name variables, never values. */
export function chooseLlm(env: Env): ChosenLlm {
  const provider = env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : env.FEATHERLESS_API_KEY ? "featherless" : undefined);
  if (!provider) throw new Error("No LLM configured: set ANTHROPIC_API_KEY or FEATHERLESS_API_KEY (or LLM_PROVIDER=openai with LLM_BASE_URL, LLM_API_KEY, MIA_MODEL)");
  switch (provider) {
    case "anthropic": {
      const apiKey = need(env, "ANTHROPIC_API_KEY", " for LLM_PROVIDER=anthropic");
      const model = env.MIA_MODEL ?? DEFAULT_MODEL;
      return { provider, model, llm: new AnthropicLlm(new Anthropic({ apiKey, timeout: 8000, maxRetries: 0 }), model) };
    }
    case "featherless": {
      const apiKey = need(env, "FEATHERLESS_API_KEY", " for LLM_PROVIDER=featherless");
      const model = env.MIA_MODEL ?? FEATHERLESS_MODEL;
      return { provider, model, llm: new OpenAiCompatLlm({ baseUrl: FEATHERLESS_BASE_URL, apiKey, model, ...modelTuning(model) }) };
    }
    case "openai": {
      const baseUrl = need(env, "LLM_BASE_URL", " for LLM_PROVIDER=openai");
      const apiKey = need(env, "LLM_API_KEY", " for LLM_PROVIDER=openai");
      const model = need(env, "MIA_MODEL", " for LLM_PROVIDER=openai");
      return { provider, model, llm: new OpenAiCompatLlm({ baseUrl, apiKey, model, ...modelTuning(model) }) };
    }
    default:
      throw new Error("LLM_PROVIDER must be one of: anthropic, featherless, openai");
  }
}
