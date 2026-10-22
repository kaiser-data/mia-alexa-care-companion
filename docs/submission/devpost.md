# Devpost submission: Mia

Build, Ship, Shape: Amazon Developer Hackathon. Track: **Alexa+**. Mini challenges: **AWS Builder** and **Open Source**.
Deadline: **Friday 2026-10-23, 12:00 pm PDT (21:00 CEST)**. After that, drafts can no longer be changed.

## Requirements checklist

Source: the Official Rules (`/rules`) and FAQs (`/details/faqs`) pages, read on 2026-10-20. Both returned HTTP 403 to the WebFetch tool; they were read with a plain HTTP request that sends a browser User-Agent and converted to text. Quotes below are from those pages. Check the live pages once more on submission day; rules can change.

**Dates:** submission period 2026-08-31 10:15 PT to 2026-10-23 12:00 PT. Judging 2026-11-09 to 2026-11-20. AWS credit codes ran out on 2026-10-07 (nothing to request).

**Form fields and what we give**

| Required by the rules | Where it comes from | Done |
|---|---|---|
| Text description of features and functionality | sections below | [ ] paste in |
| Primary track identified | Alexa+ | [ ] tick |
| Mini challenges identified | AWS Builder, Open Source | [ ] tick both |
| Code repository URL on GitHub, public with an open-source licence file, or private and shared with the reviewers | public repo, MIT `LICENSE` | [ ] repo public, [ ] licence file present |
| Repo contains all source, assets and clear setup/run instructions | README "Run locally" | [ ] verify from a clean clone |
| Demo video under 3 minutes, public on YouTube or Vimeo, link on the form; shows the project working on the intended platform; no third-party trademarks or copyrighted music | `demo-video-script.md` | [ ] recorded, [ ] uploaded public, [ ] link pasted |
| Product Feedback: tools used and what for; what worked; what needs work; onboarding; build again yes/no and why | `product-feedback.md` §1 to §5 | [ ] paste in |
| AWS Builder: "Describe which AWS service(s) you used and how, in your Product Feedback answer" | `product-feedback.md` §7 | [ ] included |
| Open Source: contribution URL, project repository URL, GitHub username, and a description of what you did, how it works, why it matters | `product-feedback.md` §8 | [ ] URLs filled in |
| Optional: Feature requests (description, why it matters, priority Critical / Important / Nice-to-have) | `product-feedback.md` §6, `care-mode-proposal.md` | [ ] paste in |
| Optional: Friction log entries (task, steps, expected vs actual, severity, workaround, suggestion). "Participants who submit friction logs score higher in judging (up to 10% bonus)" | `friction-log.md` | [ ] paste in |
| English for all materials | all files are English; the German scene in the video has English captions | done |

**Alexa+ track specifics (from the rules)**

- "A working Agent Skill or a self-hosted MCP server, implementing MCP spec version 2025-11-25 (or a later version, once confirmed) over Streamable HTTP." Mia's server negotiates 2025-11-25 and 2025-03-26 (tested in `packages/mcp-server/test/http.test.ts`).
- "Alternatively, entrants may submit a simulated Alexa+ experience". We do both: the MCP server is the product, the browser simulator is the client.
- FAQ: a web page acting as a real MCP client (initialize, tools/list, tools/call) satisfies the requirement; "A locally runnable public repo plus your demo video is enough". The MCP server does not need to stay live after submission.
- Rules: for Alexa+ the repo must "demonstrate use of your track's required technology at runtime ... imported and actually called". The simulator calls the server's tools over MCP at runtime.
- The track's tools (Category SDK, MCP Toolkit, `alexa-ai` CLI, Web Simulator) are not available to participants (FAQ). The video states that our simulator replaces them.

**Judging (Stage 2, equal weight):** Tech Implementation, Design, Potential Impact, Quality of the Idea. Stage 1 is pass/fail: fits the theme and reasonably applies the required technology. The Alexa+ examples of "creative" include a context-aware add-on that keeps state across sessions. Mia keeps a care log across sessions (pills, outings, alerts).

**Prizes at stake:** Alexa+ track 1st/2nd/3rd; AWS Builder ($5,000 cash + $5,000 AWS credits); Open Source ($5,000 + $5,000 credits). One track prize and one mini-challenge prize at most.

**Not verified / open before submitting**

- Whether the page should show a "submission language" for the German scene. The rules require English or an English translation for video, text and docs: the video has English captions; the German strings in the repo are code and data.
- The exact repository URL, YouTube/Vimeo link and the live demo address are not yet known and are marked `<...>` below.
- The alarm email in the video needs SES out of sandbox or a verified recipient address.

