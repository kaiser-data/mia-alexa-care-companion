import type { Llm, LlmRequest, LlmStep } from "../src/llm";

/** Plays back a fixed list of LLM steps and records every request. */
export class ScriptedLlm implements Llm {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly steps: (LlmStep | Error)[]) {}
  async next(req: LlmRequest): Promise<LlmStep> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedLlm: no more steps");
    if (step instanceof Error) throw step;
    return step;
  }
}

export const tool = (name: string, input: Record<string, unknown> = {}, id = `call-${name}`): LlmStep =>
  ({ kind: "tools", text: "", calls: [{ id, name, input }] });
export const text = (t: string): LlmStep => ({ kind: "text", text: t });
