import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, Llm, LlmRequest, LlmStep } from "./llm";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const MAX_TOKENS = 400;

export function toAnthropic(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "user") return { role: "user", content: m.text };
    if (m.role === "tool_results") {
      return { role: "user", content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content })) };
    }
    const content: Anthropic.ContentBlockParam[] = [];
    if (m.text) content.push({ type: "text", text: m.text });
    for (const c of m.calls ?? []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return { role: "assistant", content };
  });
}

export function fromAnthropic(message: Pick<Anthropic.Message, "content">): LlmStep {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text).join(" ").trim();
  const calls = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  return calls.length ? { kind: "tools", text, calls } : { kind: "text", text };
}

export class AnthropicLlm implements Llm {
  constructor(private readonly client: Anthropic, private readonly model = DEFAULT_MODEL) {}

  async next(req: LlmRequest): Promise<LlmStep> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: req.system,
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
      messages: toAnthropic(req.messages),
    });
    return fromAnthropic(message);
  }
}
