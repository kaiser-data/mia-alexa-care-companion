import type Anthropic from "@anthropic-ai/sdk";
import { LlmError, type ChatMessage, type Llm, type LlmRequest, type LlmStep } from "./llm";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Thinking tokens count toward this; replies are short phrase picks. */
export const MAX_TOKENS = 1024;
/** Adaptive thinking is on by default at high effort; Mia only needs a quick pick between tool calls. */
export const THINKING = { type: "between_tools" } as const;
export const OUTPUT_CONFIG = { effort: "low" } as const;

/** The part of the SDK client Mia uses, so tests can pass a fake without network. */
export interface MessagesClient {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<Anthropic.Message> };
}

export function toAnthropic(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "user") return { role: "user", content: m.text };
    if (m.role === "tool_results") {
      return { role: "user", content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content })) };
    }
    // Within a tool loop the content (thinking blocks included) goes back exactly as received.
    if (m.raw) return { role: "assistant", content: m.raw as Anthropic.ContentBlockParam[] };
    const content: Anthropic.ContentBlockParam[] = [];
    if (m.text) content.push({ type: "text", text: m.text });
    for (const c of m.calls ?? []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return { role: "assistant", content };
  });
}

/** Stop reasons after which the answer cannot be trusted or used. */
const FAILED_STOPS: Anthropic.StopReason[] = ["max_tokens", "refusal", "model_context_window_exceeded", "pause_turn"];

export function fromAnthropic(message: Pick<Anthropic.Message, "content"> & Partial<Pick<Anthropic.Message, "stop_reason">>): LlmStep {
  if (message.stop_reason && FAILED_STOPS.includes(message.stop_reason)) throw new LlmError(`LLM stopped: ${message.stop_reason}`);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text).join(" ").trim();
  const calls = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  return calls.length ? { kind: "tools", text, calls, raw: [...message.content] } : { kind: "text", text };
}

export function toRequest(req: LlmRequest, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    thinking: THINKING,
    output_config: OUTPUT_CONFIG,
    system: req.system,
    tools: req.tools.map((t) => ({
      name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      ...(t.strict ? { strict: true } : {}),
    })),
    messages: toAnthropic(req.messages),
  };
}

export class AnthropicLlm implements Llm {
  constructor(private readonly client: MessagesClient, private readonly model = DEFAULT_MODEL) {}

  async next(req: LlmRequest, signal?: AbortSignal): Promise<LlmStep> {
    const message = await this.client.messages.create(toRequest(req, this.model), signal ? { signal } : undefined);
    return fromAnthropic(message);
  }
}
