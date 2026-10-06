# Plan 1 — Core: Domain, i18n, Store, MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally runnable Mia MCP server that exposes 14 care tools over Streamable HTTP, answers from an encrypted SQLite store seeded with the fictional Rose profile, in English and German, using verbatim plain-language templates.

**Architecture:** pnpm monorepo. `packages/shared` holds pure domain logic (time, appointments, medication status), i18n (time-to-words, templates, plain-language checker) and the Rose seed profiles. `packages/mcp-server` holds the field-encrypted store, the tool implementations, the MCP server factory and a Hono HTTP app with a stateless Streamable HTTP endpoint guarded by a dev bearer token (OAuth 2.1 replaces it in Plan 4).

**Tech Stack:** Node 24, pnpm 10, TypeScript 7.0.2, Vitest 5.0.3, tsx 4.23.15, `@modelcontextprotocol/sdk` 1.32.1, zod 4.6.5, hono 4.13.13, `@hono/node-server` 2.1.3, `node:sqlite`, `node:crypto`.

## Global Constraints

- Node `>=24`; ESM only (`"type": "module"`)
- MCP SDK **v1** `@modelcontextprotocol/sdk@1.32.1` — must accept protocol `2025-03-26` (Alexa+ client) and `2025-11-25`
- Every MCP tool: one store read, no LLM call, p95 < 300 ms
- Every tool result: `structuredContent = { facts, say, verbatim, guidance }` and `content[0].text = say.join(" ")`
- Speaking rules: ≤ 4 sentences per turn, ≤ 12 words per sentence (`simple` level); key fact first and repeated last; times in words; never "you already asked"
- No medical advice; medication answers only from plan + log
- Family content (descriptions, comfort notes, names) spoken exactly as entered, never translated
- Sensitive fields encrypted at rest (AES-256-GCM in local mode); no audio, no transcripts stored
- Only fictional Rose data in repo, tests, seeds
- Locales: `en-US`, `de-DE`. German addresses the user with "du"
- Time zone for Rose: `America/New_York`. Test dates in October 2026 use offset `-04:00`

---

## File Structure

```
package.json                     root scripts, dev deps
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
.env.example
packages/shared/
  package.json  tsconfig.json
  src/index.ts                   re-exports
  src/testing.ts                 at() helper for tests
  src/domain/types.ts            Profile, Medication, Appointment, CareEvent …
  src/domain/clock.ts            localParts, toMinutes, addDays
  src/domain/today.ts            occursOn, appointmentsOn, partOfDay, todayView, nextAppointment
  src/domain/medication.ts       doseStatuses
  src/i18n/words.ts              timeWords, dateWords, weekdayName, joinList
  src/i18n/templates.ts          per-locale sentence templates
  src/i18n/plain.ts              splitSentences, checkPlain
  src/seed/rose.ts               rose() en-US, roseDe() de-DE, defaultSpeech()
  test/*.test.ts
packages/mcp-server/
  package.json  tsconfig.json
  src/store/crypto.ts            FieldCipher, LocalAesCipher, loadOrCreateLocalKey
  src/store/store.ts             Store interface, AlertInput, StoredAlert
  src/store/sqliteStore.ts       SqliteStore
  src/alerts.ts                  AlertSink, StoreAlertSink
  src/tools/runtime.ts           ToolContext, MiaResult, run(), logEvent(), OUTPUT_SHAPE
  src/tools/orientation.ts       get_today, get_next_appointment, get_preparation_steps, night_reassurance
  src/tools/medication.ts        get_medication_status, confirm_medication
  src/tools/outings.ts           report_leaving, report_home
  src/tools/comfort.ts           comfort_me, chat_about_life, request_call
  src/tools/people.ts            who_is
  src/tools/problem.ts           report_problem
  src/tools/repeat.ts            repeat_last
  src/server.ts                  createMiaServer()
  src/http.ts                    createHttpApp()
  src/main.ts                    local entry point
  test/helpers.ts                connect() in-memory MCP client
  test/*.test.ts
```

---

