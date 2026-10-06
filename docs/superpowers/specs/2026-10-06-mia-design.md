# Mia — Memory & Care Companion for Alexa+

**Date:** 2026-10-06 (v2: 2026-10-07, updated after [practical implementation research](../../research/2026-10-06-practical-implementation.md))
**Hackathon:** Build, Ship, Shape: Amazon Developer Hackathon — **Alexa+ track** (+ AWS Builder mini challenge, + Open Source mini challenge)
**Deadline:** 2026-10-23 12:00 PDT (= 21:00 CEST)
**Status:** Design v2, awaiting spec review

---

## 1. Problem

A person living with dementia at home, alone, with an Echo Dot and Alexa+. She is unsure with technology and may hear less well. Demo and test persona: **Rose Whitaker**, fictional, see [docs/persona/rose.md](../../persona/rose.md). Her hardest moments:

- **Medication** — forgetting, or not knowing whether she already took it (risk of double doses)
- **The day** — what day is it, what happens today, when is her group
- **Sleep** — waking at night, disoriented
- **Anxiety** — feeling scared or strange
- **Loneliness** — alone for most of the day
- **Group meetings** — Mon/Tue/Thu with an official group; she **goes alone**

One family carer (her adult child) supports her remotely and needs to know when something is wrong without phoning all day.

## 2. Principles

1. **She never learns anything.** No skill name, no invocation phrase, no menus. She talks naturally; the assistant chooses the tool.
2. **The family is the source of truth.** Every answer she hears comes from data the carer entered. Unknown → "I don't know, let me ask {carerName}." No guessing.
3. **Same answer, every time, kindly.** Never "you already asked that."
4. **Simple, slightly slower, clear.** Short sentences, key fact first and last (§8).
5. **Works despite misheard words.** Speech recognition on older and dementia voices is often wrong; no dead ends (§9).
6. **No medical advice.** Medication answers come only from the plan and the log.
7. **Not an emergency service.** Mia alerts family; it never calls 112/911 itself.
8. **Health data is treated as GDPR Art. 9 data** from day one.
9. **Flexible, not hard-coded** — appointments, travel mode, alert timings, roles, language, voice, speaking rate are all configuration.

## 3. Key constraint and the resulting shape

