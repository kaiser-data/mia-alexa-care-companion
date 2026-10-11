import type { ToolInfo } from "./mcp";

export interface ToolCall { id: string; name: string; input: Record<string, unknown> }

export type ChatMessage =
  | { role: "user"; text: string }
  /** `raw`: the provider's assistant content exactly as received, passed back unchanged within the same turn. */
  | { role: "assistant"; text: string; calls?: ToolCall[]; raw?: unknown[] }
  | { role: "tool_results"; results: { id: string; content: string }[] };

export type LlmStep = { kind: "tools"; text: string; calls: ToolCall[]; raw?: unknown[] } | { kind: "text"; text: string };

export interface LlmRequest { system: string; messages: ChatMessage[]; tools: ToolInfo[] }

/** The model gave no usable answer (cut off, refused, context full); the Brain falls back calmly. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** The "Alexa+ role": any model that can choose tools. Tests use a scripted fake. `signal` aborts at the turn deadline. */
export interface Llm { next(req: LlmRequest, signal?: AbortSignal): Promise<LlmStep> }
