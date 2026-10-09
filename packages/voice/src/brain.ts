import { detectDistress, localParts, NIGHT_END_MINUTES, splitSentences, templates, type Profile } from "@mia/shared";
import type { ChatMessage, Llm } from "./llm";
import type { MiaClient, ToolReply } from "./mcp";
import { enforceVerbatim } from "./verbatim";

export type VoiceProfile = Pick<Profile, "locale" | "timezone" | "speech" | "carerName" | "preferredName">;
export interface Reply { sentences: string[]; rate: number; breakMs: number; tools: string[]; action?: { type: "play_music"; artist: string } }
export interface TurnInput { text: string; confidence?: number }
export interface BrainDeps { mia: MiaClient; llm: Llm; profile: VoiceProfile; now: () => Date }

export const MAX_TOOL_ROUNDS = 4;
/** In-memory only; must be even so the history always starts with her turn. */
export const HISTORY_MESSAGES = 12;
/** Below this the transcript is treated as nothing heard. */
export const UNUSABLE_CONFIDENCE = 0.3;
export const REPEAT_SLOWER = 0.9;
export const SPEAKS_FIRST_MARKER = "(Mia started the conversation by herself.)";

export function systemPrompt(p: VoiceProfile): string {
  const language = p.locale === "de-DE" ? "German, using \"du\" and simple words" : "English";
  return [
    `You are Mia, the voice of a care companion for ${p.preferredName}, who has dementia and lives alone. You play the role of Alexa+.`,
    `Always answer in ${language}.`,
    "Use Mia's tools for anything about the day, appointments, pills, people, going out, coming home, feelings, the night, music or help. Never answer these from general knowledge.",
    "When a tool returns 'say' sentences, speak them exactly as written. You may add one warm lead-in of at most five words before them.",
    "At most four short sentences, at most twelve words each. Ask only yes/no questions. Never say she asked before. No medical advice. Never invent facts.",
    "If speech recognition was unsure, ask one yes/no question to check, like \"Do you mean your pills?\".",
    `If she answers yes to something Mia asked or offered, do what was offered. If she wants a person, offer to ask ${p.carerName} to call.`,
  ].join("\n");
}

export class Brain {
  private history: ChatMessage[] = [];
  private misses = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BrainDeps) {}

  turn(input: TurnInput): Promise<Reply> {
    return this.serial(async () => {
      try {
        return await this.handleTurn(input);
      } catch (err) {
        console.error("[mia-voice] turn failed:", err);
        const { profile: p } = this.deps;
        return this.reply(splitSentences(templates(p.locale).systemError(p.carerName), p.locale), []);
      }
    });
  }

  proactive(): Promise<Reply | null> {
    return this.serial(async () => {
      try {
        const prompt = await this.deps.mia.proactive();
        if (!prompt) return null;
        this.remember(SPEAKS_FIRST_MARKER, prompt.say);
        return this.reply(prompt.say, []);
      } catch (err) {
        console.error("[mia-voice] proactive failed:", err);
        return null;
      }
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async handleTurn(input: TurnInput): Promise<Reply> {
    const { mia, profile: p, now } = this.deps;
    const T = templates(p.locale);
    const text = input.text.trim();

    if (!text || (input.confidence !== undefined && input.confidence < UNUSABLE_CONFIDENCE)) {
      this.misses += 1;
      if (this.misses < 2) return this.reply([T.listening()], []);
      this.misses = 0;
      const today = await mia.call("get_today");
      return this.reply([...today.say, T.callOffer(p.carerName)], ["get_today"]);
    }
    this.misses = 0;

    if (detectDistress(text)) return this.direct(text, "report_problem", { what: text });
    if (localParts(now(), p.timezone).minutes < NIGHT_END_MINUTES) return this.direct(text, "night_reassurance", {});

    return this.llmTurn(text, input.confidence);
  }

  private async direct(text: string, tool: string, args: Record<string, unknown>): Promise<Reply> {
    const r = await this.deps.mia.call(tool, args);
    this.remember(text, r.say);
    return this.reply(r.say, [tool]);
  }

  private async llmTurn(text: string, confidence: number | undefined): Promise<Reply> {
    const { mia, llm, profile: p } = this.deps;
    const T = templates(p.locale);
    const userText = confidence !== undefined && confidence < p.speech.confidenceThreshold
      ? `(speech recognition unsure, confidence ${confidence.toFixed(2)}) ${text}`
      : text;
    const messages: ChatMessage[] = [...this.history, { role: "user", text: userText }];
    const tools = await mia.tools();
    const system = systemPrompt(p);
    const says: string[] = [];
    const seenSays = new Set<string>();
    const used: string[] = [];
    let action: Reply["action"];
    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const step = await llm.next({ system, messages, tools });
      if (step.kind === "text") { finalText = step.text; break; }
      messages.push({ role: "assistant", text: step.text, calls: step.calls });
      const results: { id: string; content: string }[] = [];
      for (const call of step.calls) {
        const r: ToolReply = await mia.call(call.name, call.input);
        used.push(call.name);
        // The same answer twice (the LLM called a tool again) is spoken once.
        const key = r.say.join("\n");
        if (r.verbatim && !seenSays.has(key)) { seenSays.add(key); says.push(...r.say); }
        if (r.facts.action === "play_music" && typeof r.facts.artist === "string") action = { type: "play_music", artist: r.facts.artist };
        results.push({ id: call.id, content: JSON.stringify({ say: r.say, facts: r.facts, guidance: r.guidance }) });
      }
      messages.push({ role: "tool_results", results });
    }

    let sentences = enforceVerbatim(finalText, says, p.locale);
    if (!sentences.length) sentences = [T.callOffer(p.carerName)];
    this.remember(text, sentences);
    return this.reply(sentences, used, action);
  }

  private remember(userText: string, said: string[]): void {
    this.history.push({ role: "user", text: userText }, { role: "assistant", text: said.join(" ") });
    this.history = this.history.slice(-HISTORY_MESSAGES);
  }

  private reply(said: string[], tools: string[], action?: Reply["action"]): Reply {
    const { speech, locale } = this.deps.profile;
    const rate = (speech.speechRate / 100) * (tools.includes("repeat_last") ? REPEAT_SLOWER : 1);
    const sentences = said.flatMap((s) => splitSentences(s, locale));
    return { sentences, rate, breakMs: speech.sentenceBreakMs, tools, ...(action ? { action } : {}) };
  }
}
