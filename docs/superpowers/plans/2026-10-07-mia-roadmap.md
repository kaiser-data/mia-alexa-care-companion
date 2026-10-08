# Mia — Roadmap (Oct 7 → Oct 23, 2026)

Spec: [2026-10-06-mia-design.md](../specs/2026-10-06-mia-design.md) · Research: [practical implementation](../../research/2026-10-06-practical-implementation.md)

The spec spans several subsystems, so it is built as **six sub-plans**. Each produces working, tested software on its own. Only Plan 1 is detailed now; each later plan is written in detail when the previous one is done, using what we learned.

| # | Plan | Days | Delivers | Depends on |
|---|---|---|---|---|
| 0 | **Day-1 checks** (below) | Oct 7 | Accounts, keys, access confirmed | — |
| 1 | [Core: domain, i18n, store, MCP server](2026-10-07-plan-1-core-mcp-server.md) | Oct 7–9 | All 14 MCP tools over Streamable HTTP, local mode, en + de, Rose seed, protocol 2025-03-26 + 2025-11-25 | 0 |
| 2 | Mia Voice simulator (local mode) | Oct 9–11 | Browser "Echo" + gateway: Web Speech in/out, Claude as MCP client, nameless routing, proactive prompts, night mode, verbatim-template check, distress keyword guard | 1 |
| 3 | Alarms + carer page | Oct 11–13 | Alarm rules (§11), ladder with local outbox, acknowledge link, carer page (plan, today, alerts, privacy export/delete), email OTP + TOTP login | 1 |
| 4 | AWS mode | Oct 13–16 | DynamoDB + KMS store, Transcribe/Polly/Bedrock in Mia Voice, SES/SNS delivery, EventBridge schedule, OAuth 2.1 + PKCE, CDK stacks in eu-central-1, Bedrock daily summary | 1, 2, 3 |
| 5 | Calibration + test bench | Oct 16–18 | Calibration wizard, `very_simple` templates, corpus en/de, Polly + ffmpeg audio bench (3 conditions), CI workflow, HTML report | 2, 4 |
| 6 | Submission | Oct 19–22 | Office hours questions (Oct 19), README, demo video, friction log, product feedback + Care Mode proposal, repo public + MIT, secret scan | all |
| — | Buffer | Oct 23 until 21:00 CEST | Submit on Devpost | — |

**Added 2026-10-07 (approved by the author):**
- **Family voice messages** — carer records short messages on the carer page (Plan 3); Mia Voice plays them at a set time or from `comfort_me` (Plan 2). Audio is family content, stored encrypted, deleted with the profile.
- **Weather on the way out** — `get_preparation_steps` adds "It's cold today. Take your coat." from a free weather API (Open-Meteo, no key) using the profile location (Plan 2/4).
- **Favourite music offer** — late afternoon (sundowning) or from `comfort_me`: "Shall I play Frank Sinatra?" → simulator plays a royalty-free stand-in; on real Alexa+ this hands off to Alexa music (Plan 2).
- **Unsure noon pill (best practice: never risk a double dose)** — if Mia cannot know whether she went to the group, the noon pill is *unsure*: Mia says "I'm not sure… Let's ask Tom first." and alerts the carer (medium). Carer page (Plan 3) gets two buttons: "she went" / "she stayed home" (logs `left_home` / `stayed_home`).
- Later list (not in hackathon scope): morning "Did you sleep well?" check, group confirms arrival by link, drink reminders, camera activity signal, pharmacy blister integration.

**Stretch (only after Plan 5, by ~Oct 18):** Amazon Connect call, drift check, extra audio conditions, Nova 2 Sonic mode, MCP Apps widget, extra roles, Claude Desktop interop demo.

## Plan 0 — Day-1 checks (Oct 7, ~1 h, by the author)

- [ ] Devpost: registered for the hackathon, Alexa+ track
- [ ] AWS account ready; region `eu-central-1`; Bedrock model access for the latest Claude Sonnet and Haiku (inference profile) — test one call in the console
- [ ] Anthropic API key available for local mode (stored with the `keys` CLI / Infisical, never pasted in chat or committed)
- [ ] Node 24 (`node -v` → v24.x) and pnpm 10 (`pnpm -v`) installed — both confirmed on the dev machine on Oct 7
- [ ] Note questions for office hours Oct 19 (nameless routing, de-DE for MCP Toolkit, proactive add-on prompts)

## Working rules for all plans

- TDD: failing test → minimal code → green → commit
- `pnpm test` and `pnpm typecheck` green before every commit
- Only fictional Rose data anywhere in the repo
- After code changes: `graphify update .` (project rule)