---

## Project name

**Mia**

## Tagline (under 60 characters)

A calm voice for people living with dementia

Alternatives: "Alexa+ add-on for dementia care" / "Memory and care companion for Alexa+"

## Inspiration

Built by a carer for his mother, who lives with dementia. The hardest moments are small and repeated: "Did I take my pills?" five times before breakfast, "Is it group today?" every Monday morning, a wake-up at 3 a.m. with the feeling of being late for work. The person cannot learn a new device name or a new command, and the family cannot be there. The family member does not need a clever assistant. They need the same calm answer every time, a reliable pill log, and a message when something goes wrong.

Everything in this submission is a fictional demo: **Rose Whitaker**, 81, lives alone in Columbus, Ohio, with an Echo Dot in the kitchen; her son **Tom** is her carer, two hours away.

## What it does

Mia is built as an Alexa+ add-on: an MCP server with 16 tools. It runs today in our own browser "Echo", an MCP client, because Alexa+ add-on tools are closed to participants.

For Rose:
- **Pills.** "Did I take my pills?" is answered only from the log. If the dose is due, she hears which pill ("the small white pill and the round pink one"). After "I took them", a second "I took them" is answered kindly with "You took your morning pills at about eight o'clock. No more pills needed now." No double dose. If Mia is unsure, it says so and flags Tom.
- **The day.** "What day is it?" and "Is it group today?" get the same short answer each time: the day, when she leaves for Maple Grove Day Club, what to bring (keys on the red lanyard, handbag, glasses, coat), and a weather line when it is cold or rainy.
- **Mia speaks first.** At pill time, 15 minutes before leaving for the group, when she should be back, at bedtime, and for an afternoon chat. Every prompt ends in a yes/no question.
- **Night.** "Is it morning?" at 2:00 gets "It's two o'clock, in the middle of the night. You're safe at home. You can go back to sleep."
- **Comfort and people.** Who is Tom, a comfort note, a little chat about her life, music she likes.
- **No medical advice.** "Can I take an aspirin?" gets "I can't answer that one. Let's ask Tom first." Tom is emailed.
- **Help.** "I fell" raises a high alert at once, before any language model call, and Tom gets an email: `[Mia] URGENT: Rose asked for help: "I fell.".` (punctuation as recognised). If the email cannot be sent (when alarm email is configured), Mia tells Rose: "I couldn't reach Tom. Please call for help."
- **German too.** The same Mia speaks German (de-DE) with its own templates.

For Tom: alarm email through Amazon SES for medium and high severity alerts (a repeat of the same medium alert is mailed at most once per 6 hours; every cry for help is mailed).

## How we built it

- **Claude picks, doesn't write.** A language model only chooses which tool to call and which fixed phrase ids (an opener such as "Of course, Rose.", one feeling, one yes/no question, one closing) come around the answer. It writes no sentence. Every spoken fact and every safety sentence comes from server templates in English and German and is spoken verbatim, so Mia cannot invent a medicine, a time, or advice.
- **MCP server** (TypeScript, Node 24, Hono, official MCP SDK 1.32.1): 16 tools, Streamable HTTP, bearer token, protocol versions 2025-11-25 and 2025-03-26. Sensitive data (pills, people, comfort notes, events, alerts) is stored in SQLite with field-level AES-256-GCM encryption.
- **Mia Voice** (browser "Echo"): no wake word and no name, Chrome speech recognition and voice, optional captions. It is an actual MCP client (initialize, tools/list, tools/call).
- **Models.** `openai/gpt-oss-120b` through Featherless, the Featherless default (picked the right tool 15 of 15 times at 3 to 5 seconds per turn in our probe; a faster model skipped the pill tool). An Anthropic adapter is included. Plain pill questions ("Did I take my pills?") and cries for help ("I fell") take deterministic routes with no model call; a self-report like "I took them" goes through the model.
- **On AWS.** One EC2 instance (t4g.small, Amazon Linux 2023) in Frankfurt runs the app under systemd; Caddy gives HTTPS and basic auth; the instance role sends alarm mail through Amazon SES, with no AWS access keys on the box. Deploy scripts are in `deploy/aws/`.
- **Tested** with a large suite (the repository runs `pnpm test` and `pnpm typecheck` on Node 24), including a sweep of every tool answer over a week at nine times of day (over 1,000 answers per language) and long lists of pill and help phrasings in English and German.
- **Demo clock.** `MIA_CLOCK_START` starts Mia's clock at a chosen time so the video can show 8:00, 9:35 and 2:00 on one afternoon.

## Challenges we ran into

