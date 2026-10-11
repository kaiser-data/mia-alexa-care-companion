import { detectDistress, localParts, NIGHT_END_MINUTES, splitSentences, templates, type Profile } from "@mia/shared";
import type { ChatMessage, Llm } from "./llm";
import { MiaToolError, type MiaClient, type ToolReply } from "./mcp";
import { compose, readRespond, RESPOND_TOOL, type ChatFacts, type RespondInput } from "./compose";

export type VoiceProfile = Pick<Profile, "locale" | "timezone" | "speech" | "carerName" | "preferredName">;
export interface Reply { sentences: string[]; rate: number; breakMs: number; tools: string[]; action?: { type: "play_music"; artist: string } }
export interface TurnInput { text: string; confidence?: number }
export interface BrainDeps { mia: MiaClient; llm: Llm; profile: VoiceProfile; now: () => Date; turnDeadlineMs?: number }

export const MAX_TOOL_ROUNDS = 4;
/** In-memory only; must be even so the history always starts with her turn. */
export const HISTORY_MESSAGES = 12;
/** Below this the transcript is treated as nothing heard. */
export const UNUSABLE_CONFIDENCE = 0.3;
export const REPEAT_SLOWER = 0.9;
/** Within this time after a night reassurance, the next thing she says goes to the LLM, which sees that answer. */
export const NIGHT_REPEAT_MINUTES = 10;
/** The LLM part of a turn may take at most this long; then she hears what the tools said, or a calm fallback. */
export const TURN_DEADLINE_MS = 10_000;
export const NOT_UNDERSTOOD_MARKER = "(not understood)";
export const SPEAKS_FIRST_MARKER = "(Mia started the conversation by herself.)";

/** answer: a real answer; repeat: a repeated answer; filler: "I'm listening." or the calm fallback, never repeated. */
type ReplyKind = "answer" | "repeat" | "filler";

export function systemPrompt(p: VoiceProfile): string {
  const language = p.locale === "de-DE" ? "German, using \"du\" and simple words" : "English";
  return [
    `You are Mia, the voice of a care companion for ${p.preferredName}, who has dementia and lives alone. You play the role of Alexa+.`,
    `Always answer in ${language}.`,
    "You never write what Mia says. You choose: Mia's tools speak the facts, and the respond tool adds short warm phrases from a fixed list.",
    "Use Mia's tools for every fact: the day, appointments, pills, people, going out, coming home, feelings, the night, music or help. Never answer these from general knowledge.",
    "Always finish your turn by calling respond. Any text you write outside a tool call is ignored and never spoken.",
    "In respond, choose at most one opener or feeling and at most one yes/no question or closing; use \"none\" where nothing fits. Leave chat empty unless chat_about_life just ran.",
    "If speech recognition was unsure, call respond with a checking question, like question \"check_pills\" or \"check_day\".",
    `If she wants a person, choose question "offer_call" (ask ${p.carerName} to call). If you are unsure what she wants, choose "anything_else" or "offer_call".`,
    "If she answers yes to something Mia asked or offered, call the tool that does what was offered.",
    "After chat_about_life, chat may hold one or two short warm sentences about the suggested topic, using only facts from that tool. No medicine, no dates.",
  ].join("\n");
}

/** What one LLM turn has collected so far; kept outside the loop so a failure or timeout can still speak it. */
interface TurnState { says: string[]; seenSays: Set<string>; used: string[]; chatFacts?: ChatFacts; choice: RespondInput | null; action?: Reply["action"]; finished: boolean }

