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
