# Mia: the project story

**Always Remembers.** Your day, remembered. Your family, reassured.

| For | Mia means |
|---|---|
| Seniors living alone | Your day, your way, with a friend who remembers the details. |
| Sons and daughters | Know Mum and Dad are okay, and hear from Mia when they need you. |
| Carers and care services | Routines that run themselves, and alerts that matter. |
| Everyone | A gentle second brain on the speaker already in millions of homes. |

## Inspiration

Mia was built by a carer for his mother, who lives with dementia. The hardest moments are small and they repeat: "Did I take my pills?" five times before breakfast, "Is it group today?" every Monday morning, waking at 3 a.m. with the feeling of being late for work. She cannot learn a new device name or a new command, and the family cannot always be there. What she needs is not a clever assistant. She needs the same calm answer every time, a reliable pill log, and a message to the family when something goes wrong. Her son wants her to keep managing on her own at home, with a companion she can simply talk to, while he is told when she needs him.

AI can be a second brain. For people in the early or later stages of dementia, and for the people who care for them, that is a real chance to keep daily routines and to live more normally: what is forgotten is remembered for them, events and missed doses are noticed, and relatives get the information they need. Alexa+ is already in many homes; Mia is a companion on it whose workflows and words are shaped around the needs of older people.

Everything in this repository is a fictional demo. **Rose Whitaker**, 81, lives alone in Columbus, Ohio, with an Echo Dot in the kitchen. Her son **Tom** is her carer and lives two hours away.

## What it does

Mia is built as an Alexa+ add-on: an MCP server with 16 tools. It runs in its own browser "Echo", which is a real MCP client, because Alexa+ add-on tools are not yet open for development.

For Rose:
- **Pills.** "Did I take my pills?" is answered only from the log. If a dose is due, Rose hears which pills ("the small white pill and the round pink one"). If she says "I took them" a second time, she gets a kind answer: "You took your morning pills at about eight o'clock. No more pills needed now." There is no double dose. If Mia is unsure, it says so and flags Tom.
- **The day.** "What day is it?" and "Is it group today?" get the same short answer every time: the day, when she leaves for Maple Grove Day Club, what to take (keys on the red lanyard, handbag, glasses, coat), and a weather line when it is cold or rainy.
- **Mia speaks first.** At pill time, 15 minutes before leaving for the group, when she should be back, at bedtime, and for an afternoon chat. Every prompt ends in a yes/no question.
- **Night.** "Is it morning?" at 2:00 gets "It's two o'clock, in the middle of the night. You're safe at home. You can go back to sleep."
- **Comfort and people.** Who Tom is, a comfort note, a little chat about her life, music she likes.
- **No medical advice.** "Can I take an aspirin?" gets "I can't answer that one. Let's ask Tom first." Tom is emailed.
- **Help.** "I fell" raises a high alert at once, before any language model call, and Tom gets an email: `[Mia] URGENT: Rose asked for help: "I fell.".` If the email cannot be sent, Mia tells Rose: "I couldn't reach Tom. Please call for help."
- **German too.** The same Mia speaks German (de-DE) with its own templates.

For Tom, alarm emails go out through Amazon SES for medium and high alerts. A repeat of the same medium alert is mailed at most once every 6 hours; every cry for help is mailed.

## How it was built

