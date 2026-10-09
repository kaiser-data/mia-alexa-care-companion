# Plan 2 — Mia Voice Simulator (local mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser "Echo" that Rose can simply talk to — no name, no wake word — backed by a voice gateway where Claude acts as the Alexa+ MCP client over the Plan 1 Mia server, with Mia speaking first at the right times, night mode, a distress keyword guard, verbatim critical sentences, weather on the way out and a favourite-music offer.

**Architecture:** New package `packages/voice` (Hono gateway + static browser UI). The browser does speech in/out with the Web Speech API (local mode), sends each finished turn as text + confidence to the gateway. The gateway's `Brain` runs: misses → distress guard → night mode → Claude tool loop over Mia's MCP tools → verbatim enforcement, and returns sentences + rate + pauses. Proactive prompts are computed on the Mia server (pure domain function) and exposed at `GET /proactive` — our demonstration of the "Care Mode" proposal (an add-on asking Alexa to speak first). In local mode one command starts the Mia server in-process and the gateway.

**Tech Stack:** Node 24, pnpm 10, TypeScript 7.0.2, Vitest 5.0.3, tsx 4.23.15, `@modelcontextprotocol/sdk` 1.32.1 (client + server), `@anthropic-ai/sdk` 0.132.1, Hono 4.13.13, `@hono/node-server` 2.1.3, Open-Meteo (no key), browser Web Speech API + Web Audio.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-06-mia-design.md` — §6.1 automatic start, §8 speaking rules, §9 listening rules are binding.
- She never learns anything: no add-on name, no wake word inside a session; one large tap target starts the session (§6.1, §9.2).
- Speaking: ≤ 4 sentences per turn, ≤ 12 words per sentence, key fact first and last, yes/no questions only, never "you already asked", no medical advice, never invent facts (§8). Every proactive prompt ends with a yes/no question (§6.1).
- Critical facts verbatim: the LLM may add one short warm lead-in only (≤ 5 words); otherwise the tool's `say` sentences are spoken as written (§8 rule 6).
- "Pardon?" → verbatim repeat, 10 % slower (§8 rule 7). Default rate 90 %, 700 ms breaks (§8 rule 3) from `profile.speech`.
- Listening: end of turn after `speech.endOfTurnTimeoutMs` of silence (default 1800 ms), never cut her off; low confidence → one yes/no check, never "I didn't understand"; two misses → safe default (today + offer to call carer) (§9).
- Distress double check: keyword list per language **or** LLM → `report_problem` (§9.7). Night mode 00:00–05:00: speech goes to `night_reassurance` first (§6.1).
- Medication policy (owner decision): Mia only says "take it" for a dose inside its window with no conflicting signal; proactive pill prompts only for doses in state `due`.
- Local mode only in this plan: Web Speech in/out, Claude via `ANTHROPIC_API_KEY`, gateway binds `127.0.0.1`, visible "LOCAL MODE — not production" banner (§5.3). Secrets only from env / `.env` (gitignored); never in code, tests or logs. The key is stored with the `keys` CLI by the owner.
- Default model `claude-sonnet-5-5`, override with `MIA_MODEL`.
- MCP tools stay < 500 ms: weather fetch has a 250 ms timeout and a per-day cache; failures mean "no weather sentence".
- Only fictional Rose data anywhere. No audio or transcripts stored by the gateway (in-memory conversation history only, last 12 messages).
- en-US and de-DE behave identically; German uses "du" and *Einfache Sprache*.
- `pnpm test && pnpm typecheck` green before every commit; commit trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; after code changes `graphify update .` (project rule; `graphify-out/` is gitignored).
- Deferred (by design): family voice messages move to Plan 3 (recording needs the carer page); language switching mid-conversation (§9.8), Transcribe/Polly/Bedrock (Plan 4), calibration wizard (Plan 5).

## File Structure

```
packages/shared/src/
  domain/types.ts          + RoutineItem.kind, Profile.location/favouriteMusic/checkInTime, 2 event types
  domain/proactive.ts      NEW proactivePrompt(): which prompt Mia should speak now, if any
  i18n/distress.ts         NEW detectDistress(): keyword guard, en + de
  i18n/templates.ts        + proactive, music, weather, listening templates
  seed/rose.ts             + location, favourite music, check-in time, bedtime kind, SEED_PROFILES
packages/mcp-server/src/
  local.ts                 NEW startLocalMia(), checkDevToken() — shared by both entry points
  testing.ts               NEW inMemoryMia() for tests in other packages
  proactive.ts             NEW nextProactive(): prompt + log proactive_spoken
  weather.ts               NEW WeatherProvider, OpenMeteoWeather, weatherLine()
  tools/music.ts           NEW play_music
  tools/runtime.ts         ToolContext.weather?
  tools/orientation.ts     get_preparation_steps adds the weather sentence
  http.ts                  + GET /proactive
  server.ts                registers music tools
  main.ts                  uses startLocalMia
packages/voice/
  package.json, tsconfig.json
  src/mcp.ts               connectMia(): MCP client + /proactive
  src/llm.ts               neutral LLM interface (ChatMessage, LlmStep, Llm)
  src/anthropic.ts         AnthropicLlm adapter + pure converters
  src/verbatim.ts          enforceVerbatim()
  src/brain.ts             Brain: one turn, proactive, history, misses
  src/server.ts            createVoiceApp(): /api/turn, /api/proactive, /api/config, static files
  src/main.ts              local entry point (starts Mia in-process + gateway)
  public/index.html, style.css, app.js, turn.js, turn.d.ts   browser "Echo"
  test/*.test.ts
```

---

### Task 1: Shared — profile fields, seeds, distress guard, new templates

**Files:**
- Modify: `packages/shared/src/domain/types.ts`, `packages/shared/src/seed/rose.ts`, `packages/shared/src/i18n/templates.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/i18n/distress.ts`
- Test: `packages/shared/test/distress.test.ts`, `packages/shared/test/templates.test.ts` (append), `packages/shared/test/seed.test.ts` (new)

**Interfaces:**
- Produces: `RoutineItem.kind?: "bedtime"`; `Profile.location?: { latitude: number; longitude: number }`, `Profile.favouriteMusic?: string`, `Profile.checkInTime?: HHMM`; event types `"proactive_spoken"`, `"music_played"`; `detectDistress(text: string): boolean`; `SEED_PROFILES`, `type SeedId`, `isSeedId(s: string): s is SeedId`; templates `listening()`, `musicStart(artist)`, `weatherCold()`, `weatherRain()`, `proMedAsk(name)`, `proPrepAsk()`, `proAreYouHome(name)`, `proBedtime(time)`, `proDoorAsk()`, `proMusicAsk(artist)`, `proHello(name)`, `proChatAsk()`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/distress.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { detectDistress } from "../src/i18n/distress";

describe("detectDistress", () => {
  it.each([
    "I fell", "I fell in the kitchen", "help", "Help!", "help me", "please help", "I can't get up",
    "I can’t get up", "my hip hurts", "call an ambulance", "I'm bleeding",
    "Hilfe!", "Ich bin gestürzt", "Ich bin hingefallen", "Mir tut der Rücken weh", "Ich komme nicht hoch", "Ruf den Notarzt",
  ])("detects %j", (t) => expect(detectDistress(t)).toBe(true));
  it.each([
    "Can you help me find my glasses please", "Did I take my pills?", "I fell asleep in my chair",
    "What a help you are to me today", "Ich brauche Hilfe beim Kochen heute Abend", "Wann ist die Gruppe?", "", "   ",
  ])("ignores %j", (t) => expect(detectDistress(t)).toBe(false));
});
```

`packages/shared/test/seed.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isSeedId, rose, roseDe, SEED_PROFILES } from "../src/seed/rose";

describe("seed profiles", () => {
  it("Rose has a location, favourite music, a check-in time and a bedtime", () => {
    const p = rose();
    expect(p.location).toEqual({ latitude: 39.9612, longitude: -82.9988 });
    expect(p.favouriteMusic).toBe("Frank Sinatra");
    expect(p.checkInTime).toBe("15:30");
    expect(p.routine.find((r) => r.kind === "bedtime")?.time).toBe("21:30");
    expect(roseDe().routine.find((r) => r.kind === "bedtime")?.time).toBe("21:30");
  });
  it("seed ids", () => {
    expect(Object.keys(SEED_PROFILES)).toEqual(["rose", "rose-de"]);
    expect(isSeedId("rose-de")).toBe(true);
    expect(isSeedId("toString")).toBe(false);
    expect(isSeedId("foo")).toBe(false);
  });
});
```

Append to `packages/shared/test/templates.test.ts`:
```ts
describe("Plan 2 templates", () => {
  it("en-US", () => {
    const T = templates("en-US");
    expect(T.listening()).toBe("I'm listening.");
    expect(T.musicStart("Frank Sinatra")).toBe("Here is some Frank Sinatra.");
    expect(T.weatherCold()).toBe("It's cold today. Wear your warm coat.");
    expect(T.weatherRain()).toBe("It may rain today. Take your umbrella.");
    expect(T.proMedAsk("your morning pills")).toBe("Have you taken your morning pills yet?");
    expect(T.proPrepAsk()).toBe("Shall I tell you what to take?");
    expect(T.proAreYouHome("Rose")).toBe("Are you back home, Rose?");
    expect(T.proBedtime("half past nine")).toBe("It's half past nine. Time to get ready for bed.");
    expect(T.proDoorAsk()).toBe("Is the front door locked?");
    expect(T.proMusicAsk("Frank Sinatra")).toBe("Shall I play some Frank Sinatra?");
    expect(T.proHello("Rose")).toBe("Hello, Rose.");
    expect(T.proChatAsk()).toBe("Shall we have a little chat?");
  });
  it("de-DE", () => {
    const T = templates("de-DE");
    expect(T.listening()).toBe("Ich höre zu.");
    expect(T.musicStart("Frank Sinatra")).toBe("Hier ist etwas von Frank Sinatra.");
    expect(T.weatherCold()).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
    expect(T.weatherRain()).toBe("Heute regnet es vielleicht. Nimm deinen Schirm mit.");
    expect(T.proMedAsk("deine Morgentabletten")).toBe("Hast du deine Morgentabletten schon genommen?");
    expect(T.proPrepAsk()).toBe("Soll ich dir sagen, was du mitnimmst?");
    expect(T.proAreYouHome("Rose")).toBe("Bist du wieder zu Hause, Rose?");
    expect(T.proBedtime("halb zehn")).toBe("Es ist halb zehn. Bald ist Schlafenszeit.");
    expect(T.proDoorAsk()).toBe("Ist die Haustür abgeschlossen?");
    expect(T.proMusicAsk("Frank Sinatra")).toBe("Soll ich etwas von Frank Sinatra spielen?");
    expect(T.proHello("Rose")).toBe("Hallo, Rose.");
    expect(T.proChatAsk()).toBe("Wollen wir ein bisschen plaudern?");
  });
});
```
(If `templates` is not yet imported in that file, add `import { templates } from "../src/i18n/templates";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/shared/test/distress.test.ts packages/shared/test/seed.test.ts packages/shared/test/templates.test.ts`
Expected: FAIL — module `../src/i18n/distress` not found, `SEED_PROFILES` not exported, `T.listening is not a function`.

- [ ] **Step 3: Implement**

`packages/shared/src/domain/types.ts`:
- Change `RoutineItem` to:
```ts
export interface RoutineItem { time: HHMM; label: string; kind?: "bedtime" }
```
- Add to `Profile` (after `speech`):
```ts
  /** for the weather sentence on the way out */
  location?: { latitude: number; longitude: number };
  /** offered in the late afternoon: "Shall I play some Frank Sinatra?" */
  favouriteMusic?: string;
  /** daily gentle check-in for loneliness, e.g. "15:30" */
  checkInTime?: HHMM;
