# Mia — Memory & Care Companion for Alexa+

**Date:** 2026-10-06
**Hackathon:** Build, Ship, Shape: Amazon Developer Hackathon — **Alexa+ track** (+ AWS Builder mini challenge, + Open Source mini challenge)
**Deadline:** 2026-10-23 12:00 PDT (= 21:00 CEST)
**Status:** Design approved in brainstorming, awaiting spec review

---

## 1. Problem

A person living with dementia at home, alone, with an Echo Dot and Alexa+. She is unsure with technology. Demo and test persona: **Rose Whitaker**, fictional, see [docs/persona/rose.md](../../persona/rose.md). Her hardest moments:

- **Medication** — forgetting, or not knowing whether she already took it (risk of double doses)
- **The day** — what day is it, what happens today, when is her group
- **Sleep** — waking at night, disoriented
- **Anxiety** — feeling scared or strange
- **Loneliness** — alone for most of the day
- **Group meetings** — Mon/Tue/Thu with an official group; she **goes alone**

One family carer (her adult child) supports her remotely and needs to know when something is wrong without phoning all day.

## 2. Principles

1. **She never learns anything.** No skill name, no invocation phrase, no menus, no screen. She talks naturally; Alexa+ chooses the tool.
2. **The family is the source of truth.** Every answer she hears comes from data the carer entered. Unknown → "I don't know, let me ask {carerName}." No guessing.
3. **Same answer, every time, kindly.** Never "you already asked that."
4. **No medical advice.** Medication answers come only from the plan and the log.
5. **Not an emergency service.** Mia alerts family; it never calls 112/911 itself.
6. **Health data is treated as GDPR Art. 9 data** from day one.
7. **Flexible, not hard-coded** — appointments, travel mode, alert timings, roles, language are all configuration.

## 3. Scope

### MVP (must ship for the submission)
- MCP server with the tools in §5, deployed and connected to Alexa+ via `alexa-ai` CLI (en-US)
- DynamoDB care profile, KMS-encrypted, field-level encryption for sensitive fields
- Carer web page: edit profile, routine, medications, recurring appointments, people, comfort notes; view event log and today's status
- Alarm engine: missed medication, distress, not-home-on-time, night unrest → **email (SES) + SMS (SNS)** ladder with acknowledge link
- Bedrock daily summary for the carer
- Demo video (<3 min, English), README, open-source license, friction log

### Stretch (only if MVP is done by ~Oct 18)
- Escalation step 3: automated phone call via **Amazon Connect**
- German language showcase in the demo (data in German, Alexa+ en-US speaking about it — or simulator if de-DE becomes available)
- MCP Apps carer widget (for a family member who has an Echo Show)
- Additional roles (family, outside carer) beyond owner

### Out of scope
- GPS / location tracking outside the home
- Calling emergency services
- Recording or storing her speech / transcripts
- Medication dosing logic or interaction checks
- Multiple care recipients per account

## 4. Architecture

```
 Mum ──voice──▶ Echo Dot ──▶ Alexa+ (LLM selects tool)
                                  │  MCP 2025-11-25, Streamable HTTP, OAuth 2.1 + PKCE
                                  ▼
          ┌──────────── Mia service (Node 22 / TypeScript) ────────────┐
          │  /mcp      MCP server (tools §5)                           │
          │  /oauth    authorization server for Alexa account linking  │
          │  /carer    carer web page + JSON API                       │
          │  /ack/:id  alert acknowledge link                          │
          └───────┬───────────────────┬───────────────────┬────────────┘
                  │                   │                   │
            DynamoDB (KMS)      EventBridge Scheduler   Bedrock (summary)
                                      │
                                Alarm engine ──▶ SES email ─▶ SNS SMS ─▶ (Connect call)
```

- **Runtime:** one TypeScript codebase, `@modelcontextprotocol/sdk`, Hono HTTP framework. Deployed to AWS **eu-central-1** (Frankfurt). Hosting: AWS Lambda behind a Function URL (or App Runner if streaming/cold start becomes a problem — decide in plan after a latency spike test).
- **Latency budget:** every MCP tool < 500 ms. Tools do one DynamoDB query each; no LLM calls on the voice path.
- **Infrastructure as code:** AWS CDK (TypeScript).
- **Local dev:** server on localhost + `cloudflared` tunnel for Alexa+ testing, DynamoDB Local for tests.