### Task 1: Monorepo scaffold + clock

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/domain/types.ts`, `packages/shared/src/domain/clock.ts`, `packages/shared/src/index.ts`, `packages/shared/src/testing.ts`
- Test: `packages/shared/test/clock.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Locale`, `Weekday`, `HHMM`, `Profile`, `Medication`, `Appointment`, `Person`, `RoutineItem`, `SpeechSettings`, `TravelMode`, `CareEvent`, `EventType`, `EVENT_TYPES`; `localParts(instant: Date, timeZone: string): LocalParts`; `toMinutes(t: HHMM): number`; `addDays(date: string, n: number): { date: string; weekday: Weekday }`; `at(local: string): Date`

- [ ] **Step 1: Create root config files**

`package.json`:
```json
{
  "name": "mia",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.3",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit -p tsconfig.json",
    "dev:mcp": "pnpm --filter @mia/mcp-server dev"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts"] },
});
```

Append to `.gitignore`:
```
.mia-data/
```

`packages/shared/package.json`:
```json
{
  "name": "@mia/shared",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Install dev dependencies**

Run: `pnpm add -Dw typescript@7.0.2 vitest@5.0.3 tsx@4.23.15 @types/node@^24`
Expected: `pnpm-lock.yaml` created, no errors.

- [ ] **Step 3: Write the failing clock test**

`packages/shared/test/clock.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addDays, localParts, toMinutes } from "../src/domain/clock";

describe("localParts", () => {
  it("converts an instant to New York local time (EDT)", () => {
    expect(localParts(new Date("2026-10-12T12:05:00Z"), "America/New_York")).toEqual({
      date: "2026-10-12", time: "08:05", minutes: 485, weekday: 1,
    });
  });
  it("uses 00:xx, never 24:xx, at midnight", () => {
    expect(localParts(new Date("2026-10-13T04:00:00Z"), "America/New_York")).toMatchObject({
      date: "2026-10-13", time: "00:00", weekday: 2,
    });
  });
  it("handles Europe/Berlin (CEST)", () => {
    expect(localParts(new Date("2026-10-12T06:05:00Z"), "Europe/Berlin").time).toBe("08:05");
  });
  it("follows the US DST change on 2026-11-01", () => {
    expect(localParts(new Date("2026-11-02T13:00:00Z"), "America/New_York").time).toBe("08:00");
  });
});

describe("toMinutes", () => {
  it("parses HH:MM", () => expect(toMinutes("09:40")).toBe(580));
});

describe("addDays", () => {
  it("moves to the next day with ISO weekday", () => {
    expect(addDays("2026-10-12", 1)).toEqual({ date: "2026-10-13", weekday: 2 });
  });
  it("wraps Sunday to Monday", () => {
    expect(addDays("2026-10-18", 1)).toEqual({ date: "2026-10-19", weekday: 1 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test packages/shared/test/clock.test.ts`
Expected: FAIL — cannot resolve `../src/domain/clock`.

- [ ] **Step 5: Write types, clock, index, testing helper**

`packages/shared/src/domain/types.ts`:
```ts
export type Locale = "en-US" | "de-DE";
/** ISO 8601 weekday, Monday = 1 … Sunday = 7 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** 24 h local time, "08:00" */
export type HHMM = string;

export interface RoutineItem { time: HHMM; label: string }

export interface Medication {
  id: string;
  /** short spoken name, e.g. "your morning pills" */
  name: string;
  /** plain description spoken as entered, e.g. "the small white pill" */
  description: string;
  times: HHMM[];
  /** omitted = every day */
  weekdays?: Weekday[];
  /** a dose inside this appointment's time window is given there */
  takenAtAppointmentId?: string;
}

export type TravelMode = "alone" | "pickup" | "family_drives" | "at_home";

export interface Appointment {
  id: string;
  name: string;
  /** words she may use for it: "group", "Gruppe" */
  aliases: string[];
  location?: string;
  /** recurring weekdays; omitted when `date` is set */
  weekdays?: Weekday[];
  /** one-off date YYYY-MM-DD */
  date?: string;
  start: HHMM;
  end: HHMM;
  cancelledDates: string[];
  travelMode: TravelMode;
  leaveBy?: HHMM;
  expectedReturn?: HHMM;
  graceMinutes: number;
  checklist: string[];
}

export interface Person {
  id: string;
  name: string;
  /** en: "son"; de: includes possessive, "dein Sohn" */
  relationship: string;
  contact?: string;
  notes?: string;
}

export interface SpeechSettings {
  voiceId?: string;
  speechRate: number;
  sentenceBreakMs: number;
  plainLevel: "simple" | "very_simple";
  endOfTurnTimeoutMs: number;
  confidenceThreshold: number;
  customVocabulary: string[];
  lastCalibratedAt?: string;
}

export interface Profile {
  id: string;
  name: string;
  preferredName: string;
  locale: Locale;
  timezone: string;
  carerName: string;
  routine: RoutineItem[];
  medications: Medication[];
  appointments: Appointment[];
  people: Person[];
  comfortNotes: string[];
  lifeStory: string[];
  speech: SpeechSettings;
}

export const EVENT_TYPES = [
  "orientation_asked", "left_home", "arrived_home",
  "med_asked", "med_confirmed", "med_duplicate_attempt", "med_not_due_attempt",
  "anxious", "night_awake", "person_asked", "lonely", "call_requested",
  "distress", "repeat_asked", "unknown_question",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface CareEvent {
  profileId: string;
  type: EventType;
  /** ISO 8601 UTC instant */
  at: string;
  detail?: Record<string, string>;
}
```

`packages/shared/src/domain/clock.ts`:
```ts
import type { HHMM, Weekday } from "./types";

export interface LocalParts { date: string; time: HHMM; minutes: number; weekday: Weekday }

const WEEKDAY: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function toMinutes(t: HHMM): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  const time = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time, minutes: toMinutes(time), weekday: WEEKDAY[p.weekday!]! };
}

export function addDays(date: string, n: number): { date: string; weekday: Weekday } {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const wd = d.getUTCDay();
  return { date: d.toISOString().slice(0, 10), weekday: (wd === 0 ? 7 : wd) as Weekday };
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./domain/types";
export * from "./domain/clock";
```

`packages/shared/src/testing.ts`:
```ts
/** Local New York time in October 2026 (EDT, UTC-4) → Date. Test helper only. */
export const at = (local: string): Date => new Date(`${local}-04:00`);
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 7 tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.config.ts .gitignore packages/shared
git commit -m "feat(shared): monorepo scaffold, domain types and clock"
```

---

### Task 2: Rose seed + appointments and today view

**Files:**
- Create: `packages/shared/src/seed/rose.ts`, `packages/shared/src/domain/today.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/today.test.ts`

**Interfaces:**
- Consumes: types, `localParts`, `toMinutes`, `addDays` (Task 1)
- Produces: `rose(): Profile`; `defaultSpeech(): SpeechSettings`; `occursOn(a, date, weekday): boolean`; `appointmentsOn(p, date, weekday): Appointment[]`; `type PartOfDay = "morning" | "afternoon" | "evening" | "night"`; `partOfDay(minutes: number): PartOfDay`; `interface TodayView { date; weekday; time; minutes; partOfDay; appointments; nextRoutine? }`; `todayView(p, now: Date): TodayView`; `interface NextAppointment { appointment; date; weekday; daysAway }`; `nextAppointment(p, now: Date, nameQuery?: string): NextAppointment | null`; `matchesAppointment(a, query): boolean`

- [ ] **Step 1: Write the Rose seed (data only, from `docs/persona/rose.md`)**

`packages/shared/src/seed/rose.ts`:
```ts
import type { Profile, SpeechSettings } from "../domain/types";

export function defaultSpeech(): SpeechSettings {
  return {
    speechRate: 90, sentenceBreakMs: 700, plainLevel: "simple",
    endOfTurnTimeoutMs: 1800, confidenceThreshold: 0.6, customVocabulary: [],
  };
}

/** Fictional demo persona — see docs/persona/rose.md */
export function rose(): Profile {
  return {
    id: "rose",
    name: "Rose Whitaker",
    preferredName: "Rose",
    locale: "en-US",
    timezone: "America/New_York",
    carerName: "Tom",
    routine: [
      { time: "07:30", label: "coffee" },
      { time: "08:00", label: "breakfast" },
      { time: "12:00", label: "lunch" },
      { time: "15:00", label: "tea" },
      { time: "18:00", label: "supper" },
      { time: "19:00", label: "Tom's call" },
      { time: "21:30", label: "bedtime" },
    ],
    medications: [
      { id: "morning-pills", name: "your morning pills", description: "the small white pill and the round pink one", times: ["08:00"] },
      { id: "noon-pill", name: "your noon pill", description: "the little yellow one", times: ["12:00"], takenAtAppointmentId: "maple-grove" },
      { id: "evening-pill", name: "your evening pill", description: "the white capsule", times: ["20:00"] },
    ],
    appointments: [
      {
        id: "maple-grove",
        name: "Maple Grove Day Club",
        aliases: ["group", "day club", "club", "maple grove"],
        location: "Maple Grove Community Center",
        weekdays: [1, 2, 4],
        start: "10:00", end: "14:00",
        cancelledDates: [],
        travelMode: "alone",
        leaveBy: "09:40", expectedReturn: "14:30", graceMinutes: 30,
        checklist: ["your keys on the red lanyard", "your handbag", "your glasses", "your coat"],
      },
    ],
    people: [
      { id: "tom", name: "Tom", relationship: "son", contact: "Tom calls you every evening at seven." },
      { id: "lily", name: "Lily", relationship: "granddaughter", contact: "Lily calls you on Sundays." },
      { id: "june", name: "June", relationship: "neighbor", contact: "June lives next door and has a key." },
      { id: "frank", name: "Frank", relationship: "husband", notes: "Frank loved you very much." },
    ],
    comfortNotes: [
      "You're safe at home on Linden Street.",
      "Tom calls you every evening at seven. He loves you.",
      "You don't need to go to work anymore. You retired from the library.",
      "June next door has a key and is always happy to help.",
    ],
    lifeStory: [
      "You were a school librarian for 38 years at Westgate Elementary.",
      "You love your rose garden, especially the yellow climbing rose by the porch.",
      "You love Frank Sinatra and Ella Fitzgerald.",
      "You married Frank in 1966 and went to Niagara Falls.",
      "You grew up in Dayton, the youngest of four sisters.",
      "Your apple pie is the best on Linden Street.",
    ],
    speech: defaultSpeech(),
  };
}
```

- [ ] **Step 2: Write the failing today test**

`packages/shared/test/today.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { at } from "../src/testing";
import { rose } from "../src/seed/rose";
import { appointmentsOn, nextAppointment, partOfDay, todayView } from "../src/domain/today";

describe("appointmentsOn", () => {
  it("finds the group on Monday", () => {
    expect(appointmentsOn(rose(), "2026-10-12", 1).map((a) => a.id)).toEqual(["maple-grove"]);
  });
  it("finds nothing on Wednesday", () => {
    expect(appointmentsOn(rose(), "2026-10-14", 3)).toEqual([]);
  });
  it("skips cancelled dates", () => {
    const p = rose();
    p.appointments[0]!.cancelledDates = ["2026-10-15"];
    expect(appointmentsOn(p, "2026-10-15", 4)).toEqual([]);
  });
  it("supports one-off dates", () => {
    const p = rose();
    p.appointments.push({ ...p.appointments[0]!, id: "dentist", name: "the dentist", aliases: [], weekdays: undefined, date: "2026-10-14", start: "11:00", end: "12:00" });
    expect(appointmentsOn(p, "2026-10-14", 3).map((a) => a.id)).toEqual(["dentist"]);
  });
});

describe("partOfDay", () => {
  it.each([[180, "night"], [300, "morning"], [720, "afternoon"], [1020, "evening"], [1320, "night"]] as const)(
    "%i minutes → %s", (m, expected) => expect(partOfDay(m)).toBe(expected),
  );
});

describe("todayView", () => {
  it("Monday 08:05: group today, lunch next", () => {
    const v = todayView(rose(), at("2026-10-12T08:05:00"));
    expect(v).toMatchObject({ date: "2026-10-12", weekday: 1, time: "08:05", partOfDay: "morning" });
    expect(v.appointments.map((a) => a.id)).toEqual(["maple-grove"]);
    expect(v.nextRoutine?.label).toBe("lunch");
  });
});

describe("nextAppointment", () => {
  it("Wednesday: next group is Thursday", () => {
    const n = nextAppointment(rose(), at("2026-10-14T10:00:00"), "group");
    expect(n).toMatchObject({ date: "2026-10-15", weekday: 4, daysAway: 1 });
  });
  it("Monday 11:00: group is ongoing today", () => {
    expect(nextAppointment(rose(), at("2026-10-12T11:00:00"))?.daysAway).toBe(0);
  });
  it("Monday 15:00: group over, next is Tuesday", () => {
    expect(nextAppointment(rose(), at("2026-10-12T15:00:00"))).toMatchObject({ date: "2026-10-13", daysAway: 1 });
  });
  it("matches German alias words inside a sentence", () => {
    const p = rose();
    p.appointments[0]!.aliases.push("gruppe");
    expect(nextAppointment(p, at("2026-10-14T10:00:00"), "meine Gruppe")?.weekday).toBe(4);
  });
  it("returns null for unknown appointments", () => {
    expect(nextAppointment(rose(), at("2026-10-12T08:00:00"), "dentist")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test packages/shared/test/today.test.ts`
Expected: FAIL — cannot resolve `../src/domain/today`.

- [ ] **Step 4: Implement today.ts**

`packages/shared/src/domain/today.ts`:
```ts
import { addDays, localParts, toMinutes } from "./clock";
import type { Appointment, HHMM, Profile, RoutineItem, Weekday } from "./types";

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

export function partOfDay(minutes: number): PartOfDay {
  if (minutes >= 300 && minutes < 720) return "morning";
  if (minutes >= 720 && minutes < 1020) return "afternoon";
  if (minutes >= 1020 && minutes < 1320) return "evening";
  return "night";
}

export function occursOn(a: Appointment, date: string, weekday: Weekday): boolean {
  if (a.cancelledDates.includes(date)) return false;
  if (a.date) return a.date === date;
  return (a.weekdays ?? []).includes(weekday);
}

const byStart = (x: Appointment, y: Appointment) => toMinutes(x.start) - toMinutes(y.start);

export function appointmentsOn(p: Profile, date: string, weekday: Weekday): Appointment[] {
  return p.appointments.filter((a) => occursOn(a, date, weekday)).sort(byStart);
}

export interface TodayView {
  date: string;
  weekday: Weekday;
  time: HHMM;
  minutes: number;
  partOfDay: PartOfDay;
  appointments: Appointment[];
  nextRoutine?: RoutineItem;
}

export function todayView(p: Profile, now: Date): TodayView {
  const l = localParts(now, p.timezone);
  const nextRoutine = [...p.routine]
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
    .find((r) => toMinutes(r.time) > l.minutes);
  return {
    date: l.date, weekday: l.weekday, time: l.time, minutes: l.minutes,
    partOfDay: partOfDay(l.minutes),
    appointments: appointmentsOn(p, l.date, l.weekday),
    nextRoutine,
  };
}

export function matchesAppointment(a: Appointment, query: string): boolean {
  const q = query.trim().toLowerCase();
  return [a.name, ...a.aliases].some((n) => {
    const name = n.toLowerCase();
    return q.includes(name) || name.includes(q);
  });
}

export interface NextAppointment { appointment: Appointment; date: string; weekday: Weekday; daysAway: number }

export function nextAppointment(p: Profile, now: Date, nameQuery?: string): NextAppointment | null {
  const l = localParts(now, p.timezone);
  const candidates = (nameQuery ? p.appointments.filter((a) => matchesAppointment(a, nameQuery)) : p.appointments)
    .slice()
    .sort(byStart);
  for (let d = 0; d <= 14; d++) {
    const day = addDays(l.date, d);
    for (const a of candidates) {
      if (!occursOn(a, day.date, day.weekday)) continue;
      if (d === 0 && toMinutes(a.end) <= l.minutes) continue;
      return { appointment: a, date: day.date, weekday: day.weekday, daysAway: d };
    }
  }
  return null;
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from "./domain/today";
export * from "./seed/rose";
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Rose seed, appointments, today view, next appointment"
```

---

### Task 3: Medication status

**Files:**
- Create: `packages/shared/src/domain/medication.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/medication.test.ts`

**Interfaces:**
- Consumes: `localParts`, `toMinutes`, `appointmentsOn`, `rose()`
- Produces: `type DoseState = "taken" | "due" | "upcoming" | "at_appointment"`; `interface DoseStatus { medicationId; name; description; time; state; takenAt?: HHMM; appointmentName?: string }`; `DUE_WINDOW_MINUTES = 30`; `doseStatuses(p: Profile, events: CareEvent[], now: Date): DoseStatus[]` (sorted by time)

- [ ] **Step 1: Write the failing test**

`packages/shared/test/medication.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { at } from "../src/testing";
import { rose } from "../src/seed/rose";
import { doseStatuses } from "../src/domain/medication";
import type { CareEvent } from "../src/domain/types";

const confirmed = (medicationId: string, doseTime: string, iso: string): CareEvent =>
  ({ profileId: "rose", type: "med_confirmed", at: iso, detail: { medicationId, doseTime } });

const states = (s: ReturnType<typeof doseStatuses>) => s.map((d) => [d.medicationId, d.state]);

describe("doseStatuses", () => {
  it("Monday 08:05: morning due, noon at group, evening upcoming", () => {
    const s = doseStatuses(rose(), [], at("2026-10-12T08:05:00"));
    expect(states(s)).toEqual([["morning-pills", "due"], ["noon-pill", "at_appointment"], ["evening-pill", "upcoming"]]);
    expect(s[1]!.appointmentName).toBe("Maple Grove Day Club");
  });
  it("Wednesday 12:00: noon pill is due at home (no group)", () => {
    expect(doseStatuses(rose(), [], at("2026-10-14T12:00:00"))[1]!.state).toBe("due");
  });
  it("due window opens 30 minutes before", () => {
    expect(doseStatuses(rose(), [], at("2026-10-12T07:29:00"))[0]!.state).toBe("upcoming");
    expect(doseStatuses(rose(), [], at("2026-10-12T07:30:00"))[0]!.state).toBe("due");
  });
  it("a confirmation today marks the dose taken with local time", () => {
    const s = doseStatuses(rose(), [confirmed("morning-pills", "08:00", "2026-10-12T12:06:00Z")], at("2026-10-12T09:00:00"));
    expect(s[0]).toMatchObject({ state: "taken", takenAt: "08:06" });
  });
  it("a confirmation yesterday does not count today", () => {
    const s = doseStatuses(rose(), [confirmed("morning-pills", "08:00", "2026-10-11T12:06:00Z")], at("2026-10-12T08:10:00"));
    expect(s[0]!.state).toBe("due");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/shared/test/medication.test.ts`
Expected: FAIL — cannot resolve `../src/domain/medication`.

- [ ] **Step 3: Implement medication.ts**

`packages/shared/src/domain/medication.ts`:
```ts
import { localParts, toMinutes } from "./clock";
import { appointmentsOn } from "./today";
import type { CareEvent, HHMM, Profile } from "./types";

export type DoseState = "taken" | "due" | "upcoming" | "at_appointment";

export interface DoseStatus {
  medicationId: string;
  name: string;
  description: string;
  time: HHMM;
  state: DoseState;
  takenAt?: HHMM;
  appointmentName?: string;
}

export const DUE_WINDOW_MINUTES = 30;

export function doseStatuses(p: Profile, events: CareEvent[], now: Date): DoseStatus[] {
  const l = localParts(now, p.timezone);
  const todays = appointmentsOn(p, l.date, l.weekday);
  const out: DoseStatus[] = [];
  for (const m of p.medications) {
    if (m.weekdays && !m.weekdays.includes(l.weekday)) continue;
    for (const time of m.times) {
      const base = { medicationId: m.id, name: m.name, description: m.description, time };
      const taken = events.find((e) =>
        e.type === "med_confirmed" && e.detail?.medicationId === m.id && e.detail?.doseTime === time &&
        localParts(new Date(e.at), p.timezone).date === l.date);
      if (taken) {
        out.push({ ...base, state: "taken", takenAt: localParts(new Date(taken.at), p.timezone).time });
        continue;
      }
      const appt = m.takenAtAppointmentId
        ? todays.find((a) => a.id === m.takenAtAppointmentId &&
            toMinutes(a.start) <= toMinutes(time) && toMinutes(time) <= toMinutes(a.end))
        : undefined;
      if (appt) {
        out.push({ ...base, state: "at_appointment", appointmentName: appt.name });
        continue;
      }
      out.push({ ...base, state: l.minutes >= toMinutes(time) - DUE_WINDOW_MINUTES ? "due" : "upcoming" });
    }
  }
  return out.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from "./domain/medication";
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): medication dose status from plan and log"
```

---

### Task 4: Time, date and list words (en + de)

**Files:**
- Create: `packages/shared/src/i18n/words.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/words.test.ts`

**Interfaces:**
- Consumes: `toMinutes`, `partOfDay`, `Locale`, `Weekday`
- Produces: `timeWords(t: HHMM, locale: Locale, opts?: { withPart?: boolean }): string`; `weekdayName(w: Weekday, locale): string`; `dateWords(date: string, weekday: Weekday, locale): string`; `joinList(items: string[], locale): string`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/words.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dateWords, joinList, timeWords, weekdayName } from "../src/i18n/words";

describe("timeWords en-US", () => {
  it.each([
    ["08:00", "eight o'clock"], ["14:30", "half past two"], ["09:40", "twenty to ten"],
    ["08:15", "quarter past eight"], ["19:45", "quarter to eight"], ["12:00", "twelve o'clock"],
    ["00:05", "five past twelve"], ["08:12", "about ten past eight"], ["08:13", "about quarter past eight"],
  ])("%s → %s", (t, w) => expect(timeWords(t, "en-US")).toBe(w));
  it("adds the part of day", () => {
    expect(timeWords("20:00", "en-US", { withPart: true })).toBe("eight o'clock in the evening");
    expect(timeWords("08:00", "en-US", { withPart: true })).toBe("eight o'clock in the morning");
    expect(timeWords("12:00", "en-US", { withPart: true })).toBe("twelve noon");
    expect(timeWords("03:10", "en-US", { withPart: true })).toBe("ten past three at night");
  });
});