```
- Append `"proactive_spoken", "music_played"` to the end of the `EVENT_TYPES` array (keep all existing entries and their order).

`packages/shared/src/seed/rose.ts`:
- In `rose()`: change the bedtime routine item to `{ time: "21:30", label: "bedtime", kind: "bedtime" }` and add after `speech: defaultSpeech(),`:
```ts
    location: { latitude: 39.9612, longitude: -82.9988 },
    favouriteMusic: "Frank Sinatra",
    checkInTime: "15:30",
```
- In `roseDe()`: change its bedtime item to `{ time: "21:30", label: "Schlafenszeit", kind: "bedtime" }` (location, music and check-in time come from `...p`).
- At the end of the file:
```ts
export const SEED_PROFILES = { rose, "rose-de": roseDe } as const;
export type SeedId = keyof typeof SEED_PROFILES;
export const isSeedId = (s: string): s is SeedId => Object.hasOwn(SEED_PROFILES, s);
```

`packages/shared/src/i18n/distress.ts`:
```ts
/**
 * Keyword half of the distress double check (spec §9.7): either this or the LLM triggers report_problem.
 * Both languages are always checked — she may switch language when frightened.
 * A false alarm costs a message to the carer; a missed fall costs far more, so the lists lean towards alarm.
 */
const ALWAYS = [
  "i fell", "fell down", "fallen down", "i've fallen", "i have fallen", "can't get up", "cannot get up", "can not get up",
  "hurt", "hurts", "in pain", "ambulance", "emergency", "bleeding", "call for help",
  "gestürzt", "hingefallen", "umgefallen", "komme nicht hoch", "kann nicht aufstehen", "weh", "schmerzen",
  "notarzt", "krankenwagen", "notfall", "blute", "hilfe holen",
];
/** Only alarming on their own: "help" in a long sentence is usually an ordinary request. */
const SHORT_ONLY = ["help", "help me", "please help", "help please", "hilfe", "hilf mir", "bitte hilfe", "hilfe bitte"];
export const SHORT_UTTERANCE_WORDS = 4;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\b(fell|fallen) asleep\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDistress(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  const padded = ` ${n} `;
  const has = (phrase: string) => padded.includes(` ${phrase} `);
  if (ALWAYS.some(has)) return true;
  return n.split(" ").length <= SHORT_UTTERANCE_WORDS && SHORT_ONLY.some(has);
}
```

`packages/shared/src/i18n/templates.ts` — add to the `Templates` interface:
```ts
  listening(): string;
  musicStart(artist: string): string;
  weatherCold(): string;
  weatherRain(): string;
  proMedAsk(name: string): string;
  proPrepAsk(): string;
  proAreYouHome(name: string): string;
  proBedtime(time: string): string;
  proDoorAsk(): string;
  proMusicAsk(artist: string): string;
  proHello(name: string): string;
  proChatAsk(): string;
```
add to `EN`:
```ts
  listening: () => "I'm listening.",
  musicStart: (a) => `Here is some ${a}.`,
  weatherCold: () => "It's cold today. Wear your warm coat.",
  weatherRain: () => "It may rain today. Take your umbrella.",
  proMedAsk: (n) => `Have you taken ${n} yet?`,
  proPrepAsk: () => "Shall I tell you what to take?",
  proAreYouHome: (n) => `Are you back home, ${n}?`,
  proBedtime: (t) => `It's ${t}. Time to get ready for bed.`,
  proDoorAsk: () => "Is the front door locked?",
  proMusicAsk: (a) => `Shall I play some ${a}?`,
  proHello: (n) => `Hello, ${n}.`,
  proChatAsk: () => "Shall we have a little chat?",
```
add to `DE`:
```ts
  listening: () => "Ich höre zu.",
  musicStart: (a) => `Hier ist etwas von ${a}.`,
  weatherCold: () => "Heute ist es kalt. Zieh deinen warmen Mantel an.",
  weatherRain: () => "Heute regnet es vielleicht. Nimm deinen Schirm mit.",
  proMedAsk: (n) => `Hast du ${n} schon genommen?`,
  proPrepAsk: () => "Soll ich dir sagen, was du mitnimmst?",
  proAreYouHome: (n) => `Bist du wieder zu Hause, ${n}?`,
  proBedtime: (t) => `Es ist ${t}. Bald ist Schlafenszeit.`,
  proDoorAsk: () => "Ist die Haustür abgeschlossen?",
  proMusicAsk: (a) => `Soll ich etwas von ${a} spielen?`,
  proHello: (n) => `Hallo, ${n}.`,
  proChatAsk: () => "Wollen wir ein bisschen plaudern?",
```

`packages/shared/src/index.ts` — add `export * from "./i18n/distress";`.

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS (existing tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): distress keyword guard, Plan 2 templates, profile location/music/check-in"
```

---

### Task 2: Shared — proactive prompts

**Files:**
- Create: `packages/shared/src/domain/proactive.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/proactive.test.ts`

**Interfaces:**
- Consumes: `doseStatuses`, `appointmentsOn`, `localParts`, `toMinutes`, `timeWords`, `templates`, `CareEvent`, `Profile` (Task 1 fields).
- Produces: `type ProactiveKind = "medication" | "leave" | "welcome_back" | "bedtime" | "music" | "check_in"`; `interface ProactivePrompt { id: string; kind: ProactiveKind; say: string[] }`; `proactivePrompt(p: Profile, events: CareEvent[], now: Date): ProactivePrompt | null`; constants `PROMPT_WINDOW_MINUTES = 30`, `LEAVE_LEAD_MINUTES = 15`, `MUSIC_TIME = "16:30"`, `NIGHT_END_MINUTES = 300`.

Rules (first match wins, a prompt id is spoken at most once — the server logs `proactive_spoken` with `detail.promptId`):
1. **medication** — a dose in state `due` with `time ≤ now < time + 30 min` → id `med:<medicationId>:<time>:<date>`, say `[medDue(name), proMedAsk(name)]`.
2. **leave** — today's appointment with `travelMode "alone"` and `leaveBy`, `leaveBy − 15 ≤ now < leaveBy + 15`, no `left_home` for it today → id `leave:<appointmentId>:<date>`, say `[leaveFor(name, leaveBy words), proPrepAsk()]`.
3. **welcome_back** — today's appointment with `expectedReturn`, a `left_home` for it today (at ≤ now) and no `arrived_home` after that, `expectedReturn + graceMinutes ≤ now < that + 30` → id `back:<appointmentId>:<date>`, say `[proAreYouHome(preferredName)]`.
4. **bedtime** — routine item with `kind "bedtime"`, `time ≤ now < time + 30` → id `bed:<date>`, say `[proBedtime(time words), proDoorAsk()]`.
5. **music** — `favouriteMusic` set, `16:30 ≤ now < 17:00` → id `music:<date>`, say `[proMusicAsk(artist)]`.
6. **check_in** — `checkInTime` set, `time ≤ now < time + 30` → id `checkin:<date>`, say `[proHello(preferredName), proChatAsk()]`.
- Nothing between 00:00 and 05:00. Dates are local dates in the profile's timezone.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/proactive.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { proactivePrompt } from "../src/domain/proactive";
import type { CareEvent, EventType } from "../src/domain/types";
import { checkPlain } from "../src/i18n/plain";
import { rose, roseDe } from "../src/seed/rose";
import { at } from "../src/testing";

const ev = (type: EventType, iso: string, detail?: Record<string, string>): CareEvent =>
  ({ profileId: "rose", type, at: iso, ...(detail ? { detail } : {}) });
const spoken = (promptId: string, iso: string) => ev("proactive_spoken", iso, { promptId });
const left = (iso: string) => ev("left_home", iso, { appointmentId: "maple-grove" });

describe("proactivePrompt", () => {
  it("Mon 08:00: morning pills, ends with a yes/no question", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T08:00:00"))).toEqual({
      id: "med:morning-pills:08:00:2026-10-12", kind: "medication",
      say: ["Now it's time for your morning pills.", "Have you taken your morning pills yet?"],
    });
  });
  it("German", () => {
    expect(proactivePrompt(roseDe(), [], at("2026-10-12T08:00:00"))?.say).toEqual([
      "Jetzt ist Zeit für deine Morgentabletten.", "Hast du deine Morgentabletten schon genommen?",
    ]);
  });
  it("a prompt is spoken only once", () => {
    const events = [spoken("med:morning-pills:08:00:2026-10-12", "2026-10-12T12:00:00Z")];
    expect(proactivePrompt(rose(), events, at("2026-10-12T08:10:00"))).toBeNull();
  });
  it("no pill prompt when the dose is already taken", () => {
    const events = [ev("med_confirmed", "2026-10-12T12:01:00Z", { medicationId: "morning-pills", doseTime: "08:00" })];
    expect(proactivePrompt(rose(), events, at("2026-10-12T08:05:00"))).toBeNull();
  });
  it("no pill prompt before the dose time, even though the dose is already due", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T07:45:00"))).toBeNull();
  });
  it("Mon 09:30: time to leave for the group, offer to say what to take", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-12T09:30:00"))).toEqual({
      id: "leave:maple-grove:2026-10-12", kind: "leave",
      say: ["You leave for Maple Grove Day Club at twenty to ten.", "Shall I tell you what to take?"],
    });
  });
  it("no leave prompt once she has left", () => {
    expect(proactivePrompt(rose(), [left("2026-10-12T13:20:00Z")], at("2026-10-12T09:30:00"))).toBeNull();
  });
  it("Mon 15:00: not back after the group → are you back home?", () => {
    expect(proactivePrompt(rose(), [left("2026-10-12T13:38:00Z")], at("2026-10-12T15:00:00"))).toEqual({
      id: "back:maple-grove:2026-10-12", kind: "welcome_back", say: ["Are you back home, Rose?"],
    });
  });
  it("no welcome-back prompt when she is home", () => {
    const events = [left("2026-10-12T13:38:00Z"), ev("arrived_home", "2026-10-12T18:25:00Z")];
    expect(proactivePrompt(rose(), events, at("2026-10-12T15:00:00"))).toBeNull();
  });
  it("Wed 15:30: gentle check-in", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T15:30:00"))?.say).toEqual(["Hello, Rose.", "Shall we have a little chat?"]);
  });
  it("Wed 16:30: favourite music offer", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T16:30:00"))).toEqual({
      id: "music:2026-10-14", kind: "music", say: ["Shall I play some Frank Sinatra?"],
    });
  });
  it("Wed 20:00: evening pill only (overdue doses are not prompted)", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T20:00:00"))?.id).toBe("med:evening-pill:20:00:2026-10-14");
  });
  it("Wed 21:30: bedtime and the front door", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T21:30:00"))?.say).toEqual([
      "It's half past nine. Time to get ready for bed.", "Is the front door locked?",
    ]);
  });
  it("never at night", () => {
    expect(proactivePrompt(rose(), [], at("2026-10-14T03:00:00"))).toBeNull();
  });
  it("without music or check-in time in the profile, those prompts do not exist", () => {
    const p = { ...rose(), favouriteMusic: undefined, checkInTime: undefined };
    expect(proactivePrompt(p, [], at("2026-10-14T15:30:00"))).toBeNull();
    expect(proactivePrompt(p, [], at("2026-10-14T16:30:00"))).toBeNull();
  });
  it.each(["2026-10-12T08:00:00", "2026-10-12T09:30:00", "2026-10-14T15:30:00", "2026-10-14T16:30:00", "2026-10-14T21:30:00"])(
    "every prompt at %s is plain language in en and de", (time) => {
      for (const p of [rose(), roseDe()]) {
        const prompt = proactivePrompt(p, [], at(time));
        expect(prompt).not.toBeNull();
        expect(checkPlain(prompt!.say.join(" "), p.locale), prompt!.say.join(" ")).toMatchObject({ ok: true });
        expect(prompt!.say.at(-1)!.endsWith("?")).toBe(true);
      }
    });
});
```
Note: the welcome-back yes/no test case "Are you back home, Rose?" is a single question — it also satisfies the last check.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/test/proactive.test.ts`
Expected: FAIL — module `../src/domain/proactive` not found.