export class Brain {
  private history: ChatMessage[] = [];
  private misses = 0;
  private lastSpoken: string[] = [];
  /** What chat_about_life returned in the previous turn: chat text may draw on it for one more turn. */
  private lastChatFacts?: ChatFacts;
  private lastNightAt?: Date;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BrainDeps) {}

  turn(input: TurnInput): Promise<Reply> {
    return this.serial(async () => {
      try {
        return await this.handleTurn(input);
      } catch (err) {
        console.error("[mia-voice] turn failed:", err);
        return this.reply(this.systemError(), [], undefined, "filler");
      }
    });
  }

  proactive(): Promise<Reply | null> {
    return this.serial(async () => {
      try {
        const prompt = await this.deps.mia.proactive();
        if (!prompt) return null;
        this.misses = 0;
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

  private systemError(): string[] {
    const { locale, carerName } = this.deps.profile;
    return splitSentences(templates(locale).systemError(carerName), locale);
  }

  private async handleTurn(input: TurnInput): Promise<Reply> {
    const { mia, profile: p, now } = this.deps;
    const T = templates(p.locale);
    const text = input.text.trim();
    const previousChat = this.lastChatFacts;
    this.lastChatFacts = undefined;

    // A possible fall always alerts, however unsure the speech recognition was.
    if (text && detectDistress(text)) {
      this.misses = 0;
      return this.direct(text, "report_problem", { what: text });
    }

    if (!text || (input.confidence !== undefined && input.confidence < UNUSABLE_CONFIDENCE)) {
      this.misses += 1;
      if (this.misses < 2) return this.reply([T.listening()], [], undefined, "filler");
      this.misses = 0;
      const today = await mia.call("get_today");
      const said = [...today.say, T.callOffer(p.carerName)];
      // So that a following "yes" reaches the LLM with the call offer in view.
      this.remember(NOT_UNDERSTOOD_MARKER, said);
      return this.reply(said, ["get_today"]);
    }
    this.misses = 0;

    if (localParts(now(), p.timezone).minutes < NIGHT_END_MINUTES && !this.nightAnsweredRecently()) {
      return this.direct(text, "night_reassurance", {});
    }

    return this.llmTurn(text, input.confidence, previousChat);
  }

  private nightAnsweredRecently(): boolean {
    if (!this.lastNightAt) return false;
    return this.deps.now().getTime() - this.lastNightAt.getTime() < NIGHT_REPEAT_MINUTES * 60_000;
  }

  /** Calls one tool and speaks its answer word for word. */
  private async direct(text: string, tool: string, args: Record<string, unknown>): Promise<Reply> {
    const r = await this.deps.mia.call(tool, args);
    const said = r.say.flatMap((s) => splitSentences(s, this.deps.profile.locale));
    this.remember(text, said);
    return this.reply(said, [tool]);
  }

  private async llmTurn(text: string, confidence: number | undefined, previousChat: ChatFacts | undefined): Promise<Reply> {
    const { profile: p } = this.deps;
    const state: TurnState = { says: [], seenSays: new Set(), used: [], choice: null, finished: false };
    const deadlineMs = this.deps.turnDeadlineMs ?? TURN_DEADLINE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), deadlineMs); });

    try {
      const outcome = await Promise.race([this.llmLoop(text, confidence, state), deadline]);
      if (outcome === "timeout") {
        console.error(`[mia-voice] turn deadline of ${deadlineMs} ms reached`);
        return this.fallback(text, state);
      }
    } catch (err) {
      if (!state.says.length) throw err;
      console.error("[mia-voice] LLM failed after a tool answered:", err);
      return this.fallback(text, state);
    } finally {
      state.finished = true;
      clearTimeout(timer);
    }

    const { says, used, action } = state;
    if (used.includes("repeat_last") && this.lastSpoken.length) {
      this.remember(text, this.lastSpoken);
      return this.reply(this.lastSpoken, used, action, "repeat");
    }

    // Chat text may follow chat_about_life of this turn or of the turn before.
    const chatFacts = state.chatFacts ?? previousChat;
    this.lastChatFacts = state.chatFacts;
    const sentences = compose(says, state.choice, {
      locale: p.locale, name: p.preferredName, carer: p.carerName, ...(chatFacts ? { chatFacts } : {}),
    });
    this.remember(text, sentences);
    return this.reply(sentences, used, action);
  }

  /** The LLM failed or ran out of time: speak what the tools already said, else the calm fallback. */
  private fallback(text: string, state: TurnState): Reply {
    if (!state.says.length) return this.reply(this.systemError(), [...state.used], undefined, "filler");
    const said = state.says.flatMap((s) => splitSentences(s, this.deps.profile.locale));
    this.remember(text, said);
    return this.reply(said, [...state.used], state.action);
  }

  private async llmLoop(text: string, confidence: number | undefined, state: TurnState): Promise<void> {
    const { mia, llm, profile: p } = this.deps;
    const userText = confidence !== undefined && confidence < p.speech.confidenceThreshold
      ? `(speech recognition unsure, confidence ${confidence.toFixed(2)}) ${text}`
      : text;
    const messages: ChatMessage[] = [...this.history, { role: "user", text: userText }];
    // respond always last, so the tool list stays byte-identical across requests.
    const tools = [...(await mia.tools()), RESPOND_TOOL];
    const system = systemPrompt(p);

    for (let round = 0; round < MAX_TOOL_ROUNDS && !state.finished; round++) {
      const step = await llm.next({ system, messages, tools });
      // Claude picks, doesn't write: free text is never spoken, and only its length is logged.
      if (step.text) console.log(`[mia-voice] ignored ${step.text.length} characters of LLM text`);
      if (step.kind === "text") return;
      messages.push({ role: "assistant", text: step.text, calls: step.calls });
      const results: { id: string; content: string }[] = [];
      let responded = false;
      for (const call of step.calls) {
        if (state.finished) return;
        if (call.name === RESPOND_TOOL.name) {
          state.choice = readRespond(call.input);
          responded = true;
          continue;
        }
        let r: ToolReply;
        try {
          r = await mia.call(call.name, call.input);
        } catch (err) {
          // The model gets the error and can recover (ask again, offer a call).
          if (!(err instanceof MiaToolError)) throw err;
          results.push({ id: call.id, content: JSON.stringify({ error: err.text }) });
          continue;
        }
        state.used.push(call.name);
        if (call.name === "chat_about_life" && !r.verbatim) state.chatFacts = chatFactsOf(r.facts);
        // The same answer twice (the LLM called a tool again) is spoken once.
        const key = r.say.join("\n");
        if (r.verbatim && !state.seenSays.has(key)) { state.seenSays.add(key); state.says.push(...r.say); }
        if (r.facts.action === "play_music" && typeof r.facts.artist === "string") state.action = { type: "play_music", artist: r.facts.artist };
        results.push({ id: call.id, content: JSON.stringify({ say: r.say, facts: r.facts, guidance: r.guidance }) });
      }
      if (responded) return;
      messages.push({ role: "tool_results", results });
    }
  }

  private remember(userText: string, said: string[]): void {
    this.history.push({ role: "user", text: userText }, { role: "assistant", text: said.join(" ") });
    this.history = this.history.slice(-HISTORY_MESSAGES);
  }

  private reply(said: string[], tools: string[], action?: Reply["action"], kind: ReplyKind = "answer"): Reply {
    const { speech, locale } = this.deps.profile;
    const rate = (speech.speechRate / 100) * (kind === "repeat" || tools.includes("repeat_last") ? REPEAT_SLOWER : 1);
    const sentences = said.flatMap((s) => splitSentences(s, locale));
    // "Pardon?" repeats the last real answer; a filler or a repeat leaves it, and the pill context, as they were.
    if (kind === "answer") this.lastSpoken = sentences;
    this.lastNightAt = tools.includes("night_reassurance") ? this.deps.now() : undefined;
    return { sentences, rate, breakMs: speech.sentenceBreakMs, tools, ...(action ? { action } : {}) };
  }
}

function chatFactsOf(facts: Record<string, unknown>): ChatFacts {
  const topics = Array.isArray(facts.topics) ? facts.topics.filter((t): t is string => typeof t === "string") : [];
  return {
    topics,
    suggestedTopic: typeof facts.suggestedTopic === "string" ? facts.suggestedTopic : "",
    ...(typeof facts.carerName === "string" ? { carerName: facts.carerName } : {}),
  };
}
