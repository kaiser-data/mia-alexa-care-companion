import { LlmError, type ChatMessage, type Llm, type LlmRequest, type LlmStep, type ToolCall } from "./llm";

export interface OpenAiCompatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxTokens?: number;
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
  choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] }; finish_reason?: string }[];
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** Any OpenAI-compatible chat-completions endpoint (Featherless, OpenAI, vLLM, ...). */
export class OpenAiCompatLlm implements Llm {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  constructor(private readonly opts: OpenAiCompatOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxTokens = opts.maxTokens ?? 400;
  }

  async next(req: LlmRequest, signal?: AbortSignal): Promise<LlmStep> {
    const res = await this.fetchFn(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.maxTokens,
        messages: toOpenAi(req.system, req.messages),
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        tool_choice: "auto",
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)].filter((s): s is AbortSignal => !!s)),
    });
    if (!res.ok) throw new LlmError(`LLM request failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim());
    const body = (await res.json().catch(() => ({}))) as Completion;
    const choice = body.choices?.[0];
    if (!choice) throw new LlmError("LLM response had no choices");
    if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw new LlmError(`LLM stopped: ${choice.finish_reason}`);
    const text = choice.message?.content ?? "";
    const calls: ToolCall[] = (choice.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
    return calls.length ? { kind: "tools", text, calls } : { kind: "text", text };
  }
}
