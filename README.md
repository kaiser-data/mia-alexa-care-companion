# Mia — Memory & Care Companion for Alexa+

Mia is an Alexa+ add-on (an MCP server) and a browser voice simulator for people living with dementia at home. Rose Whitaker, 78, is a fictional persona; her son Tom looks after her from afar. Mia helps with her five hardest things: **medication** (did I take my pills?), **orientation** (what day is it, is it a group day?), **sleep** (night-time waking), **anxiety** (calm, repeated, kind answers) and **loneliness** (a friendly voice that speaks first). Every answer comes from what the family entered, never from a guess, and when something is wrong Tom is alerted.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track, AWS Builder and Open Source mini challenges). Licensed MIT ([LICENSE](LICENSE)). Persona: [docs/persona/rose.md](docs/persona/rose.md).

## What it shows

- **Mia MCP server** with 16 tools (medication, day and appointments, preparation with weather, outings, people, comfort and calls, health questions to the carer, problems, music, repeat), Streamable HTTP, bearer-token auth.
- **Mia Voice, a browser simulator** with **Care Mode**: care topics reach Mia without its name, and Mia speaks first at agreed times. Today's Alexa+ add-ons cannot do this; see [the proposal](docs/submission/care-mode-proposal.md).
- **Alexa skill bridge** (German, classic skill) to the same brain. It works in the Alexa developer console simulator only; Echo devices on Alexa+ refuse in-development skills ("not supported on this device", see [known issues](docs/known-issues.md)).
- **SES alarm email**: medium and high alerts go to the carer; a cry for help that cannot be mailed tells Rose to call for help.
- **AWS deploy**: one small server in Frankfurt (EC2 + Caddy + SES), see [deploy/aws/README.md](deploy/aws/README.md).

## Architecture

    Echo / browser (Rose speaks)
            |
            v
    Mia Voice (speech in/out, Care Mode, proactive turns)
            |  the LLM picks a tool
            v
    Mia MCP server (16 tools, Streamable HTTP, bearer token)
            |                         |
            v                         v
    SQLite, AES-256-GCM       alerts --> Amazon SES --> Tom's inbox
    encrypted at rest

## Quick start (local, no AWS)

Requires Node 24, pnpm 10, Chrome or Edge (for speech) and an API key for one model provider.

    pnpm install
    cp .env.example .env              # set MIA_DEV_TOKEN to a long random string
    export ANTHROPIC_API_KEY=…        # from your secret store; never commit it
    pnpm dev                          # Mia Voice on http://127.0.0.1:8788 (starts the Mia MCP server too)

Choose the model with `LLM_PROVIDER`: `anthropic` (needs `ANTHROPIC_API_KEY`), `featherless` (needs `FEATHERLESS_API_KEY`; default model `openai/gpt-oss-120b`, which picked the right tool 15 of 15 times at 3–5 s per turn in one live probe, Oct 2026; `MIA_MODEL=moonshotai/Kimi-K2-Instruct-0905` is faster but less reliable: it answered pill questions without calling the pill tool) or `openai` (any OpenAI-compatible endpoint: `LLM_BASE_URL`, `LLM_API_KEY`, `MIA_MODEL`). Unset, it uses Anthropic if its key is present, otherwise Featherless. `MIA_MODEL` overrides the model. The startup log names the provider and model, never the key.

Tap the circle once and talk — no name, no wake word. Mia also speaks first at pill time, when it's time to leave for the group, at bedtime and for an afternoon chat. You can type instead of speaking.

To run only the MCP server (e.g. for the MCP Inspector): `pnpm dev:mcp` → `http://127.0.0.1:8787/mcp` with header `Authorization: Bearer <MIA_DEV_TOKEN>`.

Local mode stores data in SQLite under `.mia-data/`, encrypted with a generated AES-256-GCM key. It is **not** production.

Optional settings (see `.env.example`): `MIA_PUBLIC_ORIGIN` when the page sits behind a proxy, `MIA_CLOCK_START` to start the demo clock at a chosen time, `MIA_ALERT_EMAIL_TO` / `MIA_ALERT_EMAIL_FROM` / `AWS_REGION` for the SES alarm mail.

## Echo Dot (classic Alexa skill, local mode)

While Alexa+ add-ons are closed, an Echo reaches Mia through a German custom skill ("Alexa, öffne meine Mia"). Her words go to the same brain; Mia cannot speak first on the Echo.

1. Create a custom skill (de-DE, own backend) at developer.amazon.com/alexa/console/ask, paste `packages/voice/alexa/de-DE.json` into the JSON editor, build.
2. `cloudflared tunnel --url http://127.0.0.1:8789` and set the HTTPS endpoint to `<tunnel>/alexa` ("sub-domain of a domain that has a wildcard certificate").
3. Start Mia with `MIA_ALEXA_SKILL_ID=amzn1.ask.skill.…`. Only requests signed by Alexa for that skill are answered.

A private profile: `MIA_PROFILE_FILE=.mia-data/<name>.json` (gitignored; same shape as the seed profiles) instead of `MIA_PROFILE`.

## Safety rules

- The family is the source of truth. Unknown means "I don't know, let me ask Tom". No guessing.
- No medical advice. Medication answers come only from the plan and the log; Mia never names doses, never advises on extra pills, never interprets symptoms.
- Pills taken twice are treated as a cry for help and alert the carer; a duplicate dose is blocked kindly.
- The alarm is raised before anything else and does not depend on the model or on reading the log.
- Mia is not an emergency service. It alerts family and never calls 112 or 911 itself.
- Same answer, every time, kindly: never "you already asked that".

## Privacy

- Stored data is encrypted with AES-256-GCM using a generated local key (`.mia-data/`, gitignored).
- All data in this repository is fictional (Rose Whitaker, Tom). A private profile is loaded with `MIA_PROFILE_FILE`, which stays outside git.
- Mia keeps no transcripts outside the encrypted local store. What Rose says is sent to the model provider you configure. In the browser, speech recognition runs on the browser vendor's service (Chrome/Edge), and on the Echo, Amazon processes the speech. Other outbound calls: Open-Meteo for weather, and Amazon SES for alarm mail when enabled.
- On AWS, the app and its encrypted database run in Frankfurt (eu-central-1). The model provider, the browser speech service and SES email are outside that server and not limited to the EU by Mia.
- Health data is treated as GDPR Art. 9 data by design.

## Limits

Local mode is a demo, not production. Known open findings are in [docs/known-issues.md](docs/known-issues.md). Alexa+ add-ons are closed to hackathon participants, so the simulator and the classic skill stand in for them.

## Submission docs

- [Devpost text](docs/submission/devpost.md)
- [Demo video script](docs/submission/demo-video-script.md)
- [Care Mode proposal](docs/submission/care-mode-proposal.md)
- [Friction log](docs/submission/friction-log.md)
- [Product feedback](docs/submission/product-feedback.md)

## Tests

    pnpm test
    pnpm typecheck

Tests need no `.env` and no API key.

## More docs

- Design: [docs/superpowers/specs/2026-10-06-mia-design.md](docs/superpowers/specs/2026-10-06-mia-design.md)
- Research: [docs/research/2026-10-06-practical-implementation.md](docs/research/2026-10-06-practical-implementation.md)
- Roadmap: [docs/superpowers/plans/2026-10-07-mia-roadmap.md](docs/superpowers/plans/2026-10-07-mia-roadmap.md)
