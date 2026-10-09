import type { ToolInfo } from "./mcp";

export interface ToolCall { id: string; name: string; input: Record<string, unknown> }

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls?: ToolCall[] }
  | { role: "tool_results"; results: { id: string; content: string }[] };

export type LlmStep = { kind: "tools"; text: string; calls: ToolCall[] } | { kind: "text"; text: string };

export interface LlmRequest { system: string; messages: ChatMessage[]; tools: ToolInfo[] }

/** The "Alexa+ role": any model that can choose tools. Tests use a scripted fake. */
export interface Llm { next(req: LlmRequest): Promise<LlmStep> }