- [ ] **Step 3: Implement**

`packages/shared/src/domain/proactive.ts`:
```ts
import { templates } from "../i18n/templates";
import { timeWords } from "../i18n/words";
import { localParts, toMinutes } from "./clock";
import { doseStatuses } from "./medication";
import { appointmentsOn } from "./today";
import type { CareEvent, HHMM, Profile } from "./types";

export type ProactiveKind = "medication" | "leave" | "welcome_back" | "bedtime" | "music" | "check_in";

export interface ProactivePrompt { id: string; kind: ProactiveKind; say: string[] }

export const PROMPT_WINDOW_MINUTES = 30;
export const LEAVE_LEAD_MINUTES = 15;
export const MUSIC_TIME: HHMM = "16:30";
export const NIGHT_END_MINUTES = 300;

/**
 * The one thing Mia should say first right now, if any (spec §6.1). Every prompt ends with a yes/no question.
 * The caller logs `proactive_spoken` with the prompt id, so each prompt is spoken at most once.
 */
export function proactivePrompt(p: Profile, events: CareEvent[], now: Date): ProactivePrompt | null {
  const l = localParts(now, p.timezone);
  if (l.minutes < NIGHT_END_MINUTES) return null;
  const T = templates(p.locale);
  const today = (e: CareEvent) => localParts(new Date(e.at), p.timezone).date === l.date && new Date(e.at) <= now;
  const spoken = new Set(events.filter((e) => e.type === "proactive_spoken").map((e) => e.detail?.promptId));
  const within = (start: number, length = PROMPT_WINDOW_MINUTES) => l.minutes >= start && l.minutes < start + length;
  const candidates: ProactivePrompt[] = [];

  for (const d of doseStatuses(p, events, now)) {
    if (d.state === "due" && within(toMinutes(d.time))) {
      candidates.push({ id: `med:${d.medicationId}:${d.time}:${l.date}`, kind: "medication", say: [T.medDue(d.name), T.proMedAsk(d.name)] });
    }
  }

  const appts = appointmentsOn(p, l.date, l.weekday);
  for (const a of appts) {
    const leftFor = events.filter((e) => e.type === "left_home" && e.detail?.appointmentId === a.id && today(e));
    if (a.travelMode === "alone" && a.leaveBy && !leftFor.length &&
        within(toMinutes(a.leaveBy) - LEAVE_LEAD_MINUTES, 2 * LEAVE_LEAD_MINUTES)) {
      candidates.push({ id: `leave:${a.id}:${l.date}`, kind: "leave", say: [T.leaveFor(a.name, timeWords(a.leaveBy, p.locale)), T.proPrepAsk()] });
    }
  }
  for (const a of appts) {
    const lastLeft = events.filter((e) => e.type === "left_home" && e.detail?.appointmentId === a.id && today(e)).at(-1);
    const backAfter = lastLeft && events.some((e) => e.type === "arrived_home" && today(e) && new Date(e.at) > new Date(lastLeft.at));
    if (a.expectedReturn && lastLeft && !backAfter && within(toMinutes(a.expectedReturn) + a.graceMinutes)) {
      candidates.push({ id: `back:${a.id}:${l.date}`, kind: "welcome_back", say: [T.proAreYouHome(p.preferredName)] });
    }
  }

  const bedtime = p.routine.find((r) => r.kind === "bedtime");
  if (bedtime && within(toMinutes(bedtime.time))) {
    candidates.push({ id: `bed:${l.date}`, kind: "bedtime", say: [T.proBedtime(timeWords(bedtime.time, p.locale)), T.proDoorAsk()] });
  }
  if (p.favouriteMusic && within(toMinutes(MUSIC_TIME))) {
    candidates.push({ id: `music:${l.date}`, kind: "music", say: [T.proMusicAsk(p.favouriteMusic)] });
  }
  if (p.checkInTime && within(toMinutes(p.checkInTime))) {
    candidates.push({ id: `checkin:${l.date}`, kind: "check_in", say: [T.proHello(p.preferredName), T.proChatAsk()] });
  }

  return candidates.find((c) => !spoken.has(c.id)) ?? null;
}
```
(If `events` from the store are not sorted by time, sort a copy by `at` before using `.at(-1)`; the store returns them ordered by time.)

`packages/shared/src/index.ts` — add `export * from "./domain/proactive";`.

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): proactive prompts — pills, leaving, welcome back, bedtime, music, check-in"
```

---

### Task 3: MCP server — local startup module, test helper, `GET /proactive`, `play_music`

**Files:**
- Create: `packages/mcp-server/src/local.ts`, `packages/mcp-server/src/testing.ts`, `packages/mcp-server/src/proactive.ts`, `packages/mcp-server/src/tools/music.ts`
- Modify: `packages/mcp-server/src/main.ts`, `packages/mcp-server/src/http.ts`, `packages/mcp-server/src/server.ts`, `packages/mcp-server/package.json`, `packages/mcp-server/test/http.test.ts`, `packages/mcp-server/test/plain-sweep.test.ts`
- Test: `packages/mcp-server/test/local.test.ts`, `packages/mcp-server/test/proactive.test.ts`, `packages/mcp-server/test/music.test.ts`

**Interfaces:**
- Consumes: `proactivePrompt`, `ProactivePrompt`, `SEED_PROFILES`, `isSeedId`, `SeedId`, templates `musicStart`, `dontKnow` (Tasks 1–2); `createHttpApp`, `SqliteStore`, `LocalAesCipher`, `loadOrCreateLocalKey`, `StoreAlertSink`, `run`, `logEvent`, `OUTPUT_SHAPE` (Plan 1).
- Produces:
  - `checkDevToken(token: string | undefined): string` (throws on missing / < 24 chars / placeholder)
  - `startLocalMia(o: { token: string; profileId: SeedId; dataDir: string; port: number }): Promise<{ url: string; close(): Promise<void> }>` (Task 4 adds an optional `weather` option)
  - `inMemoryMia(o: { now: () => Date; profile?: Profile }): Promise<{ app: Hono; store: SqliteStore; token: string; url: string; fetch: typeof fetch }>`
  - `nextProactive(ctx: ToolContext): Promise<ProactivePrompt | null>`
  - HTTP `GET /proactive` (bearer) → `{ prompt: ProactivePrompt | null }`
  - tool `play_music` → facts `{ action: "play_music", artist }` or `{ action: null }`
  - package exports `@mia/mcp-server/local`, `@mia/mcp-server/testing`

- [ ] **Step 1: Write the failing tests**

`packages/mcp-server/test/local.test.ts`:
```ts
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDevToken, startLocalMia } from "../src/local";

describe("checkDevToken", () => {
  it.each([undefined, "", "short", "replace-with-a-long-random-string-of-24-plus-chars"])("rejects %j", (t) =>
    expect(() => checkDevToken(t)).toThrow(/MIA_DEV_TOKEN/));
  it("accepts a long random token", () => expect(checkDevToken("a".repeat(32))).toBe("a".repeat(32)));
});