describe("timeWords de-DE", () => {
  it.each([
    ["08:00", "acht Uhr"], ["13:00", "ein Uhr"], ["14:30", "halb drei"], ["09:40", "zwanzig vor zehn"],
    ["08:15", "Viertel nach acht"], ["09:25", "fünf vor halb zehn"], ["09:35", "fünf nach halb zehn"],
    ["19:45", "Viertel vor acht"], ["08:12", "etwa zehn nach acht"], ["01:30", "halb zwei"],
  ])("%s → %s", (t, w) => expect(timeWords(t, "de-DE")).toBe(w));
  it("adds the part of day", () => {
    expect(timeWords("20:00", "de-DE", { withPart: true })).toBe("acht Uhr abends");
    expect(timeWords("12:00", "de-DE", { withPart: true })).toBe("zwölf Uhr mittags");
  });
});

describe("dates and lists", () => {
  it("weekday names", () => {
    expect(weekdayName(1, "en-US")).toBe("Monday");
    expect(weekdayName(7, "de-DE")).toBe("Sonntag");
  });
  it("date words", () => {
    expect(dateWords("2026-10-12", 1, "en-US")).toBe("Monday, October 12");
    expect(dateWords("2026-10-12", 1, "de-DE")).toBe("Montag, der 12. Oktober");
  });
  it("joins lists", () => {
    expect(joinList(["a"], "en-US")).toBe("a");
    expect(joinList(["a", "b"], "en-US")).toBe("a and b");
    expect(joinList(["a", "b", "c"], "de-DE")).toBe("a, b und c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/shared/test/words.test.ts`
Expected: FAIL — cannot resolve `../src/i18n/words`.

- [ ] **Step 3: Implement words.ts**

`packages/shared/src/i18n/words.ts`:
```ts
import { toMinutes } from "../domain/clock";
import { partOfDay, type PartOfDay } from "../domain/today";
import type { HHMM, Locale, Weekday } from "../domain/types";

const EN_HOURS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const DE_HOURS = ["zwölf", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf"];
const EN_MIN: Record<number, string> = { 5: "five", 10: "ten", 20: "twenty", 25: "twenty-five" };
const EN_PART: Record<PartOfDay, string> = { morning: "in the morning", afternoon: "in the afternoon", evening: "in the evening", night: "at night" };
const DE_PART: Record<PartOfDay, string> = { morning: "morgens", afternoon: "nachmittags", evening: "abends", night: "nachts" };

function en(h: number, m: number): string {
  const hr = EN_HOURS[h % 12]!;
  const next = EN_HOURS[(h + 1) % 12]!;
  if (m === 0) return `${hr} o'clock`;
  if (m === 15) return `quarter past ${hr}`;
  if (m === 30) return `half past ${hr}`;
  if (m === 45) return `quarter to ${next}`;
  return m < 30 ? `${EN_MIN[m]} past ${hr}` : `${EN_MIN[60 - m]} to ${next}`;
}

function de(h: number, m: number): string {
  const hr = DE_HOURS[h % 12]!;
  const next = DE_HOURS[(h + 1) % 12]!;
  switch (m) {
    case 0: return `${h % 12 === 1 ? "ein" : hr} Uhr`;
    case 5: return `fünf nach ${hr}`;
    case 10: return `zehn nach ${hr}`;
    case 15: return `Viertel nach ${hr}`;
    case 20: return `zwanzig nach ${hr}`;
    case 25: return `fünf vor halb ${next}`;
    case 30: return `halb ${next}`;
    case 35: return `fünf nach halb ${next}`;
    case 40: return `zwanzig vor ${next}`;
    case 45: return `Viertel vor ${next}`;
    case 50: return `zehn vor ${next}`;
    default: return `fünf vor ${next}`;
  }
}

export function timeWords(t: HHMM, locale: Locale, opts: { withPart?: boolean } = {}): string {
  const total = toMinutes(t);
  const rounded = (Math.round(total / 5) * 5) % 1440;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  const isDe = locale === "de-DE";
  if (opts.withPart && rounded === 720) return isDe ? "zwölf Uhr mittags" : "twelve noon";
  let words = isDe ? de(h, m) : en(h, m);
  if (opts.withPart) words += ` ${(isDe ? DE_PART : EN_PART)[partOfDay(rounded)]}`;
  if (rounded !== total) words = `${isDe ? "etwa" : "about"} ${words}`;
  return words;
}

const WEEKDAYS: Record<Locale, string[]> = {
  "en-US": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "de-DE": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
};
const MONTHS: Record<Locale, string[]> = {
  "en-US": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  "de-DE": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};

export function weekdayName(w: Weekday, locale: Locale): string {
  return WEEKDAYS[locale][w - 1]!;
}

export function dateWords(date: string, weekday: Weekday, locale: Locale): string {
  const [, month, day] = date.split("-").map(Number);
  const wd = weekdayName(weekday, locale);
  const mon = MONTHS[locale][month! - 1]!;
  return locale === "de-DE" ? `${wd}, der ${day}. ${mon}` : `${wd}, ${mon} ${day}`;
}

export function joinList(items: string[], locale: Locale): string {
  if (items.length <= 1) return items[0] ?? "";
  const and = locale === "de-DE" ? "und" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from "./i18n/words";
```

- [ ] **Step 4: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): time, date and list words in English and German"
```

---

### Task 5: Templates, plain-language checker, German Rose

**Files:**
- Create: `packages/shared/src/i18n/templates.ts`, `packages/shared/src/i18n/plain.ts`
- Modify: `packages/shared/src/seed/rose.ts` (add `roseDe()`), `packages/shared/src/index.ts`
- Test: `packages/shared/test/templates.test.ts`

**Interfaces:**
- Consumes: `Locale`, `rose()`
- Produces: `interface Templates` (methods listed in code below); `templates(locale: Locale): Templates`; `splitSentences(text): string[]`; `PLAIN_LIMITS`; `checkPlain(text: string, locale: Locale, level?: "simple" | "very_simple"): { ok: boolean; problems: string[] }`; `roseDe(): Profile`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/templates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { templates } from "../src/i18n/templates";
import { checkPlain, splitSentences } from "../src/i18n/plain";
import { rose, roseDe } from "../src/seed/rose";

describe("splitSentences", () => {
  it("splits on . ! ?", () => expect(splitSentences("Yes. You took them! Good?")).toEqual(["Yes.", "You took them!", "Good?"]));
});

describe("checkPlain", () => {
  it("accepts short sentences", () => expect(checkPlain("Today is Monday. Today is Monday.", "en-US").ok).toBe(true));
  it("rejects sentences over 12 words", () => {
    const r = checkPlain("This sentence has far too many words for an older listener to follow easily.", "en-US");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/words/);
  });
  it("rejects more than 4 sentences", () => expect(checkPlain("A. B. C. D. E.", "en-US").ok).toBe(false));
  it("rejects 'already asked'", () => expect(checkPlain("You already asked that.", "en-US").ok).toBe(false));
  it("rejects 'wie gesagt'", () => expect(checkPlain("Wie gesagt, heute ist Montag.", "de-DE").ok).toBe(false));
  it("is stricter for very_simple", () => expect(checkPlain("Your next pills are at eight in the evening.", "en-US", "very_simple").ok).toBe(false));
});

describe("templates", () => {
  const all = (locale: "en-US" | "de-DE", carer: string) => {
    const T = templates(locale);
    return [
      T.todayIs("Monday, October 12"), T.repeatDay("Monday"), T.leaveFor("Maple Grove Day Club", "twenty to ten"),
      T.apptAt("Maple Grove Day Club", "ten o'clock"), T.apptUntil("Maple Grove Day Club", "two o'clock"),
      T.apptTodayYes("Maple Grove Day Club"), T.apptNotToday("Maple Grove Day Club", "Thursday"), T.onDay("Thursday"),
      T.nothingToday(), T.nextRoutine("supper", "six o'clock"), T.dontKnow(carer), T.take(["your keys", "your bag"]),
      T.thatsAll(), T.leavingOk(), T.keysCheck(), T.welcomeHome("Rose"), T.niceTime(), T.notYet(),
      T.medDue("your morning pills"), T.medIs("the white capsule"), T.medTaken("your morning pills", "five past eight"),
      T.medNextAt("eight o'clock in the evening"), T.medAtAppt("your noon pill", "Maple Grove Day Club"), T.medNoneToday(),
      T.medConfirmed("your morning pills"), T.medAlreadyTaken("your morning pills", "five past eight"), T.noMoreNow(),
      T.safeAtHome(), T.callOffer(carer), T.callRequested(carer), T.nightIs("ten past three"), T.nightSafe(),
      T.distressAck(carer), T.distressFollow(carer), T.systemError(carer), T.personIs("Tom", "son"),
    ];
  };
  it.each(["en-US", "de-DE"] as const)("every %s template is plain language", (locale) => {
    for (const s of all(locale, "Tom")) expect(checkPlain(s, locale), s).toMatchObject({ ok: true });
  });
  it("renders English exactly", () => {
    const T = templates("en-US");
    expect(T.leaveFor("Maple Grove Day Club", "twenty to ten")).toBe("You leave for Maple Grove Day Club at twenty to ten.");
    expect(T.medTaken("your morning pills", "five past eight")).toBe("Yes. You took your morning pills at five past eight.");
  });
  it("renders German exactly", () => {
    const T = templates("de-DE");
    expect(T.leaveFor("Tagesgruppe", "zwanzig vor zehn")).toBe("Tagesgruppe ist heute. Du gehst um zwanzig vor zehn los.");
    expect(T.take(["deinen Schlüssel", "deine Tasche"])).toBe("Nimm deinen Schlüssel und deine Tasche mit.");
  });
});

describe("roseDe", () => {
  it("is the German variant of Rose", () => {
    const p = roseDe();
    expect(p).toMatchObject({ id: "rose-de", locale: "de-DE", carerName: "Tom" });
    expect(p.appointments[0]!.weekdays).toEqual(rose().appointments[0]!.weekdays);
    expect(p.people[0]!.relationship).toBe("dein Sohn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/shared/test/templates.test.ts`
Expected: FAIL — cannot resolve `../src/i18n/templates`.

- [ ] **Step 3: Implement plain.ts**

`packages/shared/src/i18n/plain.ts`:
```ts
import type { Locale } from "../domain/types";

export const PLAIN_LIMITS = {
  simple: { maxWords: 12, maxSentences: 4 },
  very_simple: { maxWords: 8, maxSentences: 3 },
} as const;

const FORBIDDEN: Record<Locale, string[]> = {
  "en-US": ["already asked", "as i said", "i told you", "you asked that"],
  "de-DE": ["schon gefragt", "wie gesagt", "hab ich doch", "habe ich dir doch"],
};

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function checkPlain(text: string, locale: Locale, level: keyof typeof PLAIN_LIMITS = "simple"): { ok: boolean; problems: string[] } {
  const limits = PLAIN_LIMITS[level];
  const problems: string[] = [];
  const sentences = splitSentences(text);
  if (sentences.length > limits.maxSentences) problems.push(`${sentences.length} sentences (max ${limits.maxSentences})`);
  for (const s of sentences) {
    const n = countWords(s);
    if (n > limits.maxWords) problems.push(`${n} words (max ${limits.maxWords}): "${s}"`);
  }
  const lower = text.toLowerCase();
  for (const f of FORBIDDEN[locale]) if (lower.includes(f)) problems.push(`forbidden phrase "${f}"`);
  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: Implement templates.ts**

`packages/shared/src/i18n/templates.ts`:
```ts
import type { Locale } from "../domain/types";
import { joinList } from "./words";

export interface Templates {
  todayIs(dateText: string): string;
  repeatDay(weekday: string): string;
  leaveFor(name: string, time: string): string;
  apptAt(name: string, time: string): string;
  apptUntil(name: string, time: string): string;
  apptTodayYes(name: string): string;
  apptNotToday(name: string, weekday: string): string;
  onDay(weekday: string): string;
  nothingToday(): string;
  nextRoutine(label: string, time: string): string;
  dontKnow(carer: string): string;
  take(items: string[]): string;
  thatsAll(): string;
  leavingOk(): string;
  keysCheck(): string;
  welcomeHome(name: string): string;
  niceTime(): string;
  notYet(): string;
  medDue(names: string): string;
  medIs(description: string): string;
  medTaken(name: string, time: string): string;
  medNextAt(time: string): string;
  medAtAppt(name: string, appointment: string): string;
  medNoneToday(): string;
  medConfirmed(names: string): string;
  medAlreadyTaken(name: string, time: string): string;
  noMoreNow(): string;
  safeAtHome(): string;
  callOffer(carer: string): string;
  callRequested(carer: string): string;
  nightIs(time: string): string;
  nightSafe(): string;
  distressAck(carer: string): string;
  distressFollow(carer: string): string;
  systemError(carer: string): string;
  personIs(name: string, relationship: string): string;
}

const EN: Templates = {
  todayIs: (d) => `Today is ${d}.`,
  repeatDay: (w) => `Today is ${w}.`,
  leaveFor: (n, t) => `You leave for ${n} at ${t}.`,
  apptAt: (n, t) => `${n} starts at ${t}.`,
  apptUntil: (n, t) => `${n} goes until ${t}.`,
  apptTodayYes: (n) => `Yes, ${n} is today.`,
  apptNotToday: (n, w) => `Not today. ${n} is on ${w}.`,
  onDay: (w) => `On ${w}.`,
  nothingToday: () => "Nothing special is planned today.",
  nextRoutine: (l, t) => `Next is ${l}, at ${t}.`,
  dontKnow: (c) => `I don't know that. I'll ask ${c}.`,
  take: (items) => `Take ${joinList(items, "en-US")}.`,
  thatsAll: () => "That's everything.",
  leavingOk: () => "Have a lovely time.",
  keysCheck: () => "Do you have your keys?",
  welcomeHome: (n) => `Welcome home, ${n}.`,
  niceTime: () => "Did you have a nice time?",
  notYet: () => "Not yet.",
  medDue: (n) => `Now it's time for ${n}.`,
  medIs: (d) => `That's ${d}.`,
  medTaken: (n, t) => `Yes. You took ${n} at ${t}.`,
  medNextAt: (t) => `Your next pills are at ${t}.`,
  medAtAppt: (n, a) => `You get ${n} at ${a} today.`,
  medNoneToday: () => "There are no more pills today.",
  medConfirmed: (n) => `Thank you. I've noted ${n}.`,
  medAlreadyTaken: (n, t) => `You took ${n} at ${t}.`,
  noMoreNow: () => "No more pills needed now.",
  safeAtHome: () => "You're safe at home.",
  callOffer: (c) => `Shall I ask ${c} to call you?`,
  callRequested: (c) => `I've asked ${c} to call you.`,
  nightIs: (t) => `It's ${t}, in the middle of the night.`,
  nightSafe: () => "You're safe at home. You can go back to sleep.",
  distressAck: (c) => `I've let ${c} know right away.`,
  distressFollow: (c) => `${c} will get in touch with you.`,
  systemError: (c) => `I can't check right now. ${c} can help.`,
  personIs: (n, r) => `${n} is your ${r}.`,
};

const DE: Templates = {
  todayIs: (d) => `Heute ist ${d}.`,
  repeatDay: (w) => `Heute ist ${w}.`,
  leaveFor: (n, t) => `${n} ist heute. Du gehst um ${t} los.`,
  apptAt: (n, t) => `${n} beginnt um ${t}.`,
  apptUntil: (n, t) => `${n} geht bis ${t}.`,
  apptTodayYes: (n) => `Ja, ${n} ist heute.`,
  apptNotToday: (n, w) => `Heute nicht. ${n} ist am ${w}.`,
  onDay: (w) => `Am ${w}.`,
  nothingToday: () => "Heute ist nichts Besonderes geplant.",
  nextRoutine: (l, t) => `Als Nächstes: ${l}, um ${t}.`,
  dontKnow: (c) => `Das weiß ich nicht. Ich frage ${c}.`,
  take: (items) => `Nimm ${joinList(items, "de-DE")} mit.`,
  thatsAll: () => "Das ist alles.",
  leavingOk: () => "Viel Freude heute.",
  keysCheck: () => "Hast du deinen Schlüssel dabei?",
  welcomeHome: (n) => `Willkommen zu Hause, ${n}.`,
  niceTime: () => "War es schön?",
  notYet: () => "Noch nicht.",
  medDue: (n) => `Jetzt ist Zeit für ${n}.`,
  medIs: (d) => `Das ist ${d}.`,
  medTaken: (n, t) => `Ja. Du hast ${n} um ${t} genommen.`,
  medNextAt: (t) => `Die nächsten Tabletten sind um ${t}.`,
  medAtAppt: (n, a) => `${n} bekommst du heute dort: ${a}.`,
  medNoneToday: () => "Heute sind keine Tabletten mehr dran.",
  medConfirmed: (n) => `Danke. Ich habe ${n} notiert.`,
  medAlreadyTaken: (n, t) => `Du hast ${n} um ${t} genommen.`,
  noMoreNow: () => "Jetzt brauchst du keine mehr.",
  safeAtHome: () => "Du bist sicher zu Hause.",
  callOffer: (c) => `Soll ich ${c} um einen Anruf bitten?`,
  callRequested: (c) => `Ich habe ${c} um einen Anruf gebeten.`,
  nightIs: (t) => `Es ist ${t}, mitten in der Nacht.`,
  nightSafe: () => "Du bist sicher zu Hause. Du kannst weiterschlafen.",
  distressAck: (c) => `Ich habe ${c} sofort Bescheid gegeben.`,
  distressFollow: (c) => `${c} meldet sich bei dir.`,
  systemError: (c) => `Ich kann das gerade nicht nachsehen. ${c} hilft dir.`,
  personIs: (n, r) => `${n} ist ${r}.`,
};

export function templates(locale: Locale): Templates {
  return locale === "de-DE" ? DE : EN;
}
```

- [ ] **Step 5: Add `roseDe()` to the seed**

Append to `packages/shared/src/seed/rose.ts`:
```ts
/** Same fictional Rose, German-speaking — for the language demo and tests */
export function roseDe(): Profile {
  const p = rose();
  return {
    ...p,
    id: "rose-de",
    locale: "de-DE",
    routine: [
      { time: "07:30", label: "Kaffee" },
      { time: "08:00", label: "Frühstück" },
      { time: "12:00", label: "Mittagessen" },
      { time: "15:00", label: "Kaffee und Kuchen" },
      { time: "18:00", label: "Abendbrot" },
      { time: "19:00", label: "Toms Anruf" },
      { time: "21:30", label: "Schlafenszeit" },
    ],
    medications: [
      { id: "morning-pills", name: "deine Morgentabletten", description: "die kleine weiße und die runde rosa Tablette", times: ["08:00"] },
      { id: "noon-pill", name: "deine Mittagstablette", description: "die kleine gelbe", times: ["12:00"], takenAtAppointmentId: "maple-grove" },
      { id: "evening-pill", name: "deine Abendtablette", description: "die weiße Kapsel", times: ["20:00"] },
    ],
    appointments: [{
      ...p.appointments[0]!,
      name: "Tagesgruppe",
      aliases: ["gruppe", "tagesgruppe", "club", "maple grove"],
      checklist: ["deinen Schlüssel am roten Band", "deine Handtasche", "deine Brille", "deinen Mantel"],
    }],
    people: [
      { id: "tom", name: "Tom", relationship: "dein Sohn", contact: "Tom ruft dich jeden Abend um sieben an." },
      { id: "lily", name: "Lily", relationship: "deine Enkelin", contact: "Lily ruft dich sonntags an." },
      { id: "june", name: "June", relationship: "deine Nachbarin", contact: "June wohnt nebenan und hat einen Schlüssel." },
      { id: "frank", name: "Frank", relationship: "dein Mann", notes: "Frank hat dich sehr geliebt." },
    ],
    comfortNotes: [
      "Du bist sicher zu Hause in der Linden Street.",
      "Tom ruft dich jeden Abend um sieben an. Er hat dich lieb.",
      "Du musst nicht mehr zur Arbeit. Du bist in Rente.",
      "June von nebenan hat einen Schlüssel und hilft gern.",
    ],
    lifeStory: [
      "Du warst 38 Jahre lang Bibliothekarin an einer Schule.",
      "Du liebst deinen Rosengarten, besonders die gelbe Kletterrose.",
      "Du magst Frank Sinatra und Ella Fitzgerald.",
      "Du hast Frank 1966 geheiratet.",
      "Dein Apfelkuchen ist der beste in der Straße.",
    ],
  };
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from "./i18n/templates";
export * from "./i18n/plain";
```

- [ ] **Step 6: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS. If a template fails `checkPlain`, shorten the template — never raise the limits.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): plain-language templates en/de, checker, German Rose"
```

---

### Task 6: Encrypted SQLite store + alert sink

**Files:**
- Create: `packages/mcp-server/package.json`, `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/store/crypto.ts`, `packages/mcp-server/src/store/store.ts`, `packages/mcp-server/src/store/sqliteStore.ts`, `packages/mcp-server/src/alerts.ts`
- Test: `packages/mcp-server/test/store.test.ts`

**Interfaces:**
- Consumes: `Profile`, `CareEvent`, `rose()` from `@mia/shared`
- Produces:
  - `interface FieldCipher { encrypt(plain: string): Promise<string>; decrypt(token: string): Promise<string> }`; `class LocalAesCipher implements FieldCipher` (ctor `key: Buffer` 32 bytes); `loadOrCreateLocalKey(path: string): Buffer`
  - `type Severity = "low" | "medium" | "high"`; `interface AlertInput { profileId; rule; severity; message; at }`; `interface StoredAlert extends AlertInput { id: string; state: "open" | "acknowledged" | "resolved" }`
  - `interface Store { getProfile(id); putProfile(p); addEvent(e); eventsSince(profileId, sinceIso); setLastSay(profileId, say); getLastSay(profileId); addAlert(a): Promise<StoredAlert>; listAlerts(profileId) }`
  - `class SqliteStore implements Store` (ctor `path: string, cipher: FieldCipher`; `rawDump(): string` for tests)
  - `interface AlertSink { raise(a: AlertInput): Promise<void> }`; `class StoreAlertSink implements AlertSink` (ctor `store: Store`)

- [ ] **Step 1: Create the package and install dependencies**

`packages/mcp-server/package.json`:
```json
{
  "name": "@mia/mcp-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts"
  }
}
```

`packages/mcp-server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm --filter @mia/mcp-server add @mia/shared@workspace:* @modelcontextprotocol/sdk@1.32.1 zod@4.6.5 hono@4.13.13 @hono/node-server@2.1.3`
Expected: dependencies added, no errors.

- [ ] **Step 2: Write the failing store test**

`packages/mcp-server/test/store.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import { LocalAesCipher, loadOrCreateLocalKey } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";
import { StoreAlertSink } from "../src/alerts";

const newStore = () => new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));

describe("LocalAesCipher", () => {
  it("round-trips and produces different ciphertext each time", async () => {
    const c = new LocalAesCipher(randomBytes(32));
    const a = await c.encrypt("the small white pill");
    const b = await c.encrypt("the small white pill");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(await c.decrypt(a)).toBe("the small white pill");
  });
  it("rejects a wrong key", async () => {
    const token = await new LocalAesCipher(randomBytes(32)).encrypt("secret");
    await expect(new LocalAesCipher(randomBytes(32)).decrypt(token)).rejects.toThrow();
  });
  it("rejects keys that are not 32 bytes", () => {
    expect(() => new LocalAesCipher(randomBytes(16))).toThrow(/32 bytes/);
  });
  it("creates a key file once and reuses it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mia-")), "local.key");
    const k1 = loadOrCreateLocalKey(path);
    expect(loadOrCreateLocalKey(path).equals(k1)).toBe(true);
    expect(k1.length).toBe(32);
  });
});

describe("SqliteStore", () => {
  it("stores and loads a profile", async () => {
    const s = newStore();
    await s.putProfile(rose());
    expect(await s.getProfile("rose")).toEqual(rose());
    expect(await s.getProfile("nobody")).toBeNull();
  });
  it("returns events since an instant, oldest first", async () => {
    const s = newStore();
    await s.addEvent({ profileId: "rose", type: "anxious", at: "2026-10-12T20:00:00Z" });
    await s.addEvent({ profileId: "rose", type: "med_confirmed", at: "2026-10-12T12:05:00Z", detail: { medicationId: "morning-pills", doseTime: "08:00" } });
    await s.addEvent({ profileId: "other", type: "anxious", at: "2026-10-12T21:00:00Z" });
    const events = await s.eventsSince("rose", "2026-10-12T00:00:00Z");
    expect(events.map((e) => e.type)).toEqual(["med_confirmed", "anxious"]);
    expect(events[0]!.detail).toEqual({ medicationId: "morning-pills", doseTime: "08:00" });
  });
  it("remembers the last spoken answer", async () => {
    const s = newStore();
    expect(await s.getLastSay("rose")).toBeNull();
    await s.setLastSay("rose", ["Today is Monday."]);
    expect(await s.getLastSay("rose")).toEqual(["Today is Monday."]);
  });
  it("never stores sensitive text in plaintext", async () => {
    const s = newStore();
    await s.putProfile(rose());
    await s.addEvent({ profileId: "rose", type: "distress", at: "2026-10-12T12:00:00Z", detail: { what: "I fell in the kitchen" } });
    await s.setLastSay("rose", ["You took your morning pills."]);
    await new StoreAlertSink(s).raise({ profileId: "rose", rule: "distress", severity: "high", message: "Rose asked for help", at: "2026-10-12T12:00:00Z" });
    const dump = s.rawDump();
    // only strings of 8+ chars: short ones could appear by chance inside base64 ciphertext
    for (const secret of ["Whitaker", "small white pill", "Linden Street", "I fell in the kitchen", "your morning pills", "Rose asked for help"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("StoreAlertSink", () => {
  it("stores raised alerts as open", async () => {
    const s = newStore();
    await new StoreAlertSink(s).raise({ profileId: "rose", rule: "call_requested", severity: "medium", message: "Rose would like a call.", at: "2026-10-12T15:00:00Z" });
    const alerts = await s.listAlerts("rose");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ rule: "call_requested", severity: "medium", state: "open", message: "Rose would like a call." });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test packages/mcp-server/test/store.test.ts`
Expected: FAIL — cannot resolve `../src/store/crypto`.

- [ ] **Step 4: Implement crypto.ts**

`packages/mcp-server/src/store/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface FieldCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(token: string): Promise<string>;
}

/** AES-256-GCM with a local key file. Local mode only; AWS mode uses KMS (Plan 4). */
export class LocalAesCipher implements FieldCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("LocalAesCipher key must be 32 bytes");
  }

  async encrypt(plain: string): Promise<string> {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
  }

  async decrypt(token: string): Promise<string> {
    if (!token.startsWith("v1:")) throw new Error("Unknown cipher format");
    const raw = Buffer.from(token.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  }
}

export function loadOrCreateLocalKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(path, key.toString("base64"), { mode: 0o600 });
  return key;
}
```

- [ ] **Step 5: Implement store.ts and alerts.ts**

`packages/mcp-server/src/store/store.ts`:
```ts
import type { CareEvent, Profile } from "@mia/shared";

export type Severity = "low" | "medium" | "high";

export interface AlertInput {
  profileId: string;
  rule: string;
  severity: Severity;
  message: string;
  at: string;
}

export interface StoredAlert extends AlertInput {
  id: string;
  state: "open" | "acknowledged" | "resolved";
}

export interface Store {
  getProfile(id: string): Promise<Profile | null>;
  putProfile(p: Profile): Promise<void>;
  addEvent(e: CareEvent): Promise<void>;
  eventsSince(profileId: string, sinceIso: string): Promise<CareEvent[]>;
  setLastSay(profileId: string, say: string[]): Promise<void>;
  getLastSay(profileId: string): Promise<string[] | null>;
  addAlert(a: AlertInput): Promise<StoredAlert>;
  listAlerts(profileId: string): Promise<StoredAlert[]>;
}
```

`packages/mcp-server/src/alerts.ts`:
```ts
import type { AlertInput, Store } from "./store/store";

export interface AlertSink {
  raise(a: AlertInput): Promise<void>;
}

/** Persists alerts as open. Delivery (email/SMS ladder) is added in Plan 3. */
export class StoreAlertSink implements AlertSink {
  constructor(private readonly store: Store) {}
  async raise(a: AlertInput): Promise<void> {
    await this.store.addAlert(a);
  }
}
```

- [ ] **Step 6: Implement sqliteStore.ts**

`packages/mcp-server/src/store/sqliteStore.ts`:
```ts
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { CareEvent, EventType, Profile } from "@mia/shared";
import type { FieldCipher } from "./crypto";
import type { AlertInput, Severity, Store, StoredAlert } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
  type TEXT NOT NULL, at TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS events_by_profile ON events (profile_id, at);
CREATE TABLE IF NOT EXISTS state (
  profile_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (profile_id, key));
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, rule TEXT NOT NULL,
  severity TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL);
`;

type Row = Record<string, string | number | null>;

/** Local-mode store. Everything except ids, types, timestamps and severities is encrypted. */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly cipher: FieldCipher) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  async getProfile(id: string): Promise<Profile | null> {
    const row = this.db.prepare("SELECT data FROM profiles WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.data))) as Profile) : null;
  }

  async putProfile(p: Profile): Promise<void> {
    const data = await this.cipher.encrypt(JSON.stringify(p));
    this.db.prepare("INSERT INTO profiles (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(p.id, data);
  }

  async addEvent(e: CareEvent): Promise<void> {
    const detail = e.detail ? await this.cipher.encrypt(JSON.stringify(e.detail)) : null;
    this.db.prepare("INSERT INTO events (profile_id, type, at, detail) VALUES (?, ?, ?, ?)").run(e.profileId, e.type, e.at, detail);
  }

  async eventsSince(profileId: string, sinceIso: string): Promise<CareEvent[]> {
    const rows = this.db.prepare("SELECT type, at, detail FROM events WHERE profile_id = ? AND at >= ? ORDER BY at, id").all(profileId, sinceIso) as Row[];
    return Promise.all(rows.map(async (r) => ({
      profileId,
      type: String(r.type) as EventType,
      at: String(r.at),
      ...(r.detail ? { detail: JSON.parse(await this.cipher.decrypt(String(r.detail))) as Record<string, string> } : {}),
    })));
  }

  async setLastSay(profileId: string, say: string[]): Promise<void> {
    const value = await this.cipher.encrypt(JSON.stringify(say));
    this.db.prepare("INSERT INTO state (profile_id, key, value) VALUES (?, 'lastSay', ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value").run(profileId, value);
  }

  async getLastSay(profileId: string): Promise<string[] | null> {
    const row = this.db.prepare("SELECT value FROM state WHERE profile_id = ? AND key = 'lastSay'").get(profileId) as Row | undefined;
    return row ? (JSON.parse(await this.cipher.decrypt(String(row.value))) as string[]) : null;
  }

  async addAlert(a: AlertInput): Promise<StoredAlert> {
    const stored: StoredAlert = { ...a, id: randomUUID(), state: "open" };
    this.db.prepare("INSERT INTO alerts (id, profile_id, rule, severity, state, at, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(stored.id, a.profileId, a.rule, a.severity, stored.state, a.at, await this.cipher.encrypt(a.message));
    return stored;
  }

  async listAlerts(profileId: string): Promise<StoredAlert[]> {
    const rows = this.db.prepare("SELECT * FROM alerts WHERE profile_id = ? ORDER BY at").all(profileId) as Row[];
    return Promise.all(rows.map(async (r) => ({
      id: String(r.id), profileId, rule: String(r.rule), severity: String(r.severity) as Severity,
      state: String(r.state) as StoredAlert["state"], at: String(r.at),
      message: await this.cipher.decrypt(String(r.message)),
    })));
  }

  /** Test helper: every stored value as one string, to prove nothing sensitive is in plaintext. */
  rawDump(): string {
    return ["profiles", "events", "state", "alerts"]
      .map((t) => JSON.stringify(this.db.prepare(`SELECT * FROM ${t}`).all()))
      .join("\n");
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS. If Vitest cannot resolve `node:sqlite`, add `server: { deps: { external: [/^node:/] } }` under `test` in `vitest.config.ts` and re-run.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-server pnpm-lock.yaml vitest.config.ts
git commit -m "feat(mcp-server): AES-GCM field encryption, SQLite store, alert sink"
```

---

### Task 7: Tool runtime + orientation tools

**Files:**
- Create: `packages/mcp-server/src/tools/runtime.ts`, `packages/mcp-server/src/tools/orientation.ts`, `packages/mcp-server/src/server.ts`
- Create: `packages/mcp-server/test/helpers.ts`
- Test: `packages/mcp-server/test/orientation.test.ts`

**Interfaces:**
- Consumes: `Store`, `AlertSink`, `StoreAlertSink`, `SqliteStore`, `LocalAesCipher`; from `@mia/shared`: `todayView`, `nextAppointment`, `localParts`, `toMinutes`, `templates`, `timeWords`, `dateWords`, `weekdayName`, `partOfDay`, `rose`, `roseDe`
- Produces:
  - `interface ToolContext { store: Store; profileId: string; now: () => Date; alerts: AlertSink }`
  - `interface MiaResult { facts: Record<string, unknown>; say: string[]; verbatim: boolean; text?: string }`
  - `OUTPUT_SHAPE` (zod raw shape), `VERBATIM_GUIDANCE`, `CHAT_GUIDANCE`
  - `run(ctx, fn: (p: Profile, events: CareEvent[]) => Promise<MiaResult>, opts?: { remember?: boolean }): Promise<CallToolResult>`
  - `logEvent(ctx, type: EventType, detail?: Record<string, string>): Promise<void>`
  - `appointmentLine(a: Appointment, nowMinutes: number, locale: Locale): string`
  - `registerOrientationTools(server: McpServer, ctx: ToolContext): void`
  - `createMiaServer(ctx: ToolContext): McpServer`
  - test helper `connect(now: Date, profile?: Profile)` → `{ client, store, setNow(d), call(name, args?) }` where `call` returns `{ say: string[]; facts: any; verbatim: boolean; text: string }`

- [ ] **Step 1: Write the test helper**

`packages/mcp-server/test/helpers.ts`:
```ts
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { rose, type Profile } from "@mia/shared";
import { StoreAlertSink } from "../src/alerts";
import { createMiaServer } from "../src/server";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";

export interface ToolReply { say: string[]; facts: any; verbatim: boolean; text: string }

export async function connect(now: Date, profile: Profile = rose()) {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  await store.putProfile(profile);
  let clock = now;
  const server = createMiaServer({ store, profileId: profile.id, now: () => clock, alerts: new StoreAlertSink(store) });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mia-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    store,
    setNow: (d: Date) => { clock = d; },
    call: async (name: string, args: Record<string, unknown> = {}): Promise<ToolReply> => {
      const r = await client.callTool({ name, arguments: args });
      const sc = r.structuredContent as Omit<ToolReply, "text">;
      return { ...sc, text: (r.content as { type: string; text: string }[])[0]!.text };
    },
  };
}
```

- [ ] **Step 2: Write the failing orientation test**

`packages/mcp-server/test/orientation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

describe("get_today", () => {
  it("Monday 08:05: date, leave time for the group, day repeated", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("get_today");
    expect(r.say).toEqual([
      "Today is Monday, October 12.",
      "You leave for Maple Grove Day Club at twenty to ten.",
      "Today is Monday.",
    ]);
    expect(r.verbatim).toBe(true);
    expect(r.text).toBe(r.say.join(" "));
    expect((await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type)).toEqual(["orientation_asked"]);
  });
  it("Monday 11:00 during the group: says until when", async () => {
    const r = await (await connect(at("2026-10-12T11:00:00"))).call("get_today");
    expect(r.say[1]).toBe("Maple Grove Day Club goes until two o'clock.");
  });
  it("Wednesday 15:10: next routine item", async () => {
    const r = await (await connect(at("2026-10-14T15:10:00"))).call("get_today");
    expect(r.say[1]).toBe("Next is supper, at six o'clock in the evening.");
  });
  it("Wednesday 22:00: nothing planned", async () => {
    const r = await (await connect(at("2026-10-14T22:00:00"))).call("get_today");
    expect(r.say[1]).toBe("Nothing special is planned today.");
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_today");
    expect(r.say).toEqual([
      "Heute ist Montag, der 12. Oktober.",
      "Tagesgruppe ist heute. Du gehst um zwanzig vor zehn los.",
      "Heute ist Montag.",
    ]);
  });
});

describe("get_next_appointment", () => {
  it("Wednesday: not today, Thursday", async () => {
    const r = await (await connect(at("2026-10-14T10:00:00"))).call("get_next_appointment", { name: "my group" });
    expect(r.say).toEqual(["Not today. Maple Grove Day Club is on Thursday.", "On Thursday."]);
  });
  it("Monday 08:05: yes, today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("get_next_appointment", { name: "group" });
    expect(r.say).toEqual(["Yes, Maple Grove Day Club is today.", "You leave for Maple Grove Day Club at twenty to ten."]);
  });
  it("unknown appointment: don't know, logs the question", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("get_next_appointment", { name: "dentist" });
    expect(r.say).toEqual(["I don't know that. I'll ask Tom."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "unknown_question", detail: { topic: "appointment", query: "dentist" } });
  });
});

describe("get_preparation_steps", () => {
  it("two items at a time, then that's everything", async () => {
    const m = await connect(at("2026-10-12T09:00:00"));
    const first = await m.call("get_preparation_steps");
    expect(first.say).toEqual(["Take your keys on the red lanyard and your handbag."]);
    expect(first.facts).toMatchObject({ nextStep: 1, hasMore: true });
    expect((await m.call("get_preparation_steps", { step: 1 })).say).toEqual(["Take your glasses and your coat."]);
    expect((await m.call("get_preparation_steps", { step: 2 })).say).toEqual(["That's everything."]);
  });
  it("nothing planned today", async () => {
    const r = await (await connect(at("2026-10-14T09:00:00"))).call("get_preparation_steps");
    expect(r.say).toEqual(["Nothing special is planned today."]);
  });
});

describe("night_reassurance", () => {
  it("03:10: middle of the night, safe, logs night_awake", async () => {
    const m = await connect(at("2026-10-13T03:10:00"));
    const r = await m.call("night_reassurance");
    expect(r.say).toEqual(["It's ten past three, in the middle of the night.", "You're safe at home. You can go back to sleep."]);
    expect((await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type)).toEqual(["night_awake"]);
  });
  it("during the day it answers like get_today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("night_reassurance");
    expect(r.say[0]).toBe("Today is Monday, October 12.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test packages/mcp-server/test/orientation.test.ts`
Expected: FAIL — cannot resolve `../src/server`.

- [ ] **Step 4: Implement runtime.ts**

`packages/mcp-server/src/tools/runtime.ts`:
```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { templates, timeWords, toMinutes, type Appointment, type CareEvent, type EventType, type Locale, type Profile } from "@mia/shared";
import type { AlertSink } from "../alerts";
import type { Store } from "../store/store";

export interface ToolContext {
  store: Store;
  profileId: string;
  now: () => Date;
  alerts: AlertSink;
}

export interface MiaResult {
  facts: Record<string, unknown>;
  say: string[];
  verbatim: boolean;
  /** text content when `say` is empty (non-verbatim tools) */
  text?: string;
}

export const VERBATIM_GUIDANCE =
  "Speak the 'say' sentences exactly as written, in this order. You may add one short warm lead-in of at most five words. " +
  "Do not add facts. No medical advice. Never mention that a question was asked before.";

export const CHAT_GUIDANCE =
  "Have a warm, simple conversation about the suggested topic. Use short sentences of at most twelve words. " +
  "Ask one easy yes/no question at a time. Never correct her. End by offering to ask the carer to call.";

export const OUTPUT_SHAPE = {
  facts: z.record(z.string(), z.unknown()),
  say: z.array(z.string()),
  verbatim: z.boolean(),
  guidance: z.string(),
};

const LOOKBACK_MS = 36 * 3600 * 1000;

export async function logEvent(ctx: ToolContext, type: EventType, detail?: Record<string, string>): Promise<void> {
  await ctx.store.addEvent({ profileId: ctx.profileId, type, at: ctx.now().toISOString(), ...(detail ? { detail } : {}) });
}

function toResult(r: MiaResult): CallToolResult {
  return {
    content: [{ type: "text", text: r.say.length ? r.say.join(" ") : (r.text ?? "") }],
    structuredContent: { facts: r.facts, say: r.say, verbatim: r.verbatim, guidance: r.verbatim ? VERBATIM_GUIDANCE : CHAT_GUIDANCE },
  };
}

export async function run(
  ctx: ToolContext,
  fn: (p: Profile, events: CareEvent[]) => Promise<MiaResult>,
  opts: { remember?: boolean } = {},
): Promise<CallToolResult> {
  let profile: Profile | null = null;
  try {
    profile = await ctx.store.getProfile(ctx.profileId);
    if (!profile) throw new Error(`profile ${ctx.profileId} not found`);
    const since = new Date(ctx.now().getTime() - LOOKBACK_MS).toISOString();
    const result = await fn(profile, await ctx.store.eventsSince(ctx.profileId, since));
    if (opts.remember !== false && result.say.length) await ctx.store.setLastSay(ctx.profileId, result.say);
    return toResult(result);
  } catch (err) {
    console.error("[mia] tool failed:", err);
    const T = templates(profile?.locale ?? "en-US");
    return toResult({ facts: { error: "unavailable" }, say: [T.systemError(profile?.carerName ?? "Your family")], verbatim: true });
  }
}

/** One sentence about an appointment today, depending on the time. */
export function appointmentLine(a: Appointment, nowMinutes: number, locale: Locale): string {
  const T = templates(locale);
  if (a.travelMode === "alone" && a.leaveBy && nowMinutes < toMinutes(a.leaveBy)) return T.leaveFor(a.name, timeWords(a.leaveBy, locale));
  if (nowMinutes < toMinutes(a.start)) return T.apptAt(a.name, timeWords(a.start, locale));
  return T.apptUntil(a.name, timeWords(a.end, locale));
}
```

- [ ] **Step 5: Implement orientation.ts**

`packages/mcp-server/src/tools/orientation.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  dateWords, localParts, nextAppointment, partOfDay, templates, timeWords, todayView, toMinutes, weekdayName,
  type Profile,
} from "@mia/shared";
import { appointmentLine, logEvent, OUTPUT_SHAPE, run, type MiaResult, type ToolContext } from "./runtime";

export async function todayResult(ctx: ToolContext, p: Profile): Promise<MiaResult> {
  const T = templates(p.locale);
  const v = todayView(p, ctx.now());
  const say = [T.todayIs(dateWords(v.date, v.weekday, p.locale))];
  const current = v.appointments.find((a) => toMinutes(a.end) > v.minutes);
  if (current) say.push(appointmentLine(current, v.minutes, p.locale));
  else if (v.nextRoutine) say.push(T.nextRoutine(v.nextRoutine.label, timeWords(v.nextRoutine.time, p.locale, { withPart: true })));
  else say.push(T.nothingToday());
  say.push(T.repeatDay(weekdayName(v.weekday, p.locale)));
  await logEvent(ctx, "orientation_asked");
  return {
    facts: { date: v.date, weekday: v.weekday, time: v.time, partOfDay: v.partOfDay, appointments: v.appointments.map((a) => a.name), nextRoutine: v.nextRoutine ?? null },
    say,
    verbatim: true,
  };
}

export function registerOrientationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("get_today", {
    title: "What day is it, what happens today",
    description:
      "Use whenever she asks what day or date it is, what time of day it is, what is happening today, or seems unsure about the day. " +
      "Examples: 'What day is it?', 'Is it Sunday?', 'What am I doing today?', 'Welcher Tag ist heute?', 'Was ist heute los?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async () => run(ctx, (p) => todayResult(ctx, p)));

  server.registerTool("get_next_appointment", {
    title: "When is my group / next appointment",
    description:
      "Use when she asks whether an appointment is today or when it is next — especially her group. Pass her words as 'name'. " +
      "Examples: 'Is it group today?', 'When is my club?', 'Ist heute Gruppe?', 'Wann ist die Tagesgruppe?'.",
    inputSchema: { name: z.string().optional().describe("Her words for the appointment, e.g. 'group'") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ name }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const now = ctx.now();
    const n = nextAppointment(p, now, name);
    if (!n) {
      await logEvent(ctx, "unknown_question", { topic: "appointment", query: name ?? "" });
      return { facts: { found: false }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "orientation_asked", { appointmentId: n.appointment.id });
    const facts = { found: true, name: n.appointment.name, date: n.date, weekday: n.weekday, daysAway: n.daysAway, travelMode: n.appointment.travelMode };
    if (n.daysAway === 0) {
      const minutes = localParts(now, p.timezone).minutes;
      return { facts, say: [T.apptTodayYes(n.appointment.name), appointmentLine(n.appointment, minutes, p.locale)], verbatim: true };
    }
    const day = weekdayName(n.weekday, p.locale);
    return { facts, say: [T.apptNotToday(n.appointment.name, day), T.onDay(day)], verbatim: true };
  }));

  server.registerTool("get_preparation_steps", {
    title: "What do I need to take",
    description:
      "Use when she asks what to bring or take for today's appointment, or says 'and then?' while getting ready. " +
      "Returns two items at a time; call again with step = facts.nextStep for more. Examples: 'What do I need?', 'Was muss ich mitnehmen?'.",
    inputSchema: { step: z.number().int().min(0).optional().describe("0 for the first items, then facts.nextStep") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: true },
  }, async ({ step }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const n = nextAppointment(p, ctx.now());
    if (!n || n.daysAway !== 0) return { facts: { hasMore: false }, say: [T.nothingToday()], verbatim: true };
    const s = step ?? 0;
    const items = n.appointment.checklist.slice(s * 2, s * 2 + 2);
    if (!items.length) return { facts: { hasMore: false }, say: [T.thatsAll()], verbatim: true };
    const hasMore = n.appointment.checklist.length > s * 2 + 2;
    return { facts: { appointment: n.appointment.name, items, nextStep: s + 1, hasMore }, say: [T.take(items)], verbatim: true };
  }));

  server.registerTool("night_reassurance", {
    title: "Reassurance at night",
    description:
      "Use when she is awake at night, confused about the time, or thinks she must get up or go to work. " +
      "Examples: 'Is it morning?', 'Do I have to go to work?', 'Ist es schon Morgen?', 'Muss ich zur Arbeit?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const l = localParts(ctx.now(), p.timezone);
    if (partOfDay(l.minutes) !== "night") return todayResult(ctx, p);
    const T = templates(p.locale);
    await logEvent(ctx, "night_awake");
    return { facts: { time: l.time, night: true }, say: [T.nightIs(timeWords(l.time, p.locale)), T.nightSafe()], verbatim: true };
  }));
}
```

- [ ] **Step 6: Implement server.ts (orientation only for now)**

`packages/mcp-server/src/server.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrientationTools } from "./tools/orientation";
import type { ToolContext } from "./tools/runtime";

export const SERVER_INSTRUCTIONS =
  "Mia is a care companion for a person living with dementia who lives alone. " +
  "Always use Mia's tools for anything about the day, appointments, medication, people, going out, coming home, feelings, the night, or help. " +
  "Never answer these from general knowledge. Speak the tool's 'say' sentences as written. Keep everything short, calm and kind.";

export function createMiaServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "mia", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerOrientationTools(server, ctx);
  return server;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): tool runtime and orientation tools"
```

---

### Task 8: Medication tools

**Files:**
- Create: `packages/mcp-server/src/tools/medication.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Test: `packages/mcp-server/test/medication.test.ts`

**Interfaces:**
- Consumes: `run`, `logEvent`, `OUTPUT_SHAPE`, `ToolContext` (Task 7); `doseStatuses`, `templates`, `timeWords`, `joinList` from `@mia/shared`
- Produces: `registerMedicationTools(server, ctx): void` — tools `get_medication_status`, `confirm_medication`

- [ ] **Step 1: Write the failing test**

`packages/mcp-server/test/medication.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const types = async (m: Awaited<ReturnType<typeof connect>>) =>
  (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).map((e) => e.type);

describe("get_medication_status", () => {
  it("Monday 08:05, nothing taken: not yet, morning pills, description", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Not yet.", "Now it's time for your morning pills.", "That's the small white pill and the round pink one."]);
  });
  it("after confirming: yes with time, next pills with part of day", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T09:30:00"));
    const r = await m.call("get_medication_status");
    expect(r.say).toEqual(["Yes. You took your morning pills at five past eight.", "Your next pills are at eight o'clock in the evening."]);
  });
  it("Monday 06:00: next pills in the morning", async () => {
    const r = await (await connect(at("2026-10-12T06:00:00"))).call("get_medication_status");
    expect(r.say).toEqual(["Your next pills are at eight o'clock in the morning."]);
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"), roseDe())).call("get_medication_status");
    expect(r.say).toEqual(["Noch nicht.", "Jetzt ist Zeit für deine Morgentabletten.", "Das ist die kleine weiße und die runde rosa Tablette."]);
  });
});

describe("confirm_medication", () => {
  it("logs due doses", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Thank you. I've noted your morning pills."]);
    const events = await m.store.eventsSince("rose", "2026-10-01T00:00:00Z");
    expect(events.at(-1)).toMatchObject({ type: "med_confirmed", detail: { medicationId: "morning-pills", doseTime: "08:00" } });
  });
  it("blocks a second dose kindly and logs the attempt", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T08:07:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["You took your morning pills at five past eight.", "No more pills needed now."]);
    expect(await types(m)).toEqual(["med_confirmed", "med_duplicate_attempt"]);
  });
  it("too early: not yet, next time, logs not-due attempt", async () => {
    const m = await connect(at("2026-10-12T06:00:00"));
    const r = await m.call("confirm_medication");
    expect(r.say).toEqual(["Not yet.", "Your next pills are at eight o'clock in the morning."]);
    expect(await types(m)).toEqual(["med_not_due_attempt"]);
  });
  it("noon pill on a group day is given at the group", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    await m.call("confirm_medication");
    m.setNow(at("2026-10-12T21:00:00"));
    await m.call("confirm_medication");
    const r = await m.call("get_medication_status");
    expect(r.say[1]).toBe("There are no more pills today.");
  });
});
```

Note: the last test also confirms the evening pill at 21:00 (due since 19:30), then expects "no more pills today" — the noon pill was `at_appointment`, not due.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/mcp-server/test/medication.test.ts`
Expected: FAIL — tool `get_medication_status` not found.

- [ ] **Step 3: Implement medication.ts**

`packages/mcp-server/src/tools/medication.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { doseStatuses, joinList, templates, timeWords, type DoseStatus, type Profile } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type MiaResult, type ToolContext } from "./runtime";

const names = (doses: DoseStatus[], p: Profile) => joinList([...new Set(doses.map((d) => d.name))], p.locale);

function split(s: DoseStatus[]) {
  return {
    due: s.filter((d) => d.state === "due"),
    taken: s.filter((d) => d.state === "taken"),
    upcoming: s.filter((d) => d.state === "upcoming"),
    atAppointment: s.filter((d) => d.state === "at_appointment"),
  };
}

const facts = (s: DoseStatus[]) => ({ doses: s.map(({ medicationId, name, time, state, takenAt }) => ({ medicationId, name, time, state, takenAt: takenAt ?? null })) });

export function registerMedicationTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("get_medication_status", {
    title: "Did I take my pills",
    description:
      "Use whenever she asks about her pills or medication: whether she took them, which ones, or when the next ones are. " +
      "Answers only from the family's plan and the log — never give medical advice. " +
      "Examples: 'Did I take my pills?', 'Which pill now?', 'Habe ich meine Tabletten genommen?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p, events): Promise<MiaResult> => {
    const T = templates(p.locale);
    const s = doseStatuses(p, events, ctx.now());
    const { due, taken, upcoming, atAppointment } = split(s);
    await logEvent(ctx, "med_asked");
    let say: string[];
    if (due.length) {
      say = [T.notYet(), T.medDue(names(due, p)), T.medIs(joinList(due.map((d) => d.description), p.locale))];
    } else if (taken.length) {
      const last = taken.at(-1)!;
      say = [
        T.medTaken(last.name, timeWords(last.takenAt!, p.locale)),
        upcoming[0] ? T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true })) : T.medNoneToday(),
      ];
    } else if (upcoming[0]) {
      say = [T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true }))];
    } else if (atAppointment[0]) {
      say = [T.medAtAppt(atAppointment[0].name, atAppointment[0].appointmentName!)];
    } else {
      say = [T.medNoneToday()];
    }
    return { facts: facts(s), say, verbatim: true };
  }));

  server.registerTool("confirm_medication", {
    title: "I took my pills",
    description:
      "Use when she says she has taken her pills or medication. Records the doses that are due now. " +
      "If they were already taken, it kindly tells her so to prevent a double dose. " +
      "Examples: 'I took my pills.', 'Done, I had them.', 'Ich habe meine Tabletten genommen.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async () => run(ctx, async (p, events): Promise<MiaResult> => {
    const T = templates(p.locale);
    const s = doseStatuses(p, events, ctx.now());
    const { due, taken, upcoming } = split(s);
    if (due.length) {
      for (const d of due) await logEvent(ctx, "med_confirmed", { medicationId: d.medicationId, doseTime: d.time });
      return { facts: { confirmed: due.map((d) => d.medicationId) }, say: [T.medConfirmed(names(due, p))], verbatim: true };
    }
    if (taken.length) {
      const last = taken.at(-1)!;
      await logEvent(ctx, "med_duplicate_attempt", { medicationId: last.medicationId, doseTime: last.time });
      return { facts: { duplicate: true, medicationId: last.medicationId }, say: [T.medAlreadyTaken(last.name, timeWords(last.takenAt!, p.locale)), T.noMoreNow()], verbatim: true };
    }
    if (upcoming[0]) {
      await logEvent(ctx, "med_not_due_attempt", { medicationId: upcoming[0].medicationId, doseTime: upcoming[0].time });
      return { facts: { notDue: true }, say: [T.notYet(), T.medNextAt(timeWords(upcoming[0].time, p.locale, { withPart: true }))], verbatim: true };
    }
    return { facts: {}, say: [T.medNoneToday()], verbatim: true };
  }));
}
```

- [ ] **Step 4: Register in server.ts**

In `packages/mcp-server/src/server.ts`, add the import and the call:
```ts
import { registerMedicationTools } from "./tools/medication";
```
```ts
  registerOrientationTools(server, ctx);
  registerMedicationTools(server, ctx);
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): medication status and confirmation with double-dose guard"
```

---

### Task 9: Outings, comfort, people, problem and repeat tools

**Files:**
- Create: `packages/mcp-server/src/tools/outings.ts`, `comfort.ts`, `people.ts`, `problem.ts`, `repeat.ts` (all in `packages/mcp-server/src/tools/`)
- Modify: `packages/mcp-server/src/server.ts`
- Test: `packages/mcp-server/test/care.test.ts`

**Interfaces:**
- Consumes: `run`, `logEvent`, `OUTPUT_SHAPE`, `ToolContext`, `todayResult` (Task 7); `templates`, `todayView`, `toMinutes`, `localParts`
- Produces: `registerOutingTools`, `registerComfortTools`, `registerPeopleTools`, `registerProblemTools`, `registerRepeatTools` — each `(server: McpServer, ctx: ToolContext) => void`. Tools: `report_leaving`, `report_home`, `comfort_me`, `chat_about_life`, `request_call`, `who_is`, `report_problem`, `repeat_last`

- [ ] **Step 1: Write the failing test**

`packages/mcp-server/test/care.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const lastEvent = async (m: Awaited<ReturnType<typeof connect>>) =>
  (await m.store.eventsSince("rose", "2026-10-01T00:00:00Z")).at(-1);

describe("outings", () => {
  it("leaving for the group: lovely time, keys, logs appointment", async () => {
    const m = await connect(at("2026-10-12T09:38:00"));
    const r = await m.call("report_leaving");
    expect(r.say).toEqual(["Have a lovely time.", "Do you have your keys?"]);
    expect(await lastEvent(m)).toMatchObject({ type: "left_home", detail: { appointmentId: "maple-grove" } });
  });
  it("coming home: welcome by name", async () => {
    const m = await connect(at("2026-10-12T14:25:00"));
    const r = await m.call("report_home");
    expect(r.say).toEqual(["Welcome home, Rose.", "Did you have a nice time?"]);
    expect((await lastEvent(m))?.type).toBe("arrived_home");
  });
});

describe("comfort", () => {
  it("comfort_me: first comfort note, call offer, logs anxious", async () => {
    const m = await connect(at("2026-10-12T16:30:00"));
    const r = await m.call("comfort_me");
    expect(r.say).toEqual(["You're safe at home on Linden Street.", "Shall I ask Tom to call you?"]);
    expect((await lastEvent(m))?.type).toBe("anxious");
  });
  it("request_call: confirms and raises a medium alert", async () => {
    const m = await connect(at("2026-10-12T16:31:00"));
    const r = await m.call("request_call");
    expect(r.say).toEqual(["I've asked Tom to call you."]);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "call_requested", severity: "medium", message: "Rose would like a call." }]);
  });
  it("chat_about_life: not verbatim, suggests a life-story topic", async () => {
    const m = await connect(at("2026-10-14T15:00:00"));
    const r = await m.call("chat_about_life");
    expect(r.verbatim).toBe(false);
    expect(r.say).toEqual([]);
    expect(r.facts.topics).toHaveLength(6);
    expect(r.facts.topics).toContain(r.facts.suggestedTopic);
    expect(r.text).toContain(r.facts.suggestedTopic);
    expect((await lastEvent(m))?.type).toBe("lonely");
  });
});

describe("who_is", () => {
  it.each(["Tom", "my son", "who is tom?"])("finds Tom from %s", async (name) => {
    const r = await (await connect(at("2026-10-12T10:00:00"))).call("who_is", { name });
    expect(r.say).toEqual(["Tom is your son.", "Tom calls you every evening at seven."]);
  });
  it("uses notes when there is no contact", async () => {
    const r = await (await connect(at("2026-10-12T10:00:00"))).call("who_is", { name: "Frank" });
    expect(r.say).toEqual(["Frank is your husband.", "Frank loved you very much."]);
  });
  it("German relationship includes the possessive", async () => {
    const r = await (await connect(at("2026-10-12T10:00:00"), roseDe())).call("who_is", { name: "mein Sohn" });
    expect(r.say[0]).toBe("Tom ist dein Sohn.");
  });
  it("unknown person: don't know, logs question", async () => {
    const m = await connect(at("2026-10-12T10:00:00"));
    expect((await m.call("who_is", { name: "Peter" })).say).toEqual(["I don't know that. I'll ask Tom."]);
    expect(await lastEvent(m)).toMatchObject({ type: "unknown_question", detail: { topic: "person", query: "Peter" } });
  });
});

describe("report_problem", () => {
  it("raises a high alert immediately and reassures", async () => {
    const m = await connect(at("2026-10-12T11:00:00"));
    const r = await m.call("report_problem", { what: "I fell" });
    expect(r.say).toEqual(["I've let Tom know right away.", "Tom will get in touch with you."]);
    expect(await m.store.listAlerts("rose")).toMatchObject([{ rule: "distress", severity: "high", message: 'Rose asked for help: "I fell".' }]);
    expect((await lastEvent(m))?.type).toBe("distress");
  });
});

describe("repeat_last", () => {
  it("repeats the last answer verbatim and asks to slow down", async () => {
    const m = await connect(at("2026-10-12T08:05:00"));
    const first = await m.call("get_today");
    const again = await m.call("repeat_last");
    expect(again.say).toEqual(first.say);
    expect(again.facts.slower).toBe(true);
    const twice = await m.call("repeat_last");
    expect(twice.say).toEqual(first.say);
  });
  it("with nothing to repeat, gives today", async () => {
    const r = await (await connect(at("2026-10-12T08:05:00"))).call("repeat_last");
    expect(r.say[0]).toBe("Today is Monday, October 12.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/mcp-server/test/care.test.ts`
Expected: FAIL — tool `report_leaving` not found.

- [ ] **Step 3: Implement outings.ts**

`packages/mcp-server/src/tools/outings.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { templates, todayView, toMinutes } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerOutingTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("report_leaving", {
    title: "I'm going out",
    description:
      "Use when she says she is leaving the house or going to her group. Records that she left so the family knows when to expect her back. " +
      "Examples: 'I'm going to my group now.', 'I'm off.', 'Ich gehe jetzt los.', 'Ich gehe zur Gruppe.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    const v = todayView(p, ctx.now());
    const appt = v.appointments.find((a) => toMinutes(a.end) > v.minutes);
    await logEvent(ctx, "left_home", appt ? { appointmentId: appt.id } : undefined);
    return { facts: { appointment: appt?.name ?? null, expectedReturn: appt?.expectedReturn ?? null }, say: [T.leavingOk(), T.keysCheck()], verbatim: true };
  }));

  server.registerTool("report_home", {
    title: "I'm home",
    description:
      "Use when she says she is back home. Examples: 'I'm home.', 'I'm back.', 'Ich bin wieder da.', 'Ich bin zu Hause.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "arrived_home");
    return { facts: {}, say: [T.welcomeHome(p.preferredName), T.niceTime()], verbatim: true };
  }));
}
```

- [ ] **Step 4: Implement comfort.ts**

`packages/mcp-server/src/tools/comfort.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { localParts, templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerComfortTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("comfort_me", {
    title: "I'm scared / I feel strange",
    description:
      "Use when she sounds anxious, scared, confused, sad or says she feels strange or wants to go home. " +
      "Gives the family's own comforting words and offers to ask the carer to call. " +
      "Examples: 'I'm scared.', 'Something is wrong.', 'I want to go home.', 'Ich habe Angst.', 'Mir ist komisch.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "anxious");
    return {
      facts: { comfortNotes: p.comfortNotes },
      say: [p.comfortNotes[0] ?? T.safeAtHome(), T.callOffer(p.carerName)],
      verbatim: true,
    };
  }));

  server.registerTool("request_call", {
    title: "Please ask my family to call",
    description:
      "Use when she says yes to a call offer, or asks for her son, daughter or family to call her. Notifies the carer. " +
      "Examples: 'Yes, please.', 'I want to talk to Tom.', 'Can Tom call me?', 'Ja, bitte.', 'Tom soll mich anrufen.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "call_requested");
    await ctx.alerts.raise({ profileId: p.id, rule: "call_requested", severity: "medium", message: `${p.preferredName} would like a call.`, at: ctx.now().toISOString() });
    return { facts: {}, say: [T.callRequested(p.carerName)], verbatim: true };
  }));

  server.registerTool("chat_about_life", {
    title: "Talk with me",
    description:
      "Use when she is lonely, bored, or wants to talk. Returns topics from her own life story to chat about warmly. " +
      "Examples: 'I'm lonely.', 'Tell me something.', 'Talk to me.', 'Mir ist langweilig.', 'Erzähl mir was.'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    await logEvent(ctx, "lonely");
    const dayIndex = Math.floor(Date.parse(`${localParts(ctx.now(), p.timezone).date}T00:00:00Z`) / 86_400_000);
    const suggestedTopic = p.lifeStory[dayIndex % p.lifeStory.length] ?? "";
    return {
      facts: { topics: p.lifeStory, suggestedTopic, carerName: p.carerName },
      say: [],
      verbatim: false,
      text: `Suggested topic: ${suggestedTopic}`,
    };
  }));
}
```

- [ ] **Step 5: Implement people.ts, problem.ts, repeat.ts**

`packages/mcp-server/src/tools/people.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates, type Person } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function findPerson(people: Person[], query: string): Person | undefined {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return people.find((x) => words.includes(x.name.toLowerCase()) || words.includes(x.relationship.toLowerCase().split(" ").at(-1)!));
}

export function registerPeopleTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("who_is", {
    title: "Who is this person",
    description:
      "Use when she asks who someone is, or about her son, granddaughter, neighbor or husband. Pass her words as 'name'. " +
      "Examples: 'Who is Tom?', 'Where is my son?', 'Wer ist Lily?', 'Wo ist mein Mann?'.",
    inputSchema: { name: z.string().describe("The name or relationship she said, e.g. 'Tom' or 'my son'") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ name }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const person = findPerson(p.people, name);
    if (!person) {
      await logEvent(ctx, "unknown_question", { topic: "person", query: name });
      return { facts: { found: false }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "person_asked", { personId: person.id });
    const second = person.contact ?? person.notes;
    return {
      facts: { found: true, name: person.name, relationship: person.relationship },
      say: [T.personIs(person.name, person.relationship), ...(second ? [second] : [])],
      verbatim: true,
    };
  }));
}
```

`packages/mcp-server/src/tools/problem.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerProblemTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("report_problem", {
    title: "Help — something is wrong",
    description:
      "ALWAYS use immediately when she asks for help, says she fell, is hurt, in pain, cannot get up, feels very unwell, or is lost. " +
      "Alerts the family at once. Do not ask follow-up questions first. " +
      "Examples: 'Help!', 'I fell.', 'It hurts.', 'I can't get up.', 'Hilfe!', 'Ich bin gestürzt.', 'Mir tut es weh.'.",
    inputSchema: { what: z.string().optional().describe("Her own words about what happened") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ what }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    await logEvent(ctx, "distress", what ? { what } : undefined);
    await ctx.alerts.raise({
      profileId: p.id, rule: "distress", severity: "high",
      message: `${p.preferredName} asked for help${what ? `: "${what}"` : ""}.`,
      at: ctx.now().toISOString(),
    });
    return { facts: { alerted: true }, say: [T.distressAck(p.carerName), T.distressFollow(p.carerName)], verbatim: true };
  }));
}
```

`packages/mcp-server/src/tools/repeat.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { todayResult } from "./orientation";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function registerRepeatTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("repeat_last", {
    title: "Say that again",
    description:
      "Use when she did not hear or understand and asks to repeat. Repeats the last answer word for word, slower. " +
      "Examples: 'Pardon?', 'What?', 'Say that again.', 'Wie bitte?', 'Was hast du gesagt?'.",
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async () => run(ctx, async (p) => {
    const last = await ctx.store.getLastSay(ctx.profileId);
    await logEvent(ctx, "repeat_asked");
    if (!last) return todayResult(ctx, p);
    return { facts: { slower: true }, say: last, verbatim: true };
  }, { remember: false }));
}
```

- [ ] **Step 6: Register all tools in server.ts**

Replace `packages/mcp-server/src/server.ts` with:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComfortTools } from "./tools/comfort";
import { registerMedicationTools } from "./tools/medication";
import { registerOrientationTools } from "./tools/orientation";
import { registerOutingTools } from "./tools/outings";
import { registerPeopleTools } from "./tools/people";
import { registerProblemTools } from "./tools/problem";
import { registerRepeatTools } from "./tools/repeat";
import type { ToolContext } from "./tools/runtime";

export const SERVER_INSTRUCTIONS =
  "Mia is a care companion for a person living with dementia who lives alone. " +
  "Always use Mia's tools for anything about the day, appointments, medication, people, going out, coming home, feelings, the night, or help. " +
  "Never answer these from general knowledge. Speak the tool's 'say' sentences as written. Keep everything short, calm and kind.";

export function createMiaServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "mia", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerOrientationTools(server, ctx);
  registerMedicationTools(server, ctx);
  registerOutingTools(server, ctx);
  registerComfortTools(server, ctx);
  registerPeopleTools(server, ctx);
  registerProblemTools(server, ctx);
  registerRepeatTools(server, ctx);
  return server;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp-server): outings, comfort, people, distress and repeat tools"
```

---

### Task 10: HTTP endpoint, local entry point, protocol compatibility

**Files:**
- Create: `packages/mcp-server/src/http.ts`, `packages/mcp-server/src/main.ts`, `.env.example`
- Test: `packages/mcp-server/test/http.test.ts`

**Interfaces:**
- Consumes: `createMiaServer`, `ToolContext`, `SqliteStore`, `LocalAesCipher`, `loadOrCreateLocalKey`, `StoreAlertSink`, `rose`, `roseDe`
- Produces: `interface HttpDeps { tokens: Map<string, string>; makeContext(profileId: string): ToolContext }`; `createHttpApp(deps: HttpDeps): Hono` with routes `GET /health`, `ALL /mcp`

- [ ] **Step 1: Write the failing test**

`packages/mcp-server/test/http.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { rose } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { StoreAlertSink } from "../src/alerts";
import { createHttpApp } from "../src/http";
import { LocalAesCipher } from "../src/store/crypto";
import { SqliteStore } from "../src/store/sqliteStore";

const TOKEN = "test-token-123";
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
  const store = new SqliteStore(":memory:", new LocalAesCipher(randomBytes(32)));
  await store.putProfile(rose());
  app = createHttpApp({
    tokens: new Map([[TOKEN, "rose"]]),
    makeContext: (profileId) => ({ store, profileId, now: () => at("2026-10-12T08:05:00"), alerts: new StoreAlertSink(store) }),
  });
});

const initialize = (protocolVersion: string, auth = `Bearer ${TOKEN}`) =>
  app.request("/mcp", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" } } }),
  });

describe("HTTP /mcp", () => {
  it("health check", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });
  it("rejects requests without a valid bearer token", async () => {
    const r = await initialize("2025-03-26", "Bearer wrong");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });
  it.each(["2025-03-26", "2025-11-25"])("negotiates protocol %s (Alexa+ uses 2025-03-26)", async (version) => {
    const r = await initialize(version);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe(version);
    expect(body.result.serverInfo.name).toBe("mia");
  });
  it("serves all 14 tools to a real MCP client over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("http://mia.test/mcp"), {
      fetch: async (url, init) => app.request(url.toString(), init),
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "chat_about_life", "comfort_me", "confirm_medication", "get_medication_status", "get_next_appointment",
      "get_preparation_steps", "get_today", "night_reassurance", "repeat_last", "report_home", "report_leaving",
      "report_problem", "request_call", "who_is",
    ]);
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(60);
    const r = await client.callTool({ name: "get_today", arguments: {} });
    expect((r.content as { text: string }[])[0]!.text).toContain("Today is Monday, October 12.");
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/mcp-server/test/http.test.ts`
Expected: FAIL — cannot resolve `../src/http`.

- [ ] **Step 3: Implement http.ts**

`packages/mcp-server/src/http.ts`:
```ts
import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMiaServer } from "./server";
import type { ToolContext } from "./tools/runtime";

export interface HttpDeps {
  /** bearer token → profile id. Local mode only; OAuth 2.1 replaces this in Plan 4. */
  tokens: Map<string, string>;
  makeContext(profileId: string): ToolContext;
}

function profileFor(tokens: Map<string, string>, header: string | undefined): string | null {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  for (const [token, profileId] of tokens) {
    const expected = Buffer.from(token);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return profileId;
  }
  return null;
}

export function createHttpApp(deps: HttpDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.all("/mcp", async (c) => {
    const profileId = profileFor(deps.tokens, c.req.header("authorization"));
    if (!profileId) return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="mia"' });
    // Stateless: one server + transport per request (Alexa+ keeps no MCP session).
    const server = createMiaServer(deps.makeContext(profileId));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
```

- [ ] **Step 4: Implement main.ts and .env.example**

`packages/mcp-server/src/main.ts`:
```ts
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { rose, roseDe } from "@mia/shared";
import { StoreAlertSink } from "./alerts";
import { createHttpApp } from "./http";
import { LocalAesCipher, loadOrCreateLocalKey } from "./store/crypto";
import { SqliteStore } from "./store/sqliteStore";

const root = resolve(import.meta.dirname, "../../..");
try { process.loadEnvFile(join(root, ".env")); } catch { /* no .env: rely on the environment */ }

const token = process.env.MIA_DEV_TOKEN;
if (!token || token.length < 24) throw new Error("Set MIA_DEV_TOKEN (≥ 24 chars) in .env — see .env.example");

const dataDir = resolve(root, process.env.MIA_DATA_DIR ?? ".mia-data");
mkdirSync(dataDir, { recursive: true });
const store = new SqliteStore(join(dataDir, "mia.db"), new LocalAesCipher(loadOrCreateLocalKey(join(dataDir, "local.key"))));

const profileId = process.env.MIA_PROFILE ?? "rose";
if (!(await store.getProfile(profileId))) await store.putProfile(profileId === "rose-de" ? roseDe() : rose());

const app = createHttpApp({
  tokens: new Map([[token, profileId]]),
  makeContext: (id) => ({ store, profileId: id, now: () => new Date(), alerts: new StoreAlertSink(store) }),
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`[mia] LOCAL MODE — not production. MCP endpoint: http://127.0.0.1:${port}/mcp (profile: ${profileId})`);
```

`.env.example`:
```
# Local mode only. Copy to .env and change the token.
MIA_DEV_TOKEN=replace-with-a-long-random-string-of-24-plus-chars
# rose (English) or rose-de (German)
MIA_PROFILE=rose
PORT=8787
MIA_DATA_DIR=.mia-data
```

- [ ] **Step 5: Run tests**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 6: Run the server and check it by hand**

Run:
```bash
cp .env.example .env
sed -i '' "s/^MIA_DEV_TOKEN=.*/MIA_DEV_TOKEN=$(openssl rand -hex 24)/" .env
pnpm dev:mcp
```
Expected: `[mia] LOCAL MODE — not production. MCP endpoint: http://127.0.0.1:8787/mcp (profile: rose)`

In a second terminal:
```bash
TOKEN=$(grep MIA_DEV_TOKEN .env | cut -d= -f2)
curl -s -X POST http://127.0.0.1:8787/mcp -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_today","arguments":{}}}'
```
Expected: JSON with `"say":["Today is …` for the current New York date.

Then: `npx @modelcontextprotocol/inspector` → transport "Streamable HTTP", URL `http://127.0.0.1:8787/mcp`, header `Authorization: Bearer <token>` → list tools (14) and call `get_medication_status`. Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server .env.example
git commit -m "feat(mcp-server): Streamable HTTP endpoint, dev token auth, local entry point"
```

---

### Task 11: Plain-language sweep, README, graph update

**Files:**
- Test: `packages/mcp-server/test/plain-sweep.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `connect` helper, `checkPlain`, `rose`, `roseDe`

- [ ] **Step 1: Write the sweep test**

`packages/mcp-server/test/plain-sweep.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkPlain, rose, roseDe, type Profile } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { connect } from "./helpers";

const SCRIPT: [string, string, Record<string, unknown>?][] = [
  ["2026-10-12T06:00:00", "get_medication_status"],
  ["2026-10-12T06:00:00", "confirm_medication"],
  ["2026-10-12T08:05:00", "get_today"],
  ["2026-10-12T08:05:00", "get_medication_status"],
  ["2026-10-12T08:05:00", "confirm_medication"],
  ["2026-10-12T08:07:00", "confirm_medication"],
  ["2026-10-12T08:10:00", "get_next_appointment", { name: "group" }],
  ["2026-10-12T09:00:00", "get_preparation_steps"],
  ["2026-10-12T09:00:00", "get_preparation_steps", { step: 1 }],
  ["2026-10-12T09:38:00", "report_leaving"],
  ["2026-10-12T11:00:00", "get_today"],
  ["2026-10-12T14:25:00", "report_home"],
  ["2026-10-12T16:30:00", "comfort_me"],
  ["2026-10-12T16:31:00", "request_call"],
  ["2026-10-12T17:00:00", "who_is", { name: "Tom" }],
  ["2026-10-12T17:00:00", "who_is", { name: "Peter" }],
  ["2026-10-12T21:00:00", "confirm_medication"],
  ["2026-10-12T21:00:00", "get_medication_status"],
  ["2026-10-13T03:10:00", "night_reassurance"],
  ["2026-10-13T03:11:00", "repeat_last"],
  ["2026-10-14T10:00:00", "get_next_appointment", { name: "group" }],
  ["2026-10-14T15:10:00", "get_today"],
  ["2026-10-14T15:20:00", "report_problem", { what: "I fell" }],
];

describe.each([["en", rose()], ["de", roseDe()]] as [string, Profile][])("plain-language sweep (%s)", (_, profile) => {
  it("every spoken answer in a full day passes the plain-language rules", async () => {
    const m = await connect(at(SCRIPT[0]![0]), profile);
    for (const [time, tool, args] of SCRIPT) {
      m.setNow(at(time));
      const r = await m.call(tool, args ?? {});
      if (!r.verbatim) continue;
      expect(r.say.length, `${tool} @ ${time}`).toBeGreaterThan(0);
      expect(checkPlain(r.say.join(" "), profile.locale), `${tool} @ ${time}: ${r.say.join(" ")}`).toMatchObject({ ok: true });
    }
  });
});
```

- [ ] **Step 2: Run the sweep**

Run: `pnpm test packages/mcp-server/test/plain-sweep.test.ts`
Expected: PASS for en and de. If an answer fails, fix the template or the seed text (shorter), never the limits.

- [ ] **Step 3: Update README**

Replace `README.md` with:
```markdown
# Mia — Memory & Care Companion for Alexa+

An Alexa+ MCP add-on that helps people living with dementia at home — medication, orientation, sleep, anxiety, loneliness — with a secure carer side and alarm escalation.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track). Demo persona: **Rose Whitaker**, fictional ([docs/persona/rose.md](docs/persona/rose.md)).

## Run locally (no AWS needed)

Requires Node 24 and pnpm 10.

    pnpm install
    cp .env.example .env        # then set MIA_DEV_TOKEN to a long random string
    pnpm dev:mcp                # MCP endpoint on http://127.0.0.1:8787/mcp

Connect any MCP client (e.g. `npx @modelcontextprotocol/inspector`) with Streamable HTTP and header `Authorization: Bearer <MIA_DEV_TOKEN>`.

Local mode stores data in SQLite under `.mia-data/`, encrypted with a generated AES-256-GCM key. It is **not** production; AWS mode (DynamoDB + KMS, OAuth 2.1) follows.

## Tests

    pnpm test
    pnpm typecheck

## Docs

- Design: [docs/superpowers/specs/2026-10-06-mia-design.md](docs/superpowers/specs/2026-10-06-mia-design.md)
- Research: [docs/research/2026-10-06-practical-implementation.md](docs/research/2026-10-06-practical-implementation.md)
- Roadmap: [docs/superpowers/plans/2026-10-07-mia-roadmap.md](docs/superpowers/plans/2026-10-07-mia-roadmap.md)
```

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm typecheck`
Expected: all tests PASS, typecheck exit 0.

Run: `graphify update .`
Expected: graph updated (project rule after code changes).

- [ ] **Step 5: Commit**

```bash
git add packages README.md $(test -d graphify-out && echo graphify-out)
git commit -m "test: plain-language sweep en/de; docs: local run instructions"
```

---

## Spec coverage (Plan 1 scope)

| Spec section | Covered by |
|---|---|
| §2 principles 1–6 (no learning, family truth, same answer, simple, no medical advice) | Tasks 5, 7–9, 11 |
| §5.1 stack, MCP SDK v1, protocol 2025-03-26 + 2025-11-25 | Tasks 1, 6, 10 |
| §5.2 tool latency (no LLM, one store read) | Task 7 `run()` |
| §5.3 local mode (SQLite + AES key, banner) | Tasks 6, 10 |
| §6 all 13 tools + `request_call` | Tasks 7–9 |
| §7 data model incl. speech settings, events, alerts | Tasks 1, 2, 6 |
| §8 speaking rules 1, 2, 4–6, 8, 11 + verbatim templates | Tasks 4, 5, 11 |
| §13 encryption at rest, no transcripts | Task 6 |
| §14 en-US + de-DE | Tasks 4, 5, 7–9, 11 |
| §15 store unavailable fallback, unknown → dontKnow + event | Tasks 7, 9 |

**Deferred to later plans (by design):** proactive prompts, nameless routing, verbatim check in voice layer, distress keyword guard (Plan 2); alarm rules + ladder + carer page (Plan 3); OAuth 2.1, DynamoDB/KMS, AWS services (Plan 4); calibration, `very_simple` templates, test bench (Plan 5).