### Units
| Unit | Responsibility | Depends on |
|---|---|---|
| `domain/` | Pure logic: what's next today, medication status, appointment recurrence, alert rules. No I/O. | nothing |
| `store/` | Read/write care profile and events; field-level encrypt/decrypt | DynamoDB, KMS |
| `mcp/` | Tool definitions, input schemas, response shaping (facts + speaking guidance) | domain, store |
| `oauth/` | OAuth 2.1 + PKCE authorization server, links an Alexa account to one profile | store |
| `carer/` | Web page + API, carer auth | domain, store |
| `alarms/` | Rule evaluation, escalation ladder, acknowledgement | domain, store, SES, SNS, (Connect) |
| `summary/` | Daily summary generation | store, Bedrock |
| `infra/` | CDK stacks | — |

## 5. MCP tools (her side)

Every tool returns structured content: `facts` (exact data) + `speak_guidance` (short sentences, warm, calm, no "already asked", no medical advice, offer to call carer where relevant). Tool descriptions are written so Alexa+ selects them from natural, vague phrasing.

| Tool | Triggered by e.g. | Returns / effect | Logs |
|---|---|---|---|
| `get_today` | "What day is it?" "What's happening today?" | Date, weekday, time of day, next routine item, today's appointments incl. group + travel info | `orientation_asked` |
| `get_next_appointment` | "When is my group?" "Is it group today?" | Next occurrence of an appointment (by name or next overall), travel mode, leave-by time, what to bring | `orientation_asked` |
| `get_preparation_steps` | "What do I need?" "What should I take?" | Ordered short checklist for the next appointment (coat, bag, keys, glasses) | — |
| `report_leaving` | "I'm leaving now." "I'm going to my group." | Confirms, reminds keys; starts **expected-return timer** | `left_home` |
| `report_home` | "I'm back." "I'm home." | Welcome home; stops timer; asks how it was | `arrived_home` |
| `get_medication_status` | "Did I take my pills?" | Per due dose: taken (time) / due now (with plain description) / not yet due. Only from log. | `med_asked` |
| `confirm_medication` | "I took them." | Logs dose. If already confirmed → "You already took those at 8:12, no more needed." | `med_confirmed` / `med_duplicate_attempt` |
| `comfort_me` | "I'm scared." "I feel strange." | Comfort notes, familiar anchors, offer to call carer | `anxious` |
| `night_reassurance` | Activity 00:00–05:00, "Is it morning?" | Time, "you're safe, it's night", calming routine | `night_awake` |
| `who_is` | "Who is Tom?" "Is anyone coming?" | Person, relationship, next contact/visit | `person_asked` |
| `chat_about_life` | "I'm lonely." "Tell me something." | Life-story topics, last group mood, offer to call carer | `lonely` |
| `report_problem` | "Help!" "I fell." "It hurts." | Immediate distress alarm; calm reply "I've let {carerName} know." | `distress` |

**Proactive prompts** (pill time, leave-for-group time, bedtime) are **Alexa reminders/routines** configured by the carer in the Alexa app — MCP cannot initiate speech. The carer page generates a suggested reminder list to copy into the Alexa app.

## 6. Data model

Single-table DynamoDB, partition key `profileId`.

- **Profile:** name, preferred name, language (`en-US` | `de-DE`), timezone, carer contacts
- **Routine items:** time, label (e.g. "Lunch")
- **Medications:** id, plain description ("small white pill"), schedule (times, weekdays), `takenElsewhere` option per appointment
- **Appointments:** id, name, recurrence (weekdays + time window, or one-off date), exceptions (cancelled dates), **travel mode** (`alone` | `pickup` | `family_drives` | `at_home`), leave-by time, expected-return time + grace minutes, preparation checklist, location label
- **People:** name, relationship, notes, usual contact times
- **Comfort notes** and **life-story topics:** short texts
- **Events:** type, timestamp, optional detail — TTL 90 days (configurable)
- **Alerts:** id, rule, severity, state (`open` | `acknowledged` | `resolved`), escalation step, timestamps
- **Audit:** actor, action, timestamp

Sensitive fields (medications, comfort notes, people, life story, event detail) are encrypted individually with KMS (envelope encryption, data key cached per request).

## 7. Alarm engine

Rules are evaluated on events (immediate) and by EventBridge Scheduler (every 5 min).

| Rule | Condition (defaults, all configurable) | Severity |
|---|---|---|
| Missed medication | Dose not confirmed 45 min after scheduled time, and not marked `takenElsewhere` | medium |
| Duplicate dose attempt | `confirm_medication` on an already-confirmed dose | low (summary only; medium if ≥2/day) |
| Distress | `report_problem` | high |
| Not home on time | `left_home` and no `arrived_home` by expected-return + 30 min (`alone` travel mode only) | high |
| Did not leave | Appointment day, `alone` mode, no `left_home` by leave-by + 30 min | low |
| Night unrest | ≥2 `night_awake` in one night, or any between 00:00–05:00 after distress | medium |
| Unusual pattern | `anxious` count > 2× 14-day median, or no events by 12:00 | low |