- **Claude picks, doesn't write.** The language model only chooses which tool to call and which fixed phrases go around the answer: an opener such as "Of course, Rose.", one feeling, one yes/no question, one closing. It writes no sentence. Every spoken fact and every safety sentence comes from server templates in English and German and is spoken word for word, so Mia cannot invent a medicine, a time or a piece of advice.
- **MCP server** (TypeScript, Node 24, Hono, official MCP SDK): 16 tools, Streamable HTTP, bearer token, protocol versions 2025-11-25 and 2025-03-26. Sensitive data (pills, people, comfort notes, events, alerts) is stored in SQLite with field-level AES-256-GCM encryption.
- **Mia Voice**, the browser "Echo": no wake word and no name, Chrome speech recognition and voice, optional captions. It is a real MCP client (initialize, tools/list, tools/call).
- **Models.** The default is `openai/gpt-oss-120b` through Featherless. In a probe it picked the right tool 15 of 15 times at 3 to 5 seconds per turn; a faster model skipped the pill tool. An Anthropic adapter is included. Plain pill questions and cries for help take fixed routes with no model call.
- **On AWS.** The deploy scripts put the app on one EC2 instance (t4g.small, Amazon Linux 2023) in Frankfurt under systemd. Caddy provides HTTPS and basic auth. The instance role sends alarm mail through Amazon SES, so there are no AWS access keys on the server. It ran live for testing in October 2026, including a real alarm email. The deploy scripts are in [`deploy/aws/`](../../deploy/aws/README.md).
- **Tested** with more than 1,000 tests. They include a sweep of every tool answer over a week at nine times of day, and long lists of pill and help phrasings in English and German.
- **Demo clock.** `MIA_CLOCK_START` starts Mia's clock at a chosen time, so a demo can show 8:00, 9:35 and 2:00 in one afternoon.

## Challenges

- **No Alexa+ developer tools.** The add-on tools are in preview for select partners only. The answer was a simulator that acts as a real MCP client.
- **German.** The MCP Toolkit supports en-US only. A classic German custom skill works as a bridge in the Alexa developer console, but an Echo Dot on Alexa+ in Germany answers "not supported on this device". As things stand, a German Alexa+ user cannot be served.
- **A language model must not guess about pills.** Models differed a lot at picking tools (15 of 15 against 5 of 8 on the same probe). This led to the router design: the model chooses, templates speak, and the pill and help paths do not depend on the model.
- **Speech recognition and older voices.** Mia avoids dead ends: low confidence gets one yes/no check, and two misses get the day plus an offer to call Tom. Even so, recognition and turn-taking are the weakest part of the prototype today.
- **Safety wording.** "Not yet" can sound like "don't take it", so a due dose never starts with "Not yet". "I took my pills twice" is treated as a cry for help, not as a pill question.

## What worked

- A pill answer that no model writes: it comes only from the log.
- Mia speaks first, so Rose never has to remember to ask.
- An alarm that does not depend on the model or on reading the log, and that tells Rose when the email failed.
- One codebase in English and German.
- A concrete **[Care Mode proposal](care-mode-proposal.md)** for Alexa+: care topics without a name, proactive speech at carer-set times, carer-set limits.
- A [friction log](friction-log.md) and [product feedback](product-feedback.md) written from real use.

## What was learned

- For a person with dementia, what matters is not how good a sentence is but that the same sentence comes every time.
- Letting a model write is the risk. Letting it choose among reviewed sentences is enough.
- The voice loop decides everything. A safe answer is of no use if it is misheard or comes too late.
- Alexa+ would be a strong home for care add-ons if they could be reached without a name and could speak first.

## What's next

- A better voice loop: streaming speech in and out, tuning for older voices (speaking rate, end-of-turn pause, custom vocabulary) and an audio test bench.
- Testing with real users and carers.
- A carer page to edit the plan and see alerts and a daily summary.
- Running on a real Alexa+ device once add-on access opens.
- Amazon DynamoDB with a customer-managed KMS key, Transcribe and Polly, and Bedrock as a model option.
- More languages, and a review of the German phrases by native speakers.

## Built with

TypeScript, Node.js 24, Hono, Model Context Protocol (TypeScript SDK), Streamable HTTP, Zod, SQLite, AES-256-GCM, Vitest, Amazon EC2, Amazon SES, AWS IAM, Caddy, systemd, Featherless (`openai/gpt-oss-120b`), Anthropic API, Web Speech API, Open-Meteo, Alexa Skills Kit (German bridge skill).

Mia is a prototype. It is not a medical device and not an emergency service.
