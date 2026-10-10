# Mia — Memory & Care Companion for Alexa+

An Alexa+ MCP add-on that helps people living with dementia at home — medication, orientation, sleep, anxiety, loneliness — with a secure carer side and alarm escalation.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track). Demo persona: **Rose Whitaker**, fictional ([docs/persona/rose.md](docs/persona/rose.md)).

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

## Tests

    pnpm test
    pnpm typecheck

## Docs

- Design: [docs/superpowers/specs/2026-10-06-mia-design.md](docs/superpowers/specs/2026-10-06-mia-design.md)
- Research: [docs/research/2026-10-06-practical-implementation.md](docs/research/2026-10-06-practical-implementation.md)
- Roadmap: [docs/superpowers/plans/2026-10-07-mia-roadmap.md](docs/superpowers/plans/2026-10-07-mia-roadmap.md)