**Escalation ladder:** medium/high → email (SES) immediately → SMS (SNS) after 10 min unacknowledged → (stretch) Amazon Connect voice call after another 10 min. High severity starts at SMS + email together. Low severity → daily summary only. Every message has an "I'm on it" link (signed, single-use, expires 24h). Max 10 alerts/day, then digest. Quiet hours configurable except for high.

## 8. Carer web page

- Login: email + one-time code (SES) with mandatory second factor (TOTP); passkey as stretch
- Sections: **Today** (status, open alerts, acknowledge), **Plan** (routine, medications, appointments with recurrence + travel mode + exceptions), **People & comfort**, **Summary** (Bedrock daily summary + 7-day trend), **Settings** (alert rules, contacts, language, retention), **Privacy** (audit log, export JSON, delete everything)
- **Alexa setup helper:** list of reminders/routines to create in the Alexa app, and the account-linking button
- Server-rendered HTML + minimal JS, bilingual labels (en/de)
- Roles in data model: `owner` (MVP), `family`, `carer` (stretch)

## 9. Security

- TLS only; HSTS; strict CSP on carer page
- OAuth 2.1 + PKCE (S256) for Alexa+; short-lived access tokens (1h), rotating refresh tokens, revocation from carer page
- DynamoDB SSE with customer-managed KMS key + field-level envelope encryption
- Separate IAM roles: MCP path = read profile + append events only; carer path = full profile; alarm path = read + alerts
- Secrets in AWS Secrets Manager; no secrets in repo (`.env.example` only)
- Audit log of every carer and MCP access
- Data minimisation: no audio, no transcripts; events only; TTL 90 days
- Data in eu-central-1; export + full delete
- Demo uses a **fictional profile** ("Rose"), never real personal data in the repo or video

## 10. Language

Data and tools are language-neutral. Alexa+ speaks in the customer's locale; family content is spoken as entered. MVP and video: en-US. German: carer page labels + showcase profile in German as stretch. Rationale for impact story: people with dementia often lose a later-learned language first.

## 11. Error handling

- Store unavailable → tool returns a calm fallback ("I can't check right now. {carerName} can help.") and logs to CloudWatch; alarm engine raises a `system_error` email to carer if failures persist >15 min
- Unknown appointment/person → "I don't know, I'll let {carerName} know" + `unknown_question` event (feeds summary so carer can add the info)
- OAuth token invalid → Alexa+ re-link prompt; carer page shows "Alexa disconnected"
- Alert delivery failure (SES/SNS) → retry with backoff, then next ladder step

## 12. Testing

- **Unit (Vitest):** `domain/` exhaustively — recurrence + exceptions, timezone/DST, medication status, duplicate detection, every alarm rule incl. boundaries
- **Integration:** MCP tools against DynamoDB Local + KMS mock; MCP protocol conformance via MCP Inspector
- **Latency test:** p95 < 300 ms per tool against deployed stack
- **Conversation script:** a fixed set of ~40 natural utterances (incl. vague, repeated, anxious ones) run on the Alexa+ simulator; record which tool was chosen and whether the answer stayed factual and kind
- **Alarm end-to-end:** fake clock → missed dose → email → SMS → ack stops ladder
- **Security checks:** no plaintext sensitive fields in DynamoDB scan; IAM path tests; secret scan before publishing repo

## 13. Submission deliverables

- Public GitHub repo, MIT license, README with architecture + setup
- Demo video < 3 min, English, following the storyline in [docs/persona/rose.md](../../persona/rose.md): morning orientation + pills (incl. duplicate guard) → group day, leaving + not-home alarm → night reassurance → carer page + summary
- Seed data for local dev, tests and demo is generated from the Rose persona only
- Product feedback + friction log (bonus up to 10%)
- Track: Alexa+; mini challenges: AWS Builder, Open Source

## 14. Risks

| Risk | Mitigation |
|---|---|
| Alexa+ MCP toolkit en-US/US only | Develop with US-configured dev account + simulator; check early (day 1) that deployment and simulator work from Germany |
| Alexa+ picks wrong tool or paraphrases loosely | Precise tool descriptions, strict `speak_guidance`, conversation script testing, iterate |
| 17 days, one developer | Strict MVP/stretch split; Connect call and German are stretch |
| Lambda cold start vs 500 ms | Provisioned concurrency or App Runner; spike test on day 2 |
| Amazon Connect phone number provisioning delays | Stretch only; SMS is the guaranteed channel |
