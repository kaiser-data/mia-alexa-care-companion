import { LlmError, type ChatMessage, type Llm, type LlmRequest, type LlmStep, type ToolCall } from "./llm";

export interface OpenAiCompatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxTokens?: number;
  /** Sent as reasoning_effort only when set: a reasoning model (gpt-oss) accepts it, others reject unknown parameters. */
  reasoningEffort?: "low" | "medium" | "high";
}

type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAi(system: string, messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "tool_results") for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.content });
    else {
      out.push({
        role: "assistant", content: m.text || null,
        ...(m.calls?.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
    }
  }
  return out;
}

interface Completion {
  choices?: { message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string }[];
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** A provider's tool call, or null when it lacks an id or a function name: such a call is skipped, never a TypeError. */
function toCall(raw: unknown): ToolCall | null {
  const c = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | null;
  if (!c || typeof c.id !== "string" || !c.id || typeof c.function?.name !== "string" || !c.function.name) return null;
  return { id: c.id, name: c.function.name, input: parseArgs(typeof c.function.arguments === "string" ? c.function.arguments : undefined) };
}

/** Worth one more try: the provider was busy or sent an empty answer. Never a 4xx (except 429), an abort or a timeout. */
class Retryable extends LlmError {}

/** Any OpenAI-compatible chat-completions endpoint (Featherless, OpenAI, vLLM, ...). */
export class OpenAiCompatLlm implements Llm {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly url: string;
  constructor(private readonly opts: OpenAiCompatOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxTokens = opts.maxTokens ?? 400;
    this.url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  /** One retry when the response is empty or a 5xx/429, on the same combined signal: the Brain deadline still ends it. */
  async next(req: LlmRequest, signal?: AbortSignal): Promise<LlmStep> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)].filter((s): s is AbortSignal => !!s));
    const body = JSON.stringify({
      model: this.opts.model,
      max_tokens: this.maxTokens,
      ...(this.opts.reasoningEffort ? { reasoning_effort: this.opts.reasoningEffort } : {}),
      messages: toOpenAi(req.system, req.messages),
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      tool_choice: "auto",
    });
    try {
      return await this.once(body, combined);
    } catch (e) {
      if (!(e instanceof Retryable) || combined.aborted) throw e;
      return this.once(body, combined);
    }
  }

  private async once(body: string, signal: AbortSignal): Promise<LlmStep> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body,
      signal,
    });
    if (!res.ok) {
      const msg = `LLM request failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim();
      throw res.status >= 500 || res.status === 429 ? new Retryable(msg) : new LlmError(msg);
    }
    const parsed = (await res.json().catch(() => ({}))) as Completion;
    const choice = parsed.choices?.[0];
    if (!choice) throw new Retryable("LLM response had no choices");
    if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw new LlmError(`LLM stopped: ${choice.finish_reason}`);
    const text = choice.message?.content ?? "";
    const calls = (choice.message?.tool_calls ?? []).map(toCall).filter((c): c is ToolCall => c !== null);
    return calls.length ? { kind: "tools", text, calls } : { kind: "text", text };
  }
}