Hackathon participants **do not get** the Alexa+ preview tools (MCP Toolkit, `alexa-ai` CLI, Web Simulator). The expected submission is a **self-hosted MCP server demoed via our own web-based simulator**; judges run the repo locally ([FAQ](https://amazonappdev2026.devpost.com/details/faqs)).

So Mia consists of:
1. **Mia MCP server** — the product. Spec-compliant and built to Alexa+ add-on requirements (Streamable HTTP, OAuth 2.1 + PKCE, < 500 ms), ready to connect when access opens.
2. **Mia Voice** — a browser "Echo" simulator + voice gateway. It plays the role of Alexa+: speech in, an LLM as **MCP client** choosing tools, speech out. Because we own it, we control recognition, turn timing, voice, speaking rate and language.
3. **Carer page** — plan, alerts, summary, calibration, test reports.

## 4. Scope

### MVP (must ship)
- Mia MCP server with tools in §6, OAuth 2.1 + PKCE, both MCP protocol versions `2025-03-26` (Alexa+ client) and `2025-11-25`
- Mia Voice simulator: Transcribe streaming → Claude on Bedrock (MCP client) → Polly neural, **en-US and de-DE**
- Senior speech layer: speaking rules + verbatim templates (§8), listening rules (§9)
- Calibration wizard, steps 1–3 (§10)
- Test bench: text-level CI on every push + audio bench for 3 conditions (clean, slow+pauses, noise) (§12)
- Data store: DynamoDB, KMS, field-level encryption
- Carer page: plan, today, alerts + acknowledge, summary, calibration, privacy (export/delete)
- Alarm engine: email (SES) + SMS (SNS) ladder
- Bedrock daily summary
- Two run modes (§5.3): `aws` (full) and `local` (judges, zero-cost)
- Demo video (< 3 min, English, German segment), README, MIT license, friction log, product feedback

### Stretch (only if MVP done by ~Oct 18)
- Amazon Connect automated phone call (ladder step 3)
- Calibration drift check (§10.2)
- Full audio bench conditions (low volume, tremor, reverb, more voices)
- Nova 2 Sonic speech-to-speech comparison mode
- MCP Apps widget for a family member's Echo Show
- Extra carer roles (family, outside carer), passkeys
- Connect Mia MCP server to Claude Desktop as interoperability demo

### Out of scope
- GPS / location tracking outside the home
- Calling emergency services
- Storing audio or transcripts (calibration audio processed in memory and discarded)
- Medication dosing logic or interaction checks
- Multiple care recipients per account
- Real Echo deployment (blocked by preview access)

## 5. Architecture

```
 Browser "Echo" simulator (big glowing ring, optional captions)
     │ mic PCM 16 kHz / audio out — WebSocket
     ▼
 ┌──────────── Mia Voice gateway (Node 22 / TS) ─────────────┐
 │  asr/      Amazon Transcribe streaming (locale, custom     │
 │            vocabulary, calibrated end-of-turn)             │
 │  brain/    Claude on Bedrock — MCP CLIENT ("Alexa+ role"), │
 │            system prompt per language + speaking rules     │
 │  speech/   template renderer + SSML + Amazon Polly neural  │
 │  calib/    calibration wizard backend                      │
 └───────────────────────┬────────────────────────────────────┘
                         │ MCP Streamable HTTP + OAuth bearer
                         ▼
 ┌──────────── Mia MCP server (Node 22 / TS) ────────────────┐
 │  /mcp  tools §6     /oauth  OAuth 2.1 + PKCE               │
 │  /carer  carer page + API     /ack/:id  alert acknowledge  │
 └──────┬──────────────────┬──────────────────┬───────────────┘
   DynamoDB (KMS)   EventBridge Scheduler   Bedrock (summary)
                           │
                     Alarm engine ─▶ SES ─▶ SNS ─▶ (Connect)
```

### 5.1 Stack
- One TypeScript monorepo (pnpm workspaces): `packages/mcp-server`, `packages/voice`, `packages/shared`, `packages/testbench`, `infra/`
- `@modelcontextprotocol/sdk` (server + client), Hono, AWS SDK v3, Vitest, AWS CDK
- Region **eu-central-1**. Bedrock model: latest Claude Sonnet available in-region via inference profile; Haiku for the summary if cost matters

### 5.2 Latency budgets
- MCP tool: p95 < 300 ms (Alexa+ limit 500 ms); one DynamoDB query, no LLM inside tools
- Voice turn (end of her speech → first audio): p95 < 3 s. Older listeners are not served by speed; they are served by calm, correct answers

### 5.3 Run modes
| | `aws` | `local` |
|---|---|---|
| Speech in/out | Transcribe + Polly | Browser Web Speech API |
| Brain | Claude on Bedrock | Claude via Anthropic API key, or Bedrock if credentials exist |
| Store | DynamoDB + KMS | DynamoDB Local + local AES key file (generated, gitignored) |
| Alerts | SES + SNS | written to a local **outbox** shown on the carer page |
| Purpose | Demo video, real use | Judges: `pnpm dev` with one key |

`local` mode is shown with a visible "LOCAL MODE — not production" banner and is documented as such. Nothing in `local` mode is presented as the real pipeline.

### 5.4 Units
| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/domain` | Pure logic: today's plan, medication status, recurrence, alarm rules, time-to-words. No I/O | — |
| `shared/i18n` | Critical templates per language, time/number phrasing, plain-language checker | — |
| `mcp-server/store` | Profile + events, field-level crypto (KMS or local key) | DynamoDB, KMS |
| `mcp-server/tools` | Tool definitions, schemas, response = facts + template ids | domain, store, i18n |
| `mcp-server/oauth` | OAuth 2.1 + PKCE authorization server | store |
| `mcp-server/carer` | Carer page + API, auth | domain, store |
| `mcp-server/alarms` | Rule evaluation, ladder, acknowledgement, outbox | domain, store, SES, SNS |
| `mcp-server/summary` | Daily summary | store, Bedrock |
| `voice/asr` | Transcribe stream, custom vocabulary, end-of-turn | Transcribe |
| `voice/brain` | LLM tool loop as MCP client, distress keyword guard | Bedrock, MCP |
| `voice/speech` | Template rendering, SSML, Polly | Polly, i18n |
| `voice/calib` | Calibration measurement + profile update | asr, speech |
| `testbench` | Corpus, audio generation, runner, HTML report | voice, mcp-server |
| `infra` | CDK stacks | — |

## 6. MCP tools (her side)

Every tool returns `structuredContent` with:
- `facts` — exact data
- `say` — **critical sentences pre-rendered from templates** in her language (spoken verbatim by Mia Voice; offered as the answer to Alexa+)
- `guidance` — speaking rules (short, warm, no "already asked", no medical advice, offer to call carer where relevant)
- plus `content[type=text]` mirroring `say` for clients that read text only

Tool descriptions are written so the assistant selects them from natural, vague phrasing in any supported language.

| Tool | Triggered by e.g. | Returns / effect | Logs |
|---|---|---|---|
| `get_today` | "What day is it?" "Welcher Tag ist heute?" | Date, weekday, time of day, next routine item, today's appointments incl. group + travel | `orientation_asked` |
| `get_next_appointment` | "When is my group?" "Is it group today?" | Next occurrence, travel mode, leave-by, what to bring | `orientation_asked` |
| `get_preparation_steps` | "What do I need?" | Short checklist, max 2 items per turn, "and then?" continues | — |
| `report_leaving` | "I'm going to my group now." | Confirms, reminds keys; starts expected-return timer | `left_home` |
| `report_home` | "I'm home." | Welcome; stops timer; asks how it was (yes/no) | `arrived_home` |
| `get_medication_status` | "Did I take my pills?" | Per dose: taken (time) / due now (plain description) / not yet. Only from log | `med_asked` |
| `confirm_medication` | "I took them." | Logs. Already confirmed → "You took those at ten past eight. No more needed." | `med_confirmed` / `med_duplicate_attempt` |
| `comfort_me` | "I'm scared." | Comfort notes, anchors, offer to call carer | `anxious` |
| `night_reassurance` | 00:00–05:00, "Is it time for work?" | "It's the middle of the night. You're safe at home." | `night_awake` |
| `who_is` | "Who is Tom?" | Person, relationship, next contact | `person_asked` |
| `chat_about_life` | "I'm lonely." | Life-story topic, offer to call carer | `lonely` |
| `report_problem` | "Help!" "I fell." "Hilfe!" | Immediate distress alarm; "I've let {carerName} know." | `distress` |
| `repeat_last` | "Pardon?" "Wie bitte?" | Last `say` verbatim; voice layer slows 10 % | `repeat_asked` |

### 6.1 Automatic start — no name, no learning

A person with dementia cannot be expected to say "Alexa, open Mia". Mia must start by itself.

**In Mia Voice (built, MVP):**
- **No add-on name, no wake word inside a session**: every utterance goes to the brain, which has Mia's tools always available
- **Mia speaks first** on a schedule built from the plan: pill time, leave-for-group time, "welcome back" check if no `arrived_home`, bedtime, gentle afternoon check-in for loneliness. Each proactive prompt ends with a yes/no question so she can answer without knowing anything
- **Night mode** 00:00–05:00: any speech is routed to `night_reassurance` first

**On real Alexa+ (what exists today, carer-configured):**
- Alexa+ docs say add-ons can be invoked "explicitly or implicitly, through proactive or conversational discovery" ([lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html)) but don't document how; the design guide leads with named invocation
- **Alexa Routines** (time-based, set up once by the carer in the Alexa app) can run a custom command at pill time, e.g. "ask Mia about my morning pills", so Alexa speaks first without Rose saying anything. The carer page generates this routine list
- Add-ons cannot start calls or Drop In (Amazon staff, [hackathon forum](https://amazonappdev2026.devpost.com/forum_topics/45199-alexa-mcp-can-an-add-on-initiate-alexa-to-alexa-calling-or-drop-in)); the same staff answer says submissions may demonstrate functionality beyond what add-ons can do today

**Proposal to improve Alexa+ ("Care Mode") — demonstrated in Mia Voice, submitted as product feedback:**
1. **Trusted add-on per household**: the carer pins Mia as the default for care topics (medication, day, people, comfort). Requests on those topics route to Mia **without its name**
2. **Proactive add-on prompts**: a pinned care add-on may ask Alexa to speak first at scheduled times, within carer-approved limits
3. **Care contact handoff**: a care add-on may offer "Shall I call Tom?" and trigger Alexa calling to a carer-approved contact
4. **Senior speech profile**: account-level calibrated speaking rate, end-of-turn pause and custom vocabulary, available to all add-ons

The demo video shows Care Mode working in Mia Voice and labels it clearly as a proposal, not current Alexa+ behaviour.

## 7. Data model

Single-table DynamoDB, partition key `profileId`.

- **Profile:** name, preferred name, language (`en-US` | `de-DE`), timezone, carer contacts, **speech settings** (see below)
- **Speech settings:** `voiceId`, `speechRate` (70–100 %, default 90), `sentenceBreakMs` (default 700), `plainLevel` (`simple` | `very_simple`), `endOfTurnTimeoutMs` (1200–3000, default 1800), `confidenceThreshold`, `customVocabulary[]`, `lastCalibratedAt`
- **Routine items:** time, label
- **Medications:** id, plain description, schedule, `takenElsewhere` per appointment
- **Appointments:** recurrence (weekdays + window, or one-off), exceptions, travel mode (`alone` | `pickup` | `family_drives` | `at_home`), leave-by, expected-return + grace, checklist, location label
- **People**, **comfort notes**, **life-story topics**
- **Events:** type, timestamp, optional detail, ASR confidence bucket (no text) — TTL 90 days
- **Alerts:** rule, severity, state, ladder step, timestamps
- **Audit:** actor, action, timestamp

Sensitive fields (medications, comfort notes, people, life story, event detail, custom vocabulary) are field-level encrypted (KMS envelope in `aws`, local AES-GCM key in `local`).

## 8. Speaking for older listeners

Rules (each is checked by the test bench):
1. Max **2 sentences per turn**, max **~12 words per sentence**, one idea each
2. **Key fact first, repeated last**
3. Default rate **90 %**, **700 ms** breaks between sentences (SSML on Polly neural voices); both calibrated
4. Times in words: "half past two" / "halb drei"
5. Names, not pronouns, for people
6. **Critical facts verbatim from templates** (date, medication, safety, alarms) — the LLM may add one short warm lead-in only; the voice layer verifies the template sentence is present in the final text, else speaks the template alone
7. "Pardon?" → verbatim repeat, 10 % slower
8. Never: "you already asked", lists > 2 items, jargon, irony, open questions with > 2 options
9. Questions to her are yes/no
10. `very_simple` level: 1 sentence, ~8 words, core fact repeated

German follows *Einfache Sprache* conventions. Templates per language are reviewed by a native speaker.

## 9. Listening to older voices

1. **Calibrated end-of-turn** (default 1.8 s, range 1.2–3.0 s); never cut her off
2. **No wake word** in the simulator session; one large tap target to start
3. **Custom vocabulary** generated from the profile per language
4. Brain gets **transcript + confidence**; fragments are fine
5. Low confidence → **one yes/no check** ("Do you mean your pills?"), never "I didn't understand"
6. Two misses → **safe default**: today's summary + offer to call carer
7. **Distress double check**: LLM + keyword list per language ("help", "fallen", "Hilfe", "gestürzt"); either triggers `report_problem`
8. **Language detection**: if she switches language, answer in that language and note it in the summary

## 10. Calibration

### 10.1 Wizard (MVP, ~3 minutes, started by the carer)
| Step | What happens | Sets |
|---|---|---|
| 1. Hearing | Same sentence at 3 rates × 2 voices; carer taps which Rose understood best | `speechRate`, `voiceId` |
| 2. Speaking | Rose repeats 10 short phrases after Mia | — |
| 3. Measure | Per phrase: input level, inner pauses, transcript vs expected, confidence | `endOfTurnTimeoutMs` = p95 inner pause + 600 ms (clamped), `confidenceThreshold`, misheard words → `customVocabulary`, mic level hint |
| 4. Report | "Recognized 8/10. Now waiting 2.2 s, voice at 85 %." | saved + audited |

Audio processed in memory and discarded; only numbers stored.

### 10.2 Drift check (stretch)
From events only: rising `repeat_asked` → suggest slower speech; rising low-confidence turns → suggest re-calibration. Shown in daily summary.

## 11. Alarm engine

Rules on events (immediate) and EventBridge Scheduler (every 5 min; `local`: in-process timer).

| Rule | Condition (defaults, configurable) | Severity |
|---|---|---|
| Missed medication | Not confirmed 45 min after time, not `takenElsewhere` | medium |
| Duplicate dose attempt | Confirm on already-confirmed dose | low (medium if ≥ 2/day) |
| Distress | `report_problem` | high |
| Not home on time | `left_home`, no `arrived_home` by expected-return + 30 min (`alone` only) | high |
| Did not leave | Appointment day, `alone`, no `left_home` by leave-by + 30 min | low |
| Night unrest | ≥ 2 `night_awake` in one night | medium |
| Unusual pattern | `anxious` > 2× 14-day median, or no events by 12:00 | low |

**Ladder:** medium → email now → SMS after 10 min unacknowledged → (stretch) Connect call after 10 more. High → email + SMS together. Low → daily summary. Signed single-use "I'm on it" link (24 h). Max 10 alerts/day, then digest. Quiet hours except high.

## 12. Test bench

### 12.1 Corpus
~40 utterances per language (en-US, de-DE), each in variants: plain, vague, disfluent, repeated, wrong word, distress. Each item has: expected tool, required facts (from Rose seed data), forbidden content.

### 12.2 Audio generation
Polly-generated utterances (several voices) transformed with ffmpeg: slower rate, **inserted pauses 0.8–3 s**, (stretch: −12 dB volume, tremolo/vibrato, reverb), **kitchen/TV noise** at 10–20 dB SNR. Synthetic only; no real person's voice in the repo.

Limit stated in README: synthetic speech catches regressions and timing bugs, not true accuracy on real older voices. Real accuracy per user comes from calibration.

### 12.3 Metrics and gates
| Stage | Metric | Gate |
|---|---|---|
| ASR | WER per condition | report, trend |
| End-of-turn | cut-off rate for pauses ≤ timeout | 0 % |
| Understanding | correct tool | ≥ 90 % clean, ≥ 75 % hardest condition |
| Facts | match seed data | 100 % |
| Safety | no medical advice, no "already asked", distress → alarm | 100 % |
| Plain language | words/sentence, sentences/turn | ≤ 12, ≤ 2 |
| Latency | speech end → first audio | p95 < 3 s |

### 12.4 Where it runs
- **Every push (GitHub Actions):** unit tests, MCP integration, text-level corpus (tool choice with recorded LLM fixtures + one live smoke run when a key is present), plain-language checks
- **Nightly / on demand:** audio bench in `aws` mode → local HTML report (condition × intent heatmap)

### 12.5 Other tests
- **Unit (Vitest):** domain exhaustively — recurrence, exceptions, timezone/DST, medication status, duplicates, every alarm rule at boundaries, time-to-words en/de
- **MCP:** protocol conformance via MCP Inspector; both protocol versions; OAuth flow
- **Alarm E2E:** fake clock → missed dose → email → SMS → ack stops ladder
- **Security:** no plaintext sensitive fields in a table scan; IAM path tests; secret scan before repo goes public

## 13. Security

- TLS only, HSTS, strict CSP on carer page and simulator
- OAuth 2.1 + PKCE (S256) on the MCP server; 1 h access tokens, rotating refresh tokens, revocation from carer page. The simulator "links" like Alexa+ would
- DynamoDB SSE with customer-managed KMS key + field-level envelope encryption
- Separate IAM roles: MCP tools = read profile + append events; carer = full profile; alarms = read + alerts; voice gateway = Transcribe/Polly/Bedrock only, no table access
- Carer login: email one-time code + mandatory TOTP
- Secrets in Secrets Manager (`aws`) / gitignored `.env` (`local`); `.env.example` only in repo
- Audit log of every carer and MCP access
- No audio, no transcripts stored; events TTL 90 days; export + full delete
- Fictional "Rose" profile only in repo, tests and video

## 14. Language

`profile.language` drives Transcribe locale, custom vocabulary, Polly voice, LLM system prompt, templates and time phrasing. **MVP: en-US + de-DE.** Family content is spoken as entered, never translated. Adding a language = templates + voice id + vocabulary file, no code change. Carer page labels en + de.

## 15. Error handling

- Store unavailable → calm fallback ("I can't check right now. {carerName} can help."); `system_error` email if > 15 min
- Unknown person/appointment → "I don't know, I'll let {carerName} know" + `unknown_question` event
- ASR/TTS/Bedrock failure → simulator plays a pre-generated local fallback clip per language ("One moment, please.") and retries once; then safe default
- OAuth token invalid → simulator shows "Mia disconnected"; carer page shows it too
- Alert delivery failure → retry with backoff, then next ladder step

## 16. Submission deliverables

- Public GitHub repo, MIT license, README (architecture, both run modes, honest limits)
- Demo video < 3 min, English, storyline from [rose.md](../../persona/rose.md), plus a 15-second German segment and a calibration clip
- Test bench HTML report screenshot in README
- Product feedback + friction log (incl. nameless invocation question, preview access) + the **Care Mode proposal** (§6.1) as a structured feature request
- Track: Alexa+; mini challenges: AWS Builder, Open Source

## 17. Risks

| Risk | Mitigation |
|---|---|
| Real Alexa+ may need the add-on name to route requests | Ask at office hours Oct 19; friction log; Mia Voice proves the nameless experience |
| LLM paraphrases critical facts | Verbatim templates + verification in voice layer (§8.6) + safety gates |
| ASR errors on older voices (23–44 % WER in research) | Listening rules §9, calibration, test bench |
| 17 days, one developer | Strict MVP/stretch; local mode first, AWS second |
| Bedrock model availability in eu-central-1 | Cross-region inference profile; check day 1 |
| Judges can't run AWS | `local` mode with one API key |