describe("startLocalMia", () => {
  it("serves health on 127.0.0.1, seeds the profile, locks the data dir", async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), "mia-")), "data");
    const mia = await startLocalMia({ token: "t".repeat(32), profileId: "rose-de", dataDir, port: 0 });
    try {
      expect(mia.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${mia.url}/health`)).json()).toEqual({ ok: true });
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "mia.db")).mode & 0o777).toBe(0o600);
    } finally {
      await mia.close();
    }
  });
});
```

`packages/mcp-server/test/proactive.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { at } from "@mia/shared/testing";
import { inMemoryMia } from "../src/testing";

const get = (m: Awaited<ReturnType<typeof inMemoryMia>>, auth = `Bearer ${m.token}`) =>
  m.app.request("/proactive", { headers: { authorization: auth } });

describe("GET /proactive", () => {
  it("needs the bearer token", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    expect((await get(m, "Bearer wrong")).status).toBe(401);
  });
  it("returns the due prompt once, logs it, and makes it the last answer for repeat_last", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    const first = (await (await get(m)).json()) as { prompt: { id: string; say: string[] } | null };
    expect(first.prompt).toMatchObject({ id: "med:morning-pills:08:00:2026-10-12", kind: "medication" });
    expect((await (await get(m)).json())).toEqual({ prompt: null });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "proactive_spoken", detail: { promptId: "med:morning-pills:08:00:2026-10-12" } });
    expect(await m.store.getLastSay("rose")).toEqual(first.prompt!.say);
  });
  it("nothing to say at night", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-13T03:00:00") });
    expect(await (await get(m)).json()).toEqual({ prompt: null });
  });
});
```

`packages/mcp-server/test/music.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rose, roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

describe("play_music", () => {
  it("plays her favourite music and logs it", async () => {
    const m = await connect(at("2026-10-14T16:31:00"));
    const r = await m.call("play_music");
    expect(r.say).toEqual(["Here is some Frank Sinatra."]);
    expect(r.facts).toEqual({ action: "play_music", artist: "Frank Sinatra" });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "music_played", detail: { artist: "Frank Sinatra" } });
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-14T16:31:00"), roseDe())).call("play_music");
    expect(r.say).toEqual(["Hier ist etwas von Frank Sinatra."]);
  });
  it("no favourite music: does not guess, asks the carer", async () => {
    const m = await connect(at("2026-10-14T16:31:00"), { ...rose(), favouriteMusic: undefined });
    const r = await m.call("play_music");
    expect(r.say).toEqual(["I don't know that. I'll ask Tom."]);
    expect(r.facts).toEqual({ action: null });
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "unknown_question", detail: { topic: "music" } });
  });
});
```

In `packages/mcp-server/test/http.test.ts`, change the "serves all 14 tools" test title to "serves all 15 tools …" and insert `"play_music"` into the expected sorted list (between `"night_reassurance"` and `"repeat_last"`).

In `packages/mcp-server/test/plain-sweep.test.ts`, add `["2026-10-14T16:31:00", "play_music"],` to `SCRIPT` directly after the `["2026-10-14T15:20:00", "report_problem", …]` line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/mcp-server/test`
Expected: FAIL — `../src/local`, `../src/testing` not found; tool `play_music` not found; tool list has 14 entries.

- [ ] **Step 3: Implement**

`packages/mcp-server/src/local.ts`:
```ts
import { chmodSync, mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { SEED_PROFILES, type SeedId } from "@mia/shared";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher, loadOrCreateLocalKey } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

export const MIN_TOKEN_LENGTH = 24;

/** Local mode only: the dev bearer token must be long and not the example placeholder. */
export function checkDevToken(token: string | undefined): string {
  if (!token || token.length < MIN_TOKEN_LENGTH || token.startsWith("replace-with")) {
    throw new Error("Set your own MIA_DEV_TOKEN (≥ 24 random chars) in .env — see .env.example");
  }
  return token;
}

export interface LocalMiaOptions { token: string; profileId: SeedId; dataDir: string; port: number }

/** Starts the Mia MCP server in local mode (SQLite + local AES key) on 127.0.0.1. Port 0 picks a free port. */
export async function startLocalMia(o: LocalMiaOptions): Promise<{ url: string; close(): Promise<void> }> {
  mkdirSync(o.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(o.dataDir, 0o700);
  const store = new SqliteStore(join(o.dataDir, "mia.db"), new LocalAesCipher(loadOrCreateLocalKey(join(o.dataDir, "local.key"))));
  if (!(await store.getProfile(o.profileId))) await store.putProfile(SEED_PROFILES[o.profileId]());
  const app = createHttpApp({
    tokens: new Map([[o.token, o.profileId]]),
    makeContext: (id) => ({ store, profileId: id, now: () => new Date(), alerts: new StoreAlertSink(store) }),
  });
  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve) => {
    const s = serve({ fetch: app.fetch, port: o.port, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve({ server: s, port: info.port }));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

`packages/mcp-server/src/main.ts` (replace the whole file):
```ts
import { join, resolve } from "node:path";
import { isSeedId, SEED_PROFILES } from "@mia/shared";
import { checkDevToken, startLocalMia } from "./local";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!isSeedId(profileId)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
const port = Number(process.env.PORT ?? 8787);

const mia = await startLocalMia({ token, profileId, dataDir, port });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: ${mia.url}/mcp (profile: ${profileId})`);
```

`packages/mcp-server/src/testing.ts`:
```ts
import { randomBytes } from "node:crypto";
import { rose, type Profile } from "@mia/shared";
import type { Hono } from "hono";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

/** An in-memory Mia server for tests in any package: real tools, real encryption, no network. */
export async function inMemoryMia(o: { now: () => Date; profile?: Profile }) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  const profile = o.profile ?? rose();
  await store.putProfile(profile);
  const token = "test-token-0123456789abcdef";
  const app: Hono = createHttpApp({
    tokens: new Map([[token, profile.id]]),
    makeContext: (id) => ({ store, profileId: id, now: o.now, alerts: new StoreAlertSink(store) }),
  });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) =>
    app.request(url instanceof Request ? url : url.toString(), init)) as typeof fetch;
  return { app, store, token, url: "http://mia.test", fetch: fetchFn };
}
```

`packages/mcp-server/src/proactive.ts`:
```ts
import { proactivePrompt, type ProactivePrompt } from "@mia/shared";
import { logEvent, type ToolContext } from "./tools/runtime";

const LOOKBACK_MS = 36 * 3600 * 1000;

/** Care Mode demo: the add-on tells the voice device what to say first. Logged so each prompt is spoken once. */
export async function nextProactive(ctx: ToolContext): Promise<ProactivePrompt | null> {
  const p = await ctx.store.getProfile(ctx.profileId);
  if (!p) return null;
  const now = ctx.now();
  const events = await ctx.store.eventsSince(ctx.profileId, new Date(now.getTime() - LOOKBACK_MS).toISOString());
  const prompt = proactivePrompt(p, events, now);
  if (!prompt) return null;
  await logEvent(ctx, "proactive_spoken", { promptId: prompt.id });
  await ctx.store.setLastSay(ctx.profileId, prompt.say);
  return prompt;
}
```

`packages/mcp-server/src/http.ts` — refactor the 401 into a helper and add the route (keep everything else):
```ts
import { nextProactive } from "./proactive";
```
```ts
  const unauthorized = (c: Context) => c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="mia"' });
```
(import `type Context` from `"hono"`), use `unauthorized(c)` in `/mcp`, and add:
```ts
  app.get("/proactive", async (c) => {
    const profileId = profileFor(deps.tokens, c.req.header("authorization"));
    if (!profileId) return unauthorized(c);
    try {
      return c.json({ prompt: await nextProactive(deps.makeContext(profileId)) });
    } catch (err) {
      console.error("[mia] proactive failed:", err);
      return c.json({ prompt: null }, 500);
    }
  });
```

`packages/mcp-server/src/tools/music.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerMusicTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("play_music", {
    title: "Play her favourite music",
    description:
      "Use when she says yes to music, or asks for music, a song or her favourite singer. The voice device then plays it. " +
      "Examples: 'Yes, play some music.', 'Can I hear Frank Sinatra?', 'Spiel mir Musik vor.', 'Ja, gerne Musik.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    if (!p.favouriteMusic) {
      await logEvent(ctx, "unknown_question", { topic: "music" });
      return { facts: { action: null }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "music_played", { artist: p.favouriteMusic });
    return { facts: { action: "play_music", artist: p.favouriteMusic }, say: [T.musicStart(p.favouriteMusic)], verbatim: true };
  }));
}
```

`packages/mcp-server/src/server.ts` — import `registerMusicTools` from `"./tools/music"` and call `registerMusicTools(server, ctx);` after `registerRepeatTools`. Extend `SERVER_INSTRUCTIONS`' topic list: replace `the night, or help.` with `the night, music, or help.`

`packages/mcp-server/package.json` — add:
```json
  "exports": {
    "./local": "./src/local.ts",
    "./testing": "./src/testing.ts"
  },
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS. Then a manual check: `MIA_DEV_TOKEN=$(openssl rand -hex 16) MIA_DATA_DIR=$(mktemp -d) pnpm dev:mcp` prints the LOCAL MODE banner; stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): proactive endpoint, play_music tool, reusable local startup and test server"
```

---

### Task 4: MCP server — weather on the way out

**Files:**
- Create: `packages/mcp-server/src/weather.ts`
- Modify: `packages/mcp-server/src/tools/runtime.ts`, `packages/mcp-server/src/tools/orientation.ts`, `packages/mcp-server/src/local.ts`, `packages/mcp-server/src/testing.ts`, `packages/mcp-server/package.json`, `packages/mcp-server/test/helpers.ts`
- Test: `packages/mcp-server/test/weather.test.ts`

**Interfaces:**
- Consumes: `templates().weatherCold/weatherRain` (Task 1), `Profile.location` (Task 1), `nextAppointment(...).date` (Plan 1).
- Produces: `interface WeatherToday { maxTempC: number; rainChance: number }`; `interface WeatherProvider { today(latitude: number, longitude: number, date: string): Promise<WeatherToday | null> }`; `class OpenMeteoWeather implements WeatherProvider` (ctor `(fetchFn = fetch, timeoutMs = 250)`); `weatherLine(w: WeatherToday | null, locale: Locale): string | null`; `ToolContext.weather?: WeatherProvider`; `LocalMiaOptions.weather?`, `inMemoryMia({ weather? })`; `connect(now, profile?, extra?: Partial<ToolContext>)`; package export `@mia/mcp-server/weather`.

- [ ] **Step 1: Write the failing test**

`packages/mcp-server/test/weather.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { OpenMeteoWeather, weatherLine, type WeatherProvider } from "../src/weather";
import { connect } from "./helpers";

const okResponse = (max: number, rain: number | null) =>
  new Response(JSON.stringify({ daily: { temperature_2m_max: [max], precipitation_probability_max: [rain] } }), { status: 200 });

describe("OpenMeteoWeather", () => {
  it("asks Open-Meteo for one day and caches the answer", async () => {
    const urls: string[] = [];
    const w = new OpenMeteoWeather((async (url: string | URL | Request) => { urls.push(String(url)); return okResponse(6.5, 20); }) as typeof fetch);
    expect(await w.today(39.9612, -82.9988, "2026-10-12")).toEqual({ maxTempC: 6.5, rainChance: 20 });
    expect(await w.today(39.9612, -82.9988, "2026-10-12")).toEqual({ maxTempC: 6.5, rainChance: 20 });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://api.open-meteo.com/v1/forecast?latitude=39.9612&longitude=-82.9988");
    expect(urls[0]).toContain("daily=temperature_2m_max,precipitation_probability_max");
    expect(urls[0]).toContain("start_date=2026-10-12&end_date=2026-10-12");
  });
  it("missing rain chance counts as 0", async () => {
    const w = new OpenMeteoWeather((async () => okResponse(15, null)) as typeof fetch);
    expect(await w.today(1, 2, "2026-10-12")).toEqual({ maxTempC: 15, rainChance: 0 });
  });
  it("network error, HTTP error or odd JSON → null, and nothing is cached", async () => {
    let calls = 0;
    const failing = new OpenMeteoWeather((async () => { calls++; throw new Error("offline"); }) as typeof fetch);
    expect(await failing.today(1, 2, "2026-10-12")).toBeNull();
    expect(await failing.today(1, 2, "2026-10-12")).toBeNull();
    expect(calls).toBe(2);
    expect(await new OpenMeteoWeather((async () => new Response("", { status: 503 })) as typeof fetch).today(1, 2, "d")).toBeNull();
    expect(await new OpenMeteoWeather((async () => new Response("{}", { status: 200 })) as typeof fetch).today(1, 2, "d")).toBeNull();
  });
  it("gives up after the timeout", async () => {
    const slow = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    expect(await new OpenMeteoWeather(slow, 20).today(1, 2, "2026-10-12")).toBeNull();
  });
});

describe("weatherLine", () => {
  it("cold wins over rain; mild and dry says nothing", () => {
    expect(weatherLine({ maxTempC: 5, rainChance: 80 }, "en-US")).toBe("It's cold today. Wear your warm coat.");
    expect(weatherLine({ maxTempC: 15, rainChance: 70 }, "en-US")).toBe("It may rain today. Take your umbrella.");
    expect(weatherLine({ maxTempC: 15, rainChance: 10 }, "en-US")).toBeNull();
    expect(weatherLine({ maxTempC: 5, rainChance: 0 }, "de-DE")).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
    expect(weatherLine(null, "en-US")).toBeNull();
  });
});

