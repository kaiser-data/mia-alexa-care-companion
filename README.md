# Mia — Memory & Care Companion for Alexa+

An Alexa+ MCP add-on that helps people living with dementia at home — medication, orientation, sleep, anxiety, loneliness — with a secure carer side and alarm escalation.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track). Demo persona: **Rose Whitaker**, fictional ([docs/persona/rose.md](docs/persona/rose.md)).

## Run locally (no AWS needed)

Requires Node 24, pnpm 10, Chrome or Edge (for speech), and an API key for one model provider (see below).

    pnpm install
    cp .env.example .env              # set MIA_DEV_TOKEN to a long random string
    export ANTHROPIC_API_KEY=…        # from your secret store; never commit it
    pnpm dev                          # Mia Voice on http://127.0.0.1:8788 (starts the Mia MCP server too)

Choose the model with `LLM_PROVIDER`: `anthropic` (needs `ANTHROPIC_API_KEY`), `featherless` (needs `FEATHERLESS_API_KEY`; default model `openai/gpt-oss-120b`, which picked the right tool 15 of 15 times at 3–5 s per turn in a live probe; `MIA_MODEL=moonshotai/Kimi-K2-Instruct-0905` is faster but less reliable: it answered pill questions without calling the pill tool) or `openai` (any OpenAI-compatible endpoint: `LLM_BASE_URL`, `LLM_API_KEY`, `MIA_MODEL`). Unset, it uses Anthropic if its key is present, otherwise Featherless. `MIA_MODEL` overrides the model. The startup log names the provider and model, never the key.

Tap the circle once and talk — no name, no wake word. Mia also speaks first at pill time, when it's time to leave for the group, at bedtime and for an afternoon chat. You can type instead of speaking.

To run only the MCP server (e.g. for the MCP Inspector): `pnpm dev:mcp` → `http://127.0.0.1:8787/mcp` with header `Authorization: Bearer <MIA_DEV_TOKEN>`.

Local mode stores data in SQLite under `.mia-data/`, encrypted with a generated AES-256-GCM key. It is **not** production; AWS mode (DynamoDB + KMS, OAuth 2.1, Transcribe/Polly/Bedrock) follows.

**"Care Mode" (a proposal for Alexa+):** in Mia Voice, care topics reach Mia without its name, and Mia may speak first at agreed times (`GET /proactive`). Today's Alexa+ add-ons cannot do this; the demo shows how it would help.

## Echo Dot (classic Alexa skill, local mode)

While Alexa+ add-ons are closed, an Echo reaches Mia through a German custom skill ("Alexa, öffne meine Mia"). Her words go to the same brain; Mia cannot speak first on the Echo.

1. Create a custom skill (de-DE, own backend) at developer.amazon.com/alexa/console/ask, paste `packages/voice/alexa/de-DE.json` into the JSON editor, build.
2. `cloudflared tunnel --url http://127.0.0.1:8789` and set the HTTPS endpoint to `<tunnel>/alexa` ("sub-domain of a domain that has a wildcard certificate").
3. Start Mia with `MIA_ALEXA_SKILL_ID=amzn1.ask.skill.…`. Only requests signed by Alexa for that skill are answered.

A private profile: `MIA_PROFILE_FILE=.mia-data/<name>.json` (gitignored; same shape as the seed profiles) instead of `MIA_PROFILE`.

## Tests

    pnpm test
    pnpm typecheck

## Docs

- Design: [docs/superpowers/specs/2026-10-06-mia-design.md](docs/superpowers/specs/2026-10-06-mia-design.md)
- Research: [docs/research/2026-10-06-practical-implementation.md](docs/research/2026-10-06-practical-implementation.md)
- Roadmap: [docs/superpowers/plans/2026-10-07-mia-roadmap.md](docs/superpowers/plans/2026-10-07-mia-roadmap.md)
