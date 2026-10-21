# Product feedback: Mia (Alexa+ add-on for dementia care)

For the Build, Ship, Shape: Amazon Developer Hackathon, Alexa+ track, with the AWS Builder and Open Source mini challenges. Persona: Rose Whitaker (fictional), carer Tom. Written 2026-10-20.

Structured as the Devpost rules ask: which tools and for what, what worked, what needs work, onboarding, would we build again. Specific incidents are in `friction-log.md`; the Care Mode feature request is in `care-mode-proposal.md`.

## 1. Tools, APIs and SDKs used, and for what

| Tool | Used for |
|---|---|
| Alexa+ add-on documentation (design guide, client lifecycle, quickstart, MCP Toolkit overview) | designing the server to the documented client behaviour (protocol versions, Streamable HTTP, response shape, latency) |
| Model Context Protocol, TypeScript SDK `@modelcontextprotocol/sdk` 1.32.1 | the Mia server (16 tools over Streamable HTTP) and the client inside the simulator |
| Hackathon pages (rules, FAQ) | requirements; the simulator path |
| Alexa Skills Kit / Alexa developer console (classic custom skill, de-DE) | a bridge meant to let a German Echo reach Mia (works in the developer console simulator only; Alexa+ Echos refuse in-development skills) |
| Amazon EC2 (t4g.small, Amazon Linux 2023, encrypted gp3 volume), Elastic IP, IAM instance role | the server in Frankfurt (eu-central-1), no access keys on the box |
| Amazon SES (v2 API) | alarm email to the carer for medium and high severity alerts |
| LLM APIs: Featherless (OpenAI-compatible, `openai/gpt-oss-120b` default) and the Anthropic API (adapter) | choosing a tool and fixed phrase ids; never writing spoken text |
| Browser Web Speech API (Chrome) | listening and speaking in the simulator |
| Open-Meteo | the weather line in the "what to take" answer |
| Caddy, sslip.io | HTTPS in front of the instance |

## 2. What worked well

- **The simulator path in the rules.** The FAQ says a web page that acts as a real MCP client (initialize, tools/list, tools/call over Streamable HTTP) satisfies the Alexa+ requirement. That made a complete product possible without partner access.
- **Concrete client-lifecycle docs.** Protocol version, `structuredContent` plus a text content item, no session id and the latency target are stated plainly. We built to them (the server accepts both `2025-03-26` and `2025-11-25`).
- **MCP itself.** Tools with a title, a description with examples, an output schema and annotations are enough for a model to choose well. Tool descriptions with example utterances ("Did I take my pills?", "Habe ich meine Tabletten genommen?") were the most useful thing we wrote.
- **A clear staff answer.** Amazon staff confirmed on the forum that add-ons cannot start calls or Drop In and that a submission may demonstrate beyond today's capabilities. That let us show Care Mode honestly, labelled as a proposal.
- **SES from an instance role.** One IAM role on the instance, the SES v2 SDK call, and the alarm email works without keys on disk. Configuration is a recipient and a sender address.
- **Hackathon logistics.** The Official Rules are specific (video under three minutes, public YouTube/Vimeo link, GitHub repository, licence file or private share), so we could plan the last week against them.

## 3. What needs work

- **No access for participants** to the Category SDK, MCP Toolkit, `alexa-ai` CLI, Web Simulator, or the local inspector (all preview, select partners). We could not test routing, certification or voice behaviour on Alexa+.
- **en-US only.** The MCP Toolkit documentation is US and en-US. Alexa+ is in Early Access in Germany and Austria; a German family cannot use an add-on.
- **Classic skills do not run on Alexa+ devices in development.** Our German skill works in the developer console simulator and gets "not supported on this device" on an Echo Dot on Alexa+. The console does not warn about it.
- **Nameless invocation is undocumented.** The design guide leads with named invocation; implicit invocation is mentioned once without a mechanism.
- **No proactive speech, no calling.** An add-on cannot speak first or start a call or Drop In. For care, the assistant has to be able to start.
- **Console hint.** The Test tab showed the template's example phrase ("Alexa, öffne hallo welt") although the invocation name was set correctly.
- **Setup guides** do not always say the tools are partner-only (the FAQ admits this).
- **No tool-routing test harness.** There is no way to check how Alexa+'s own model will route a tool description. In our own tests tool selection varied from 15 of 15 to 4 of 8 depending on the model.

## 4. Onboarding: zero to hello world