describe("get_preparation_steps with weather", () => {
  const cold: WeatherProvider = { today: async () => ({ maxTempC: 4, rainChance: 0 }) };
  it("first step starts with the weather sentence", async () => {
    const m = await connect(at("2026-10-12T09:00:00"), undefined, { weather: cold });
    const r = await m.call("get_preparation_steps");
    expect(r.say).toEqual(["It's cold today. Wear your warm coat.", "Take your keys on the red lanyard and your handbag."]);
    expect(r.facts).toMatchObject({ weather: "It's cold today. Wear your warm coat." });
    expect((await m.call("get_preparation_steps", { step: 1 })).say).toEqual(["Take your glasses and your coat."]);
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T09:00:00"), roseDe(), { weather: cold })).call("get_preparation_steps");
    expect(r.say[0]).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
  });
  it("no weather available: unchanged", async () => {
    const none: WeatherProvider = { today: async () => null };
    const r = await (await connect(at("2026-10-12T09:00:00"), undefined, { weather: none })).call("get_preparation_steps");
    expect(r.say).toEqual(["Take your keys on the red lanyard and your handbag."]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/mcp-server/test/weather.test.ts`
Expected: FAIL — module `../src/weather` not found.

- [ ] **Step 3: Implement**

`packages/mcp-server/src/weather.ts`:
```ts
import { templates, type Locale } from "@mia/shared";

export interface WeatherToday { maxTempC: number; rainChance: number }
export interface WeatherProvider { today(latitude: number, longitude: number, date: string): Promise<WeatherToday | null> }

export const COLD_BELOW_C = 10;
export const RAIN_FROM_PERCENT = 50;
/** Keeps the tool under the Alexa+ 500 ms limit. */
export const WEATHER_TIMEOUT_MS = 250;

interface OpenMeteoDaily { daily?: { temperature_2m_max?: number[]; precipitation_probability_max?: (number | null)[] } }

/** Free forecast API, no key. Successful answers are cached per place and day; failures are not cached. */
export class OpenMeteoWeather implements WeatherProvider {
  private readonly cache = new Map<string, WeatherToday>();

  constructor(private readonly fetchFn: typeof fetch = fetch, private readonly timeoutMs = WEATHER_TIMEOUT_MS) {}

  async today(latitude: number, longitude: number, date: string): Promise<WeatherToday | null> {
    const key = `${latitude},${longitude},${date}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&start_date=${date}&end_date=${date}`;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      const body = (await res.json()) as OpenMeteoDaily;
      const maxTempC = body.daily?.temperature_2m_max?.[0];
      if (typeof maxTempC !== "number") return null;
      const w: WeatherToday = { maxTempC, rainChance: body.daily?.precipitation_probability_max?.[0] ?? 0 };
      this.cache.set(key, w);
      return w;
    } catch {
      return null;
    }
  }
}

/** One plain sentence pair for the way out, or nothing. Cold is more important than rain. */
export function weatherLine(w: WeatherToday | null, locale: Locale): string | null {
  if (!w) return null;
  const T = templates(locale);
  if (w.maxTempC < COLD_BELOW_C) return T.weatherCold();
  if (w.rainChance >= RAIN_FROM_PERCENT) return T.weatherRain();
  return null;
}
```

`packages/mcp-server/src/tools/runtime.ts` — `import type { WeatherProvider } from "../weather";` and add to `ToolContext`:
```ts
  /** optional: adds a weather sentence to the first preparation step */
  weather?: WeatherProvider;
```

`packages/mcp-server/src/tools/orientation.ts` — import `weatherLine` from `"../weather"`; in `get_preparation_steps` replace the final `return` with:
```ts
    const weather = s === 0 && p.location && ctx.weather
      ? weatherLine(await ctx.weather.today(p.location.latitude, p.location.longitude, n.date), p.locale)
      : null;
    return {
      facts: { appointment: n.appointment.name, items, nextStep: s + 1, hasMore, weather },
      say: weather ? [weather, T.take(items)] : [T.take(items)],
      verbatim: true,
    };
```

`packages/mcp-server/test/helpers.ts` — change the signature to `connect(now: Date, profile: Profile = rose(), extra: Partial<ToolContext> = {})`, import `type ToolContext` from `"../src/tools/runtime"`, and create the server with `createMiaServer({ store, profileId: profile.id, now: () => clock, alerts: new StoreAlertSink(store), ...extra })`.

`packages/mcp-server/src/local.ts` — `import type { WeatherProvider } from "./weather";`, add `weather?: WeatherProvider` to `LocalMiaOptions`, and pass `weather: o.weather` in `makeContext`.

`packages/mcp-server/src/testing.ts` — accept `weather?: WeatherProvider` in the options and pass `weather: o.weather` in `makeContext`.

`packages/mcp-server/src/main.ts` — `import { OpenMeteoWeather } from "./weather";` and pass `weather: new OpenMeteoWeather()` to `startLocalMia`.

`packages/mcp-server/package.json` — add `"./weather": "./src/weather.ts"` to `exports`.

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS (no test touches the real network).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): weather sentence on the way out (Open-Meteo, 250 ms timeout, cached)"
```

---

### Task 5: Voice — package, MCP client, LLM interface, Anthropic adapter, verbatim check

**Files:**
- Create: `packages/voice/package.json`, `packages/voice/tsconfig.json`, `packages/voice/src/mcp.ts`, `packages/voice/src/llm.ts`, `packages/voice/src/anthropic.ts`, `packages/voice/src/verbatim.ts`
- Test: `packages/voice/test/mcp.test.ts`, `packages/voice/test/anthropic.test.ts`, `packages/voice/test/verbatim.test.ts`

**Interfaces:**
- Consumes: `inMemoryMia` (Task 3), `ProactivePrompt`, `splitSentences`, `Locale` from `@mia/shared`.
- Produces:
  - `interface ToolReply { say: string[]; facts: Record<string, unknown>; verbatim: boolean; guidance: string; text: string }`
  - `interface ToolInfo { name: string; description: string; inputSchema: Record<string, unknown> }`
  - `interface MiaClient { tools(): Promise<ToolInfo[]>; call(name: string, args?: Record<string, unknown>): Promise<ToolReply>; proactive(): Promise<ProactivePrompt | null> }`
  - `connectMia(c: { url: string; token: string; fetch?: typeof fetch }): Promise<MiaClient>`
  - `interface ToolCall { id: string; name: string; input: Record<string, unknown> }`
  - `type ChatMessage = { role: "user"; text: string } | { role: "assistant"; text: string; calls?: ToolCall[] } | { role: "tool_results"; results: { id: string; content: string }[] }`
  - `type LlmStep = { kind: "tools"; text: string; calls: ToolCall[] } | { kind: "text"; text: string }`
  - `interface LlmRequest { system: string; messages: ChatMessage[]; tools: ToolInfo[] }`, `interface Llm { next(req: LlmRequest): Promise<LlmStep> }`
  - `DEFAULT_MODEL = "claude-sonnet-5-5"`, `toAnthropic(messages)`, `fromAnthropic(message)`, `class AnthropicLlm implements Llm` (ctor `(client: Anthropic, model = DEFAULT_MODEL)`)
  - `MAX_LEAD_IN_WORDS = 5`, `enforceVerbatim(llmText: string, says: string[], locale: Locale): string[]`

- [ ] **Step 1: Scaffold the package**

`packages/voice/package.json`:
```json
{
  "name": "@mia/voice",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.132.1",
    "@hono/node-server": "2.1.3",
    "@mia/mcp-server": "workspace:*",
    "@mia/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "1.32.1",
    "hono": "4.13.13"
  }
}
```
`packages/voice/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```
Run: `pnpm install`
Expected: installs `@anthropic-ai/sdk@0.132.1`, links workspace packages.

- [ ] **Step 2: Write the failing tests**

`packages/voice/test/mcp.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { at } from "@mia/shared/testing";
import { connectMia } from "../src/mcp";

describe("connectMia", () => {
  it("lists Mia's tools, calls one, fetches the proactive prompt", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
    const tools = await mia.tools();
    expect(tools.map((t) => t.name)).toContain("get_today");
    expect(tools.map((t) => t.name)).toContain("play_music");
    expect(tools.find((t) => t.name === "who_is")!.inputSchema).toMatchObject({ type: "object" });
    const today = await mia.call("get_today");
    expect(today.say[0]).toBe("Today is Monday, October 12.");
    expect(today.verbatim).toBe(true);
    expect(today.text).toBe(today.say.join(" "));
    expect((await mia.proactive())?.kind).toBe("medication");
    expect(await mia.proactive()).toBeNull();
  });
  it("a wrong token fails loudly", async () => {
    const m = await inMemoryMia({ now: () => at("2026-10-12T08:05:00") });
    await expect(connectMia({ url: m.url, token: "wrong", fetch: m.fetch })).rejects.toThrow();
  });
});
```

`packages/voice/test/anthropic.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fromAnthropic, toAnthropic } from "../src/anthropic";

describe("Anthropic adapter", () => {
  it("maps our messages to the Messages API format", () => {
    expect(toAnthropic([
      { role: "user", text: "Did I take my pills?" },
      { role: "assistant", text: "", calls: [{ id: "t1", name: "get_medication_status", input: {} }] },
      { role: "tool_results", results: [{ id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", text: "Not yet." },
    ])).toEqual([
      { role: "user", content: "Did I take my pills?" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_medication_status", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", content: [{ type: "text", text: "Not yet." }] },
    ]);
  });
  it("reads tool calls and text from a response", () => {
    expect(fromAnthropic({ content: [
      { type: "text", text: "Let me check.", citations: null },
      { type: "tool_use", id: "t2", name: "get_today", input: {} },
    ] } as never)).toEqual({ kind: "tools", text: "Let me check.", calls: [{ id: "t2", name: "get_today", input: {} }] });
    expect(fromAnthropic({ content: [{ type: "text", text: " Hello, Rose. ", citations: null }] } as never))
      .toEqual({ kind: "text", text: "Hello, Rose." });
  });
});
```

`packages/voice/test/verbatim.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { enforceVerbatim } from "../src/verbatim";

const SAY = ["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."];

describe("enforceVerbatim", () => {
  it("keeps one short warm lead-in before the template sentences", () => {
    expect(enforceVerbatim(`Of course, Rose. ${SAY.join(" ")}`, SAY, "en-US")).toEqual(["Of course, Rose.", ...SAY]);
  });
  it("drops a paraphrase and speaks the templates instead", () => {
    expect(enforceVerbatim("You should take your morning pills now, dear.", SAY, "en-US")).toEqual(SAY);
  });
  it("drops a long lead-in", () => {
    expect(enforceVerbatim(`Let me have a careful look at that for you. ${SAY.join(" ")}`, SAY, "en-US")).toEqual(SAY);
  });
  it("a lead-in that is itself a template sentence is not doubled", () => {
    expect(enforceVerbatim(SAY.join(" "), SAY, "en-US")).toEqual(SAY);
  });
  it("splits template entries that hold two sentences", () => {
    expect(enforceVerbatim("", ["Yes. You took your morning pills at five past eight."], "en-US"))
      .toEqual(["Yes.", "You took your morning pills at five past eight."]);
  });
  it("no templates: the LLM text is spoken, sentence by sentence", () => {
    expect(enforceVerbatim("That sounds lovely. Tell me more?", [], "en-US")).toEqual(["That sounds lovely.", "Tell me more?"]);
  });
  it("German ordinal dates stay whole", () => {
    expect(enforceVerbatim("", ["Heute ist Montag, der 12. Oktober."], "de-DE")).toEqual(["Heute ist Montag, der 12. Oktober."]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/voice/test`
Expected: FAIL — modules `../src/mcp`, `../src/anthropic`, `../src/verbatim` not found.

- [ ] **Step 4: Implement**

`packages/voice/src/mcp.ts`:
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ProactivePrompt } from "@mia/shared";

export interface ToolReply { say: string[]; facts: Record<string, unknown>; verbatim: boolean; guidance: string; text: string }
export interface ToolInfo { name: string; description: string; inputSchema: Record<string, unknown> }
export interface MiaClient {
  tools(): Promise<ToolInfo[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolReply>;
  proactive(): Promise<ProactivePrompt | null>;
}
export interface MiaConnection { url: string; token: string; fetch?: typeof fetch }

/** The voice gateway's side of Mia: an MCP client, like Alexa+ would be, plus the Care Mode proactive endpoint. */
export async function connectMia(c: MiaConnection): Promise<MiaClient> {
  const fetchFn = c.fetch ?? fetch;
  const headers = { authorization: `Bearer ${c.token}` };
  const transport = new StreamableHTTPClientTransport(new URL(`${c.url}/mcp`), { fetch: fetchFn, requestInit: { headers } });
  const client = new Client({ name: "mia-voice", version: "0.1.0" });
  await client.connect(transport);
  let tools: ToolInfo[] | undefined;
  return {
    async tools() {
      tools ??= (await client.listTools()).tools.map((t) => ({
        name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      return tools;
    },
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const structured = r.structuredContent as Omit<ToolReply, "text">;
      const text = (r.content as { type: string; text?: string }[]).find((x) => x.type === "text")?.text ?? "";
      return { ...structured, text };
    },
    async proactive() {
      const res = await fetchFn(`${c.url}/proactive`, { headers });
      if (!res.ok) throw new Error(`proactive: HTTP ${res.status}`);
      return ((await res.json()) as { prompt: ProactivePrompt | null }).prompt;
    },
  };
}
```

`packages/voice/src/llm.ts`:
```ts
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
```

`packages/voice/src/anthropic.ts`:
```ts
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
```
(If an Anthropic type name differs in 0.132.1, use the SDK's equivalent exported type and note it in the report; keep the mapping and tests unchanged.)

`packages/voice/src/verbatim.ts`:
```ts
import { splitSentences, type Locale } from "@mia/shared";

export const MAX_LEAD_IN_WORDS = 5;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Spec §8 rule 6: critical sentences come from the tools' templates, word for word.
 * The LLM may add one warm lead-in of at most five words; anything else it wrote is dropped.
 */
export function enforceVerbatim(llmText: string, says: string[], locale: Locale): string[] {
  const llmSentences = splitSentences(llmText, locale);
  if (!says.length) return llmSentences;
  const templateSentences = says.flatMap((s) => splitSentences(s, locale));
  const first = llmSentences[0];
  const isTemplate = (s: string) => templateSentences.some((t) => norm(t) === norm(s));
  const words = first ? first.split(/\s+/).filter(Boolean).length : 0;
  const leadIn = first && !isTemplate(first) && words <= MAX_LEAD_IN_WORDS && !first.endsWith("?") ? [first] : [];
  return [...leadIn, ...templateSentences];
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/voice pnpm-lock.yaml
git commit -m "feat(voice): MCP client, LLM interface, Anthropic adapter, verbatim check"
```

---

### Task 6: Voice — the Brain (one turn, proactive, misses, distress, night)

**Files:**
- Create: `packages/voice/src/brain.ts`
- Test: `packages/voice/test/brain.test.ts`, `packages/voice/test/fakes.ts`

**Interfaces:**
- Consumes: `MiaClient`, `connectMia`, `Llm`, `LlmStep`, `LlmRequest`, `ChatMessage`, `enforceVerbatim` (Task 5); `detectDistress`, `templates`, `localParts`, `splitSentences`, `NIGHT_END_MINUTES`, `Profile` (Tasks 1–2).
- Produces:
  - `type VoiceProfile = Pick<Profile, "locale" | "timezone" | "speech" | "carerName" | "preferredName">`
  - `interface Reply { sentences: string[]; rate: number; breakMs: number; tools: string[]; action?: { type: "play_music"; artist: string } }`
  - `interface TurnInput { text: string; confidence?: number }`
  - `class Brain` — ctor `({ mia, llm, profile, now })`, `turn(input: TurnInput): Promise<Reply>`, `proactive(): Promise<Reply | null>`
  - constants `MAX_TOOL_ROUNDS = 4`, `HISTORY_MESSAGES = 12`, `UNUSABLE_CONFIDENCE = 0.3`, `REPEAT_SLOWER = 0.9`, `systemPrompt(p: VoiceProfile): string`, `SPEAKS_FIRST_MARKER`

Turn order: (1) empty text or confidence < 0.3 → a miss: first miss "I'm listening.", second miss → `get_today` + call offer (safe default, §9.6); (2) distress keywords → `report_problem` directly, no LLM; (3) 00:00–05:00 → `night_reassurance` directly; (4) LLM tool loop (≤ 4 rounds) → `enforceVerbatim`; LLM failure → `systemError`; empty answer → call offer. Rate = `speechRate / 100`, × 0.9 when `repeat_last` was used. Turns and proactive prompts never run at the same time (serialised).

- [ ] **Step 1: Write the failing tests**

`packages/voice/test/fakes.ts`:
```ts
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
```

`packages/voice/test/brain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { inMemoryMia } from "@mia/mcp-server/testing";
import { rose, roseDe, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { Brain, HISTORY_MESSAGES, SPEAKS_FIRST_MARKER } from "../src/brain";
import { connectMia } from "../src/mcp";
import { ScriptedLlm, text, tool } from "./fakes";

async function setup(time: string, steps: ConstructorParameters<typeof ScriptedLlm>[0], profile: Profile = rose()) {
  let now = at(time);
  const m = await inMemoryMia({ now: () => now, profile });
  const mia = await connectMia({ url: m.url, token: m.token, fetch: m.fetch });
  const llm = new ScriptedLlm(steps);
  const brain = new Brain({ mia, llm, profile, now: () => now });
  return { brain, llm, store: m.store, setNow: (t: string) => { now = at(t); } };
}

const PILLS = ["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."];

describe("Brain.turn", () => {
  it("LLM chooses the tool; the template sentences are spoken after a short lead-in", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), text(`Of course. ${PILLS.join(" ")}`)]);
    const r = await s.brain.turn({ text: "Did I take my pills?", confidence: 0.92 });
    expect(r).toEqual({ sentences: ["Of course.", ...PILLS], rate: 0.9, breakMs: 700, tools: ["get_medication_status"] });
    expect(s.llm.requests[0]!.tools.map((t) => t.name)).toContain("get_medication_status");
    expect(s.llm.requests[0]!.system).toContain("English");
  });
  it("a paraphrase by the LLM is replaced by the templates", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_medication_status"), text("You should take your pills now, dear.")]);
    expect((await s.brain.turn({ text: "pills?" })).sentences).toEqual(PILLS);
  });
  it("tool results go back to the LLM with say, facts and guidance", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), text("")]);
    await s.brain.turn({ text: "What day is it?" });
    const second = s.llm.requests[1]!;
    const results = second.messages.at(-1)!;
    expect(results.role).toBe("tool_results");
    const content = JSON.parse((results as { results: { content: string }[] }).results[0]!.content);
    expect(content.say[0]).toBe("Today is Monday, October 12.");
    expect(content.guidance).toContain("exactly as written");
  });
  it("distress keywords alert the carer at once, without the LLM", async () => {
    const s = await setup("2026-10-12T11:00:00", []);
    const r = await s.brain.turn({ text: "I fell in the kitchen", confidence: 0.5 });
    expect(r.sentences).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
    expect(r.tools).toEqual(["report_problem"]);
    expect(s.llm.requests).toHaveLength(0);
    expect(await s.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high", message: 'Rose asked for help: "I fell in the kitchen".' }]);
  });
  it("German distress word", async () => {
    const s = await setup("2026-10-12T11:00:00", [], roseDe());
    expect((await s.brain.turn({ text: "Hilfe!" })).sentences).toEqual(["Ich habe Tom sofort Bescheid gegeben.", "Tom meldet sich bei dir."]);
  });
  it("at night, speech goes to night reassurance first", async () => {
    const s = await setup("2026-10-13T03:10:00", []);
    const r = await s.brain.turn({ text: "Do I have to go to work?" });
    expect(r.tools).toEqual(["night_reassurance"]);
    expect(r.sentences.at(-1)).toBe("You can go back to sleep.");
    expect(s.llm.requests).toHaveLength(0);
  });
  it("'Pardon?' repeats word for word, 10 % slower", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), text(""), tool("repeat_last"), text("")]);
    const first = await s.brain.turn({ text: "What day is it?" });
    const again = await s.brain.turn({ text: "Pardon?" });
    expect(again.sentences).toEqual(first.sentences);
    expect(again.rate).toBeCloseTo(0.81);
  });
  it("first miss: gently listening; second miss: today and an offer to call", async () => {
    const s = await setup("2026-10-12T08:05:00", []);
    expect((await s.brain.turn({ text: "" })).sentences).toEqual(["I'm listening."]);
    const second = await s.brain.turn({ text: "mm", confidence: 0.1 });
    expect(second.tools).toEqual(["get_today"]);
    expect(second.sentences[0]).toBe("Today is Monday, October 12.");
    expect(second.sentences.at(-1)).toBe("Shall I ask Tom to call you?");
    expect(s.llm.requests).toHaveLength(0);
  });
  it("low confidence is passed on so the LLM can ask one yes/no check", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("Do you mean your pills?")]);
    const r = await s.brain.turn({ text: "pils", confidence: 0.45 });
    expect(r.sentences).toEqual(["Do you mean your pills?"]);
    const user = s.llm.requests[0]!.messages.at(-1)!;
    expect(user).toEqual({ role: "user", text: "(speech recognition unsure, confidence 0.45) pils" });
  });
  it("if the LLM fails, she hears a calm fallback, not silence", async () => {
    const s = await setup("2026-10-12T08:05:00", [new Error("network down")]);
    expect((await s.brain.turn({ text: "What day is it?" })).sentences).toEqual(["I can't check right now.", "Tom can help."]);
  });
  it("an empty LLM answer without tools becomes an offer to call", async () => {
    const s = await setup("2026-10-12T08:05:00", [text("")]);
    expect((await s.brain.turn({ text: "Hmm, well" })).sentences).toEqual(["Shall I ask Tom to call you?"]);
  });
  it("music: the reply carries a play action", async () => {
    const s = await setup("2026-10-14T16:31:00", [tool("play_music"), text("")]);
    const r = await s.brain.turn({ text: "Yes please" });
    expect(r.sentences).toEqual(["Here is some Frank Sinatra."]);
    expect(r.action).toEqual({ type: "play_music", artist: "Frank Sinatra" });
  });
  it("stops after four tool rounds", async () => {
    const s = await setup("2026-10-12T08:05:00", [tool("get_today"), tool("get_today"), tool("get_today"), tool("get_today")]);
    const r = await s.brain.turn({ text: "What day is it?" });
    expect(s.llm.requests).toHaveLength(4);
    expect(r.sentences).toEqual(["Today is Monday, October 12.", "You leave for Maple Grove Day Club at twenty to ten.", "Today is Monday."]);
  });
  it("keeps only the last messages of the conversation", async () => {
    const steps = Array.from({ length: 10 }, () => text("Lovely."));
    const s = await setup("2026-10-14T15:00:00", steps);
    for (let i = 0; i < 10; i++) await s.brain.turn({ text: `turn ${i}` });
    const last = s.llm.requests.at(-1)!.messages;
    expect(last.length).toBe(HISTORY_MESSAGES + 1);
    expect(last[0]!.role).toBe("user");
  });
});

