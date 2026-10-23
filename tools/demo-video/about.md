## Inspiration
My mother lives alone with dementia. I want her to manage her own day, with a companion she can simply talk to, and I want to know when she needs me. Mia is a gentle second brain for her, and peace of mind for the family.

## What it does
Mia runs on Alexa+ as an MCP add-on (demoed in our own browser simulator):
- **Pills:** answers "Did I take my pills?" from the log, every time, and keeps doses safe.
- **Her day:** the date, appointments and what to take along, plus a weather hint.
- **Speaks first:** at pill time, before outings, at bedtime and for a friendly chat.
- **Nights:** the same calm words at 2 a.m.
- **Family in the loop:** health questions and calls for help reach her son by email within seconds.
- **English and German.**

## How we built it
- TypeScript MCP server with 16 tools over Streamable HTTP, encrypted SQLite (AES-256-GCM).
- The language model only picks tools and reviewed phrases. Every word Rose hears comes from templates, and pills and calls for help take fixed routes.
- AWS: EC2 in Frankfurt, Caddy for HTTPS, IAM instance role, Amazon SES for alerts.
- 1,000+ tests, open source (MIT).

## Challenges
Alexa+ add-on tools are in partner preview, so we built a simulator that is a real MCP client. Speech recognition for older voices is the next big step.

## Accomplishments
A safe, tested care core: reliable pill answers, alerts that always reach the family, and a Care Mode proposal for Alexa+.

## What we learned
For people with dementia, the same kind sentence every time matters most. Letting the model choose, and templates speak, keeps Mia safe.

## What's next
A voice loop tuned for older speakers, a care page for families, and Mia on a real Echo as soon as Alexa+ add-ons open.