- **Docs to a running MCP server:** quick. A Streamable HTTP MCP server with tools is quick with the TypeScript SDK; the time went into making it safe for the use case, not into the protocol.
- **Alexa+ specific:** blocked. There is no hello-world that can be run on Alexa+ without partner access. We never reached "hello world on Alexa+", only "hello world in our own simulator".
- **Classic skill:** the console path worked, but see the "not supported on this device" finding for Alexa+ hardware.

## 5. Would we build with these devices and services again?

**Yes**, for the Amazon-hosted parts we used (EC2, SES) and for the MCP-based add-on model. **Yes with a condition** for Alexa+: only if a care add-on can be reached without its name and can speak first at carer-approved times (the Care Mode proposal). Without those, a person with dementia cannot use an add-on on their own. With them, Alexa+ would be a strong home for this kind of product, because the device is already in the kitchen and the person already says "Alexa".

## 6. Feature requests

| Request | Why it matters to Mia | Priority |
|---|---|---|
| Nameless routing of care topics to a household-chosen care add-on | Rose cannot remember or say "open Mia" | Critical |
| Proactive prompts at carer-approved times for a care add-on | pill time, leave-for-group reminders | Important |
| Carer-approved call contact for a care add-on ("Shall I ask Tom to call you?") | the offer ends as an email today | Important |
| Hackathon sandbox: a hosted simulator that accepts a public MCP URL | test against Alexa+ routing without partner status | Important |
| de-DE (and other Alexa+ locales) for the MCP Toolkit | a German family cannot be served | Important |
| Account-level senior speech profile (rate, end-of-turn pause, vocabulary) | speech recognition errors are higher for older and dementia voices | Nice-to-have |
| A banner in the developer console when a skill does not run on Alexa+ devices | would have saved a day | Nice-to-have |

Full proposal: `docs/submission/care-mode-proposal.md`.

## 7. AWS Builder mini challenge: which AWS services and how

Honest scope: this build uses a small set of AWS services, each with a documented purpose. It does not use Bedrock, AgentCore, Strands, Transcribe or Polly (those were in our early plan and are out of scope for this release).

- **Amazon EC2** (t4g.small, Amazon Linux 2023, Frankfurt `eu-central-1`, encrypted gp3 volume) runs the Mia Voice gateway and the embedded Mia MCP server under systemd. Caddy terminates HTTPS and puts basic auth in front of the page and `/api`.
- **Elastic IP + sslip.io** give a stable HTTPS address without a domain.
- **IAM instance role** gives the server permission to send mail; there are no access keys on the instance.
- **Amazon SES (v2 API)**: the alarm channel. Medium and high alerts are stored, then mailed to Tom. The same medium alert is mailed at most once per 6 hours; a cry for help is mailed every time. If a high alert cannot be mailed, the server throws and Mia tells Rose: "I couldn't reach Tom. Please call for help." Subjects look like `[Mia] URGENT: Rose asked for help: "I fell.".`
- Provisioning and deploy scripts, the Caddyfile and the systemd unit are in `deploy/aws/` in the repository, with a README.
- Why Frankfurt: Mia treats health data as sensitive personal data from the start (GDPR Art. 9), so the data stays in an EU region.

What we would add next on AWS: DynamoDB with a customer-managed KMS key in place of local SQLite, Amazon Transcribe and Polly for the voice pipeline, and Bedrock as an optional model provider. They are in the design (`docs/superpowers/specs/2026-10-06-mia-design.md`) and not built.

## 8. Open Source mini challenge

- **Contribution:** a new open-source repository, MIT licence, created during the hackathon window (the first commit is in October 2026). Mia's code, tests and docs are public.
- **Contribution URL / project repository URL:** `<repository URL>` (to be filled in at submission).
- **GitHub username:** `<GitHub username>` (to be filled in at submission).
- **What it is:** an MCP server for people living with dementia (16 tools over Streamable HTTP), a browser voice simulator that acts as an MCP client, a German and English phrase catalogue, an encrypted local store, and an alarm-email sink.
- **How it works:** the model picks a tool and fixed phrase ids; the server returns the spoken sentences from templates; the test suite includes a sweep of every tool answer over a week at nine times of day (over 1,000 answers per language) and long lists of pill and help phrasings in English and German.
- **Why it matters:** other developers building care or accessibility add-ons can reuse the "model picks, templates speak" pattern, the pill-safety rules and the alarm sink without having Alexa+ access.