describe("Brain.proactive", () => {
  it("Mia speaks first, and 'yes' is understood in that context", async () => {
    const s = await setup("2026-10-12T08:00:00", [tool("confirm_medication"), text("")]);
    const p = await s.brain.proactive();
    expect(p).toEqual({ sentences: ["Now it's time for your morning pills.", "Have you taken your morning pills yet?"], rate: 0.9, breakMs: 700, tools: [] });
    expect(await s.brain.proactive()).toBeNull();
    s.setNow("2026-10-12T08:02:00");
    const r = await s.brain.turn({ text: "yes" });
    expect(r.sentences).toEqual(["Thank you. I've noted your morning pills."]);
    const msgs = s.llm.requests[0]!.messages;
    expect(msgs[0]).toEqual({ role: "user", text: SPEAKS_FIRST_MARKER });
    expect(msgs[1]).toEqual({ role: "assistant", text: "Now it's time for your morning pills. Have you taken your morning pills yet?" });
    expect(msgs[2]).toEqual({ role: "user", text: "yes" });
  });
  it("nothing to say → null", async () => {
    const s = await setup("2026-10-14T11:00:00", []);
    expect(await s.brain.proactive()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/voice/test/brain.test.ts`
Expected: FAIL — module `../src/brain` not found.

- [ ] **Step 3: Implement**

`packages/voice/src/brain.ts`:
```ts
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
    return this.serial(() => this.handleTurn(input));
  }

  proactive(): Promise<Reply | null> {
    return this.serial(async () => {
      const prompt = await this.deps.mia.proactive();
      if (!prompt) return null;
      this.remember(SPEAKS_FIRST_MARKER, prompt.say);
      return this.reply(prompt.say, []);
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

    try {
      return await this.llmTurn(text, input.confidence);
    } catch (err) {
      console.error("[mia-voice] turn failed:", err);
      return this.reply(splitSentences(T.systemError(p.carerName), p.locale), []);
    }
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
```
Note: `repeat_last` returns `verbatim: true` with the previous sentences, so `enforceVerbatim` speaks them word for word.

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/voice
git commit -m "feat(voice): brain — tool loop, verbatim, distress guard, night mode, misses, proactive"
```

---

### Task 7: Voice — gateway HTTP app and local entry point

**Files:**
- Create: `packages/voice/src/server.ts`, `packages/voice/src/main.ts`, `packages/voice/public/index.html` (minimal placeholder, replaced in Task 8)
- Modify: `package.json` (root scripts), `.env.example`
- Test: `packages/voice/test/server.test.ts`

**Interfaces:**
- Consumes: `Brain`, `Reply`, `VoiceProfile` (Task 6); `connectMia` (Task 5); `startLocalMia`, `checkDevToken` (Task 3); `OpenMeteoWeather` (Task 4); `AnthropicLlm`, `DEFAULT_MODEL` (Task 5); `SEED_PROFILES`, `isSeedId`.
- Produces: `createVoiceApp(deps: { brain: Pick<Brain, "turn" | "proactive">; profile: VoiceProfile; publicDir: string }): Hono` with `GET /api/config` → `{ locale, endOfTurnTimeoutMs, rate, breakMs, mode: "local" }`, `POST /api/turn` → `Reply` (400 on bad input), `GET /api/proactive` → `{ reply: Reply | null }`, static `/`, `/app.js`, `/turn.js`, `/style.css`; `MAX_TURN_CHARS = 500`.

- [ ] **Step 1: Write the failing test**

`packages/voice/test/server.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import type { Reply } from "../src/brain";
import { createVoiceApp } from "../src/server";

const reply: Reply = { sentences: ["Hello, Rose."], rate: 0.9, breakMs: 700, tools: [] };

function app(proactive: Reply | null = null) {
  const publicDir = mkdtempSync(join(tmpdir(), "mia-public-"));
  writeFileSync(join(publicDir, "index.html"), "<!doctype html><p>LOCAL MODE — not production</p>");
  writeFileSync(join(publicDir, "app.js"), "export {};");
  writeFileSync(join(publicDir, "turn.js"), "export {};");
  writeFileSync(join(publicDir, "style.css"), "body{}");
  const turns: unknown[] = [];
  const brain = { turn: async (t: unknown) => { turns.push(t); return reply; }, proactive: async () => proactive };
  return { app: createVoiceApp({ brain, profile: rose(), publicDir }), turns };
}

const post = (a: ReturnType<typeof app>["app"], body: unknown) =>
  a.request("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("voice gateway", () => {
  it("config comes from the speech settings", async () => {
    expect(await (await app().app.request("/api/config")).json()).toEqual({
      locale: "en-US", endOfTurnTimeoutMs: 1800, rate: 0.9, breakMs: 700, mode: "local",
    });
  });
  it("a turn goes to the brain", async () => {
    const a = app();
    const r = await post(a.app, { text: "What day is it?", confidence: 0.9 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(reply);
    expect(a.turns).toEqual([{ text: "What day is it?", confidence: 0.9 }]);
  });
  it.each([{}, { text: 5 }, { text: "x".repeat(501) }, { text: "hi", confidence: 2 }, { text: "hi", confidence: "high" }])(
    "rejects %j", async (body) => expect((await post(app().app, body)).status).toBe(400));
  it("proactive", async () => {
    expect(await (await app(reply).app.request("/api/proactive")).json()).toEqual({ reply });
    expect(await (await app(null).app.request("/api/proactive")).json()).toEqual({ reply: null });
  });
  it("serves the page with a strict content security policy", async () => {
    const r = await app().app.request("/");
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await r.text()).toContain("LOCAL MODE");
    expect((await app().app.request("/app.js")).headers.get("content-type")).toContain("text/javascript");
    expect((await app().app.request("/../package.json")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/voice/test/server.test.ts`
Expected: FAIL — module `../src/server` not found.

- [ ] **Step 3: Implement**

`packages/voice/src/server.ts`:
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { Brain, TurnInput, VoiceProfile } from "./brain";

export const MAX_TURN_CHARS = 500;

const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/turn.js": { file: "turn.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'";

function parseTurn(body: unknown): TurnInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { text, confidence } = body as Record<string, unknown>;
  if (typeof text !== "string" || text.length > MAX_TURN_CHARS) return null;
  if (confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) return null;
  return confidence === undefined ? { text } : { text, confidence };
}

export function createVoiceApp(deps: { brain: Pick<Brain, "turn" | "proactive">; profile: VoiceProfile; publicDir: string }): Hono {
  const app = new Hono();
  const { speech, locale } = deps.profile;

  app.get("/api/config", (c) => c.json({
    locale, endOfTurnTimeoutMs: speech.endOfTurnTimeoutMs, rate: speech.speechRate / 100, breakMs: speech.sentenceBreakMs, mode: "local",
  }));

  app.post("/api/turn", async (c) => {
    const turn = parseTurn(await c.req.json().catch(() => null));
    if (!turn) return c.json({ error: "bad request" }, 400);
    return c.json(await deps.brain.turn(turn));
  });

  app.get("/api/proactive", async (c) => {
    try {
      return c.json({ reply: await deps.brain.proactive() });
    } catch (err) {
      console.error("[mia-voice] proactive failed:", err);
      return c.json({ reply: null });
    }
  });

  for (const [route, { file, type }] of Object.entries(FILES)) {
    app.get(route, async (c) => c.body(await readFile(join(deps.publicDir, file), "utf8"), 200, {
      "content-type": type, "content-security-policy": CSP, "cache-control": "no-store",
    }));
  }

  return app;
}
```

`packages/voice/src/main.ts`:
```ts
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { checkDevToken, startLocalMia } from "@mia/mcp-server/local";
import { OpenMeteoWeather } from "@mia/mcp-server/weather";
import { isSeedId, SEED_PROFILES } from "@mia/shared";
import { AnthropicLlm, DEFAULT_MODEL } from "./anthropic";
import { Brain } from "./brain";
import { connectMia } from "./mcp";
import { createVoiceApp } from "./server";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = checkDevToken(process.env.MIA_DEV_TOKEN);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY in the environment or .env (store it with your keys CLI; never commit it)");
const profileId = process.env.MIA_PROFILE ?? "rose";
if (!isSeedId(profileId)) throw new Error(`MIA_PROFILE must be one of: ${Object.keys(SEED_PROFILES).join(", ")}`);
const profile = SEED_PROFILES[profileId]();

const miaUrl = process.env.MIA_MCP_URL ?? (await startLocalMia({
  token, profileId, port: Number(process.env.PORT ?? 8787),
  dataDir: resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data"), weather: new OpenMeteoWeather(),
})).url;

const mia = await connectMia({ url: miaUrl, token });
const llm = new AnthropicLlm(new Anthropic({ apiKey }), process.env.MIA_MODEL ?? DEFAULT_MODEL);
const brain = new Brain({ mia, llm, profile, now: () => new Date() });
const app = createVoiceApp({ brain, profile, publicDir: resolve(import.meta.dirname, "../public") });

const voicePort = Number(process.env.VOICE_PORT ?? 8788);
serve({ fetch: app.fetch, port: voicePort, hostname: "127.0.0.1" });
console.log(`[mia-voice] LOCAL MODE — not production. Open http://127.0.0.1:${voicePort} in Chrome or Edge (profile: ${profileId}, Mia: ${miaUrl}).`);
```
Note: the voice profile (language, speech settings) comes from the seed; when the carer page can edit speech settings (Plan 3/5) the gateway will read them from Mia.

`packages/voice/public/index.html` (placeholder for this task's manual check; Task 8 replaces it):
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mia</title></head>
<body><p>LOCAL MODE — not production</p></body></html>
```
Also create empty `packages/voice/public/app.js`, `packages/voice/public/turn.js` (`export {};`) and `packages/voice/public/style.css` so the static routes resolve.

Root `package.json` scripts — add:
```json
    "dev": "pnpm --filter @mia/voice dev",
```

`.env.example` — append:
```
# Mia Voice (local mode)
# ANTHROPIC_API_KEY=  ← set in your shell from your keys CLI, or here in .env (never commit .env)
# MIA_MODEL=claude-sonnet-5-5
VOICE_PORT=8788
# MIA_MCP_URL=  ← leave unset to start Mia in-process
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/voice package.json .env.example
git commit -m "feat(voice): gateway HTTP app and one-command local entry point"
```

---

### Task 8: Voice — the browser "Echo"

**Files:**
- Create/replace: `packages/voice/public/index.html`, `packages/voice/public/style.css`, `packages/voice/public/app.js`, `packages/voice/public/turn.js`, `packages/voice/public/turn.d.ts`
- Test: `packages/voice/test/turn.test.ts`

**Interfaces:**
- Consumes: `/api/config`, `/api/turn`, `/api/proactive` (Task 7), `Reply` shape.
- Produces (browser module `turn.js`): `createTurnTaker({ timeoutMs, onTurn, setTimer?, clearTimer? })` → `{ heard({ text, isFinal, confidence? }), reset() }`; `speechPlan(reply)` → `{ text, rate, pauseAfterMs }[]`.

- [ ] **Step 1: Write the failing test**

`packages/voice/test/turn.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTurnTaker, speechPlan } from "../public/turn.js";

function fakeTimers() {
  let next = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id: number) => { timers.delete(id); },
    fire: () => { const all = [...timers.values()]; timers.clear(); all.forEach((f) => f()); },
    pending: () => timers.size,
  };
}

describe("createTurnTaker", () => {
  it("waits for silence after the last words, then sends the whole turn once", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "Did I", isFinal: false });
    taker.heard({ text: "Did I take", isFinal: true, confidence: 0.8 });
    taker.heard({ text: "my pills", isFinal: true, confidence: 0.6 });
    expect(t.pending()).toBe(1);
    expect(turns).toEqual([]);
    t.fire();
    expect(turns).toEqual([{ text: "Did I take my pills", confidence: 0.7 }]);
  });
  it("an unfinished phrase is still sent when she stops talking (never cut off, never lost)", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "is it group", isFinal: false });
    t.fire();
    expect(turns).toEqual([{ text: "is it group" }]);
  });
  it("browsers that report confidence 0 do not count as unsure", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "hello", isFinal: true, confidence: 0 });
    t.fire();
    expect(turns).toEqual([{ text: "hello" }]);
  });
  it("reset drops what was heard", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "hello", isFinal: true });
    taker.reset();
    t.fire();
    expect(turns).toEqual([]);
  });
});

describe("speechPlan", () => {
  it("one utterance per sentence, pause between, none after the last", () => {
    expect(speechPlan({ sentences: ["Not yet.", "Now it's time."], rate: 0.9, breakMs: 700 })).toEqual([
      { text: "Not yet.", rate: 0.9, pauseAfterMs: 700 },
      { text: "Now it's time.", rate: 0.9, pauseAfterMs: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/voice/test/turn.test.ts`
Expected: FAIL — `createTurnTaker` is not exported (placeholder `turn.js`).

- [ ] **Step 3: Implement**

`packages/voice/public/turn.js`:
```js
// Pure turn-taking logic for the browser "Echo" (no DOM), unit-tested in Node.

/**
 * Decides when she has finished speaking: `timeoutMs` of silence after the last words (spec §9.1, never cut her off).
 * Interim words are kept, so a phrase is never lost when the recogniser does not finalise it.
 */
export function createTurnTaker({ timeoutMs, onTurn, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let parts = [];
  let confidences = [];
  let interim = "";
  let timer = null;

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function finish() {
    timer = null;
    const text = [...parts, interim].join(" ").replace(/\s+/g, " ").trim();
    const turn = confidences.length
      ? { text, confidence: Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 }
      : { text };
    parts = [];
    confidences = [];
    interim = "";
    if (text) onTurn(turn);
  }

  return {
    heard({ text, isFinal, confidence }) {
      if (isFinal) {
        parts.push(text.trim());
        interim = "";
        if (typeof confidence === "number" && confidence > 0) confidences.push(confidence);
      } else {
        interim = text.trim();
      }
      clear();
      timer = setTimer(finish, timeoutMs);
    },
    reset() {
      clear();
      parts = [];
      confidences = [];
      interim = "";
    },
  };
}

/** One utterance per sentence with the calibrated pause between sentences (spec §8 rule 3). */
export function speechPlan(reply) {
  return reply.sentences.map((text, i) => ({
    text,
    rate: reply.rate,
    pauseAfterMs: i < reply.sentences.length - 1 ? reply.breakMs : 0,
  }));
}
```

`packages/voice/public/turn.d.ts`:
```ts
export interface HeardResult { text: string; isFinal: boolean; confidence?: number }
export interface Turn { text: string; confidence?: number }
export interface TurnTaker { heard(r: HeardResult): void; reset(): void }
export function createTurnTaker(o: {
  timeoutMs: number;
  onTurn: (t: Turn) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: never) => void;
}): TurnTaker;
export interface Utterance { text: string; rate: number; pauseAfterMs: number }
export function speechPlan(reply: { sentences: string[]; rate: number; breakMs: number }): Utterance[];
```

`packages/voice/public/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mia</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="banner">LOCAL MODE — not production · fictional demo persona</div>
  <main>
    <button id="ring" class="ring" data-state="idle" aria-label="Talk to Mia"><span class="glow"></span></button>
    <p id="status" class="status" aria-live="polite"></p>
    <section id="captions" class="captions" aria-live="polite"></section>
    <form id="type-form" class="type-form">
      <input id="typed" autocomplete="off" placeholder="…or type here">
      <button type="submit">Send</button>
    </form>
    <label class="toggle"><input id="captions-toggle" type="checkbox" checked> Captions</label>
  </main>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

`packages/voice/public/style.css`:
```css
:root { --bg: #10141c; --fg: #f4f1ea; --ring: #29c4f6; --warm: #ffb347; --muted: #8a93a6; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg); font: 22px/1.5 system-ui, sans-serif; }
.banner { background: #7a1f1f; color: #fff; text-align: center; font-size: 14px; padding: 6px 16px; letter-spacing: .04em; }
main { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 32px 16px; }
.ring { width: min(60vw, 320px); aspect-ratio: 1; border-radius: 50%; border: 0; cursor: pointer; background: #1b2230;
  box-shadow: inset 0 0 0 14px #2a3446; position: relative; }
.ring .glow { position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 14px transparent; transition: box-shadow .4s; }
.ring[data-state="listening"] .glow { box-shadow: inset 0 0 0 14px var(--ring), 0 0 60px var(--ring); animation: breathe 2.4s ease-in-out infinite; }
.ring[data-state="thinking"] .glow { box-shadow: inset 0 0 0 14px var(--muted); animation: spin 1.6s linear infinite; }
.ring[data-state="speaking"] .glow { box-shadow: inset 0 0 0 14px var(--warm), 0 0 60px var(--warm); }
@keyframes breathe { 50% { opacity: .55; } }
@keyframes spin { 50% { opacity: .4; } }
.status { font-size: 26px; margin: 0; min-height: 1.5em; text-align: center; }
.captions { width: min(100%, 720px); max-height: 40vh; overflow-y: auto; }
.captions p { margin: 8px 0; padding: 10px 14px; border-radius: 12px; }
.captions .rose { background: #1f2a3b; text-align: right; }
.captions .mia { background: #2b2417; }
.captions .music { color: var(--muted); font-style: italic; }
.type-form { display: flex; gap: 8px; width: min(100%, 720px); }
.type-form input { flex: 1; font: inherit; font-size: 18px; padding: 10px; border-radius: 10px; border: 1px solid #3a4558; background: #161c27; color: var(--fg); }
.type-form button, .toggle { font-size: 16px; }
.type-form button { padding: 10px 16px; border-radius: 10px; border: 0; background: #2a3446; color: var(--fg); }
.toggle { color: var(--muted); }
```

`packages/voice/public/app.js`:
```js
import { createTurnTaker, speechPlan } from "./turn.js";

const $ = (id) => document.getElementById(id);
const ring = $("ring");
const statusEl = $("status");
const captions = $("captions");

const LABELS = {
  "en-US": { idle: "Tap the circle to talk to Mia", listening: "I'm listening…", thinking: "One moment…", speaking: "", noMic: "Speech needs Chrome or Edge. You can type below." },
  "de-DE": { idle: "Tippe auf den Kreis, um mit Mia zu sprechen", listening: "Ich höre zu…", thinking: "Einen Moment…", speaking: "", noMic: "Sprache braucht Chrome oder Edge. Du kannst unten tippen." },
};
const PROACTIVE_POLL_MS = 20000;

const config = await (await fetch("/api/config")).json();
const L = LABELS[config.locale] ?? LABELS["en-US"];
document.documentElement.lang = config.locale.slice(0, 2);

let state = "idle";
let busy = false;
let started = false;
let wantListening = false;

function setState(s) {
  state = s;
  ring.dataset.state = s;
  statusEl.textContent = L[s] ?? "";
}
function caption(who, text) {
  const p = document.createElement("p");
  p.className = who;
  p.textContent = text;
  captions.append(p);
  captions.scrollTop = captions.scrollHeight;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const taker = createTurnTaker({ timeoutMs: config.endOfTurnTimeoutMs, onTurn: (turn) => send(turn) });
let recognition = null;
if (Recognition) {
  recognition = new Recognition();
  recognition.lang = config.locale;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      taker.heard({ text: r[0].transcript, isFinal: r.isFinal, confidence: r[0].confidence });
    }
  };
  recognition.onend = () => {
    if (wantListening) try { recognition.start(); } catch { /* already running */ }
  };
}

function listen() {
  if (!recognition) { setState("idle"); statusEl.textContent = L.noMic; return; }
  wantListening = true;
  setState("listening");
  try { recognition.start(); } catch { /* already running */ }
}
function stopListening() {
  wantListening = false;
  taker.reset();
  try { recognition?.stop(); } catch { /* not running */ }
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}
function speakOne(u) {
  return new Promise((resolve) => {
    const s = new SpeechSynthesisUtterance(u.text);
    s.lang = config.locale;
    s.rate = u.rate;
    const v = voiceFor(config.locale);
    if (v) s.voice = v;
    s.onend = resolve;
    s.onerror = resolve;
    speechSynthesis.speak(s);
  });
}

// Royalty-free stand-in: a short gentle tune. On real Alexa+ this is a hand-off to Alexa music.
async function playStandIn(artist) {
  caption("music", `♪ ${artist} — stand-in tune for the demo`);
  const ctx = new AudioContext();
  const notes = [392, 440, 494, 523, 494, 440, 392, 330, 349, 392, 440, 392];
  let t = ctx.currentTime + 0.1;
  for (const f of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
    t += 1;
  }
  await wait(notes.length * 1000 + 300);
  await ctx.close();
}

async function play(reply) {
  setState("speaking");
  for (const u of speechPlan(reply)) {
    caption("mia", u.text);
    await speakOne(u);
    await wait(u.pauseAfterMs);
  }
  if (reply.action?.type === "play_music") await playStandIn(reply.action.artist);
}

async function send(turn) {
  if (busy) return;
  busy = true;
  stopListening();
  setState("thinking");
  caption("rose", turn.text);
  try {
    const res = await fetch("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn) });
    if (res.ok) await play(await res.json());
  } catch { /* the next turn tries again */ }
  busy = false;
  listen();
}

ring.addEventListener("click", () => {
  started = true;
  if (state === "idle") listen();
});
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("typed").value.trim();
  $("typed").value = "";
  started = true;
  if (text) send({ text, confidence: 1 });
});
$("captions-toggle").addEventListener("change", (e) => { captions.hidden = !e.target.checked; });

// Mia speaks first (Care Mode demo). Browsers only allow sound after the first tap.
setInterval(async () => {
  if (!started || busy || state === "thinking" || state === "speaking") return;
  try {
    const { reply } = await (await fetch("/api/proactive")).json();
    if (!reply) return;
    busy = true;
    stopListening();
    await play(reply);
  } catch { /* try again at the next poll */ }
  busy = false;
  if (started) listen();
}, PROACTIVE_POLL_MS);

setState("idle");
if (!recognition) statusEl.textContent = L.noMic;
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Manual check in Chrome (owner or controller, needs the API key in the environment)**

Run: `MIA_DEV_TOKEN=$(openssl rand -hex 16) MIA_DATA_DIR=$(mktemp -d) pnpm dev` (with `ANTHROPIC_API_KEY` exported from the `keys` CLI), open `http://127.0.0.1:8788`.
Expected: red LOCAL MODE banner; tap the ring → "I'm listening…"; say "What day is it?" → after ~2 s of silence Mia answers with today's date at 90 % speed with pauses; type "I fell" → immediate "I've let Tom know right away."; "Pardon?" repeats slower. Record any problems in the task report.

- [ ] **Step 6: Commit**

```bash
git add packages/voice
git commit -m "feat(voice): browser Echo — tap once, calibrated end of turn, sentence pauses, music stand-in"
```

---

### Task 9: Sweep, README, roadmap, graph

**Files:**
- Modify: `packages/mcp-server/test/plain-sweep.test.ts`, `README.md`, `docs/superpowers/plans/2026-10-07-mia-roadmap.md`

- [ ] **Step 1: Extend the sweep with the weather and proactive cases**

In `packages/mcp-server/test/plain-sweep.test.ts`:
- import `proactivePrompt` from `@mia/shared` and add a second `it` inside the same `describe.each`:
```ts
  it("every proactive prompt of a full week passes the plain-language rules", () => {
    const seen = new Set<string>();
    for (let day = 12; day <= 18; day++) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
        const mm = String(minutes % 60).padStart(2, "0");
        const prompt = proactivePrompt(profile, [], at(`2026-10-${day}T${hh}:${mm}:00`));
        if (!prompt || seen.has(prompt.kind)) continue;
        seen.add(prompt.kind);
        expect(checkPlain(prompt.say.join(" "), profile.locale), prompt.say.join(" ")).toMatchObject({ ok: true });
        expect(prompt.say.at(-1)!.endsWith("?"), prompt.id).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(["bedtime", "check_in", "leave", "medication", "music"]);
  });
```
(`welcome_back` needs a `left_home` event and is covered in `proactive.test.ts`.)

Run: `pnpm vitest run packages/mcp-server/test/plain-sweep.test.ts`
Expected: PASS for en and de.

- [ ] **Step 2: README — replace the "Run locally" section with:**

```markdown
## Run locally (no AWS needed)

Requires Node 24, pnpm 10, Chrome or Edge (for speech), and an Anthropic API key.

    pnpm install
    cp .env.example .env              # set MIA_DEV_TOKEN to a long random string
    export ANTHROPIC_API_KEY=…        # from your secret store; never commit it
    pnpm dev                          # Mia Voice on http://127.0.0.1:8788 (starts the Mia MCP server too)

Tap the circle once and talk — no name, no wake word. Mia also speaks first at pill time, when it's time to leave for the group, at bedtime and for an afternoon chat. You can type instead of speaking.

To run only the MCP server (e.g. for the MCP Inspector): `pnpm dev:mcp` → `http://127.0.0.1:8787/mcp` with header `Authorization: Bearer <MIA_DEV_TOKEN>`.

Local mode stores data in SQLite under `.mia-data/`, encrypted with a generated AES-256-GCM key. It is **not** production; AWS mode (DynamoDB + KMS, OAuth 2.1, Transcribe/Polly/Bedrock) follows.

**"Care Mode" (a proposal for Alexa+):** in Mia Voice, care topics reach Mia without its name, and Mia may speak first at agreed times (`GET /proactive`). Today's Alexa+ add-ons cannot do this; the demo shows how it would help.
```

- [ ] **Step 3: Roadmap note**

In `docs/superpowers/plans/2026-10-07-mia-roadmap.md`, change the "Family voice messages" bullet's last sentence to: `Recording and playback both ship in Plan 3 (recording needs the carer page); Mia Voice plays them from Plan 3 on.`

- [ ] **Step 4: Full verification and graph**

Run: `pnpm test && pnpm typecheck && graphify update .`
Expected: all PASS, typecheck exit 0, graph updated.

- [ ] **Step 5: Commit**

```bash
git add packages README.md docs/superpowers/plans/2026-10-07-mia-roadmap.md
git commit -m "test: proactive prompts in the plain-language sweep; docs: run Mia Voice locally"
```

---

## Spec coverage (Plan 2 scope)

| Spec | Covered by |
|---|---|
| §3 / §5 Mia Voice as Alexa+ stand-in, LLM as MCP client | Tasks 5–7 |
| §5.3 local mode: Web Speech, Anthropic key, banner, `pnpm dev` with one key | Tasks 7, 8, 9 |
| §6.1 no name / no wake word, Mia speaks first, yes/no endings, night mode | Tasks 2, 3, 6, 8 |
| §6.1 Care Mode proposal (proactive prompts) demonstrated | Tasks 2, 3, 9 |
| §8 rules 1, 3, 6, 7, 9 (limits, rate + breaks, verbatim, slower repeat, yes/no) | Tasks 2, 5, 6, 8, 9 |
| §9.1 calibrated end of turn, never cut off | Task 8 |
| §9.2 one tap target, no wake word | Task 8 |
| §9.4–9.6 transcript + confidence, low confidence → yes/no check, two misses → safe default | Tasks 6, 8 |
| §9.7 distress double check (keywords + LLM) | Tasks 1, 6 |
| Roadmap additions: weather on the way out, favourite music offer | Tasks 1–4, 8 |
| Medication policy: prompts only for `due` doses | Task 2 |

**Deferred:** family voice messages (Plan 3), language switching §9.8 (later), custom vocabulary §9.3 (Plan 5 calibration; Web Speech has no custom vocabulary), Transcribe/Polly/Bedrock (Plan 4).