- **No Alexa+ developer tools for participants.** The add-on tools are preview, select partners only. We built our own simulator that acts as a real MCP client.
- **German.** The MCP Toolkit is en-US only. We built a classic German custom skill as a bridge; it works in the Alexa developer console but an Echo Dot on Alexa+ in Germany answers "not supported on this device". The honest result: a German Alexa+ user cannot be served today. The console also showed the template's "Alexa, öffne hallo welt" although the invocation name was correct.
- **A language model must not guess about pills.** Models differed a lot at picking tools (15 of 15 vs 5 of 8 on the same probe). That led to the router design: the model chooses, templates speak, and the pill and help paths do not depend on the model.
- **Dementia speech is hard for recognition.** We avoid dead ends: low confidence gets one yes/no check, two misses get the day plus an offer to call Tom.
- **Safety wording.** "Not yet" can sound like "don't take it", so a due dose never starts with "Not yet". "I took my pills twice" is treated as a cry for help, not as a pill question.

## Accomplishments that we're proud of

- A pill answer that is never written by a model: it comes only from the log.
- Mia speaks first, so Rose never has to remember to ask.
- An alarm that does not depend on the model or on reading the log, and that tells Rose when the email failed.
- One codebase in English and German.
- A concrete, tested **Care Mode proposal** for Alexa+: nameless care topics, proactive speech at carer-set times, carer-set limits.
- A friction log and product feedback written from real use, including the finding that a German Alexa+ user cannot be served today.

## What we learned

- For a person with dementia, the interface is not the sentence; it is that the same sentence comes every time.
- Letting a model write is the risk; letting it choose among reviewed sentences is enough.
- Alexa+ would be a strong home for care add-ons if they could be reached without a name and could speak first.

## What's next for Mia

- Run on a real Alexa+ device when add-on access opens, with nameless care topics (the Care Mode proposal).
- A carer page: edit the plan, see alerts and a daily summary.
- Amazon DynamoDB with a customer-managed KMS key, Transcribe and Polly for calibrated voices, and Bedrock as a model option.
- Calibration for older voices (speaking rate, end-of-turn pause, custom vocabulary) and an audio test bench.
- More languages and review of the German phrases by native speakers.

## Built with

TypeScript, Node.js 24, Hono, Model Context Protocol (TypeScript SDK), Streamable HTTP, Zod, SQLite, AES-256-GCM, Vitest, Amazon EC2, Amazon SES, AWS IAM, Caddy, systemd, Featherless (`openai/gpt-oss-120b`), Anthropic API, Web Speech API, Open-Meteo, Alexa Skills Kit (German bridge skill).

## Try it

- **Repository:** `<GitHub repository URL>` (public, MIT licence)
- **Demo video:** `<YouTube or Vimeo URL>`
- **Live demo (may be taken down after judging):** `https://<ip-with-dashes>.sslip.io`, basic-auth credentials in the testing instructions
- **Run locally** (no AWS needed): Node 24, pnpm 10, Chrome. `pnpm install`, copy `.env.example` to `.env`, set `MIA_DEV_TOKEN` and one model key, `pnpm dev`, open `http://127.0.0.1:8788`, tap the circle and talk.
- **Care Mode proposal:** `docs/submission/care-mode-proposal.md`
- **Friction log and product feedback:** `docs/submission/friction-log.md`, `docs/submission/product-feedback.md`

## Testing instructions for judges

1. Clone the repo; Node 24, pnpm 10, Chrome.
2. `pnpm install && cp .env.example .env`; set `MIA_DEV_TOKEN` to a long random string and `FEATHERLESS_API_KEY` or `ANTHROPIC_API_KEY`.
3. `pnpm dev`; open `http://127.0.0.1:8788`; tap the circle. Type if the microphone is unavailable.
4. Try: "Did I take my pills?", "I took them.", "Is it group today?", "Can I take an aspirin?", "I fell." The page shows what Mia says.
5. To see Mia speak first at a chosen time: `MIA_CLOCK_START=2026-10-26T07:59:40-04:00 pnpm dev` (Monday, just before pill time).
6. To test the MCP server on its own: `pnpm dev:mcp`, then `npx @modelcontextprotocol/inspector` with Streamable HTTP at `http://127.0.0.1:8787/mcp` and header `Authorization: Bearer <MIA_DEV_TOKEN>`.
7. Alarm emails need Amazon SES (`MIA_ALERT_EMAIL_TO`, `MIA_ALERT_EMAIL_FROM`, AWS credentials). Without them, alerts are only stored in the encrypted local database, and Mia still answers "I've let Tom know right away."

Mia is a hackathon prototype running in local mode. It is not a medical device and not an emergency service.
