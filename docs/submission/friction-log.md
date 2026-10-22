# Friction log: Mia (Alexa+ add-on for dementia care)

Project: **Mia**, an MCP server plus a browser voice simulator, for the Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ track). Persona: Rose Whitaker (fictional), carer Tom.

Format per the Devpost rules: task attempted, steps taken, expected vs actual, severity, workaround, suggestion. Severity: **Blocker** (cannot do the thing), **Major** (large detour or a design change), **Minor** (annoying, cheap to fix).

Entries marked *first-hand, 2026-10-20* happened in our own session this week. Entries marked *docs/research* come from reading Amazon's documentation and the hackathon pages in October 2026 (sources are named in each entry). An entry says "not verified" where we could not confirm something.

## Summary

| # | Entry | Severity |
|---|---|---|
| 1 | Hackathon participants cannot get the Alexa+ add-on tools | Blocker |
| 2 | MCP Toolkit is en-US only; a German Alexa+ user cannot be served | Blocker (for German) |
| 3 | Alexa+ Echo does not run an in-development classic skill ("not supported on this device") | Blocker (for the device demo) |
| 4 | Developer console shows the template's example phrase, not our invocation name | Minor |
| 5 | A person with dementia cannot be expected to say an add-on name; nameless routing is undocumented | Major |
| 6 | Add-ons cannot speak first, call or Drop In | Major |
| 7 | LLM tool-pick reliability differs widely between models | Major (solved in design) |
| 8 | Setup pages for the add-on tools do not say they are partner-only | Minor |
| 9 | Hackathon pages return HTTP 403 to non-browser clients | Minor |

---

## 1. Hackathon participants cannot get the Alexa+ add-on tools

*docs/research, confirmed by the hackathon FAQ. First-hand effect on 2026-10-20: no way to test on a device or in Amazon's simulator.*

- **Task:** run Mia as a real Alexa+ add-on and test it with Amazon's tools.
- **Steps:** read the add-on docs (MCP Toolkit quickstart, local inspector, Web Simulator); looked for an application route for the Category SDK, MCP Toolkit, `alexa-ai` CLI and Web Simulator; read the hackathon FAQ.
- **Expected:** a way to register or at least test a self-hosted MCP server against Alexa+.
- **Actual:** the FAQ says these tools "are in preview and available to select partners only - there is currently no way for hackathon participants to apply for or gain access." Participants must "build a self-hosted MCP server ... and demo it via your own web-based simulator or front end." The local inspector (`@alexa-ai/addon-local-inspector`, which writes `certification-verdict.json`) is preview-gated too, so we have no certification check.
- **Severity:** Blocker for device testing; the rules provide a workable path.
- **Workaround:** a spec-compliant MCP server (Streamable HTTP, protocol 2025-11-25, also accepts 2025-03-26 because the documented Alexa+ client sends it) plus our own browser simulator that acts as the MCP client (initialize, tools/list, tools/call). We use the open-source MCP Inspector for server checks.
- **Suggestion:** a "sandbox" tier for hackathon participants: a hosted web simulator that can be pointed at a public MCP URL, with no certification and no publishing. That alone would let hackathon projects be tested against Alexa+'s real routing, which is the part we could not test.

## 2. MCP Toolkit is en-US only; a German Alexa+ user cannot be served

*docs/research (MCP Toolkit overview) and first-hand on 2026-10-20.*

- **Task:** serve a German-speaking user with the add-on. Alexa+ launched in Germany and Austria in Early Access on 2026-05-07.
- **Steps:** checked the MCP Toolkit overview for locales; then tried the German route in entry 3.
- **Expected:** the add-on toolkit available where Alexa+ is.
- **Actual:** the toolkit documentation is US and en-US only. A German household on Alexa+ has no way to use an add-on.
- **Severity:** Blocker for any non-English family. People with dementia often lose later-learned languages first, so the language matters more for them, not less.
- **Workaround:** the simulator supports English and German through templates (a language is a set of sentence templates, a voice and a vocabulary). The video shows German in 20 seconds.
- **Suggestion:** a roadmap statement for de-DE (and other Alexa+ locales). If an MCP add-on cannot ship in a locale yet, say so in the Alexa+ docs for that locale.

## 3. Alexa+ Echo does not run an in-development classic skill

*first-hand, 2026-10-20.*

- **Task:** reach Mia from a real Echo Dot in Germany as a bridge while add-ons are closed.
- **Steps:** built a classic German custom skill (`packages/voice/src/alexa.ts`, interaction model `packages/voice/alexa/de-DE.json`, invocation name "meine Mia"); it sends each utterance to the same Mia brain; verified request signatures for our skill id only; used a tunnel for the HTTPS endpoint. Tested "Alexa, öffne meine Mia".
- **Expected:** the skill in the *development* stage runs on the developer's own Echo, as it did on classic Alexa.
- **Actual:** it works in the Alexa developer console simulator. On an Echo Dot on Alexa+ in Germany, Alexa answers that the skill is "not supported on this device".
- **Severity:** Blocker for the device demo; a German Alexa+ user cannot be served today (neither by an add-on, entry 2, nor by a classic skill).
- **Workaround:** none for Alexa+. We keep the skill as a documented partial path (it works in the console and presumably on non-Alexa+ Echos; not verified on a non-Alexa+ device) and demo in our simulator.
- **Suggestion:** tell the developer in the console when a skill will not run on Alexa+ devices (a clear banner on the Test tab), and document which skill types run on Alexa+. A developer should not find out on a device.

## 4. Developer console shows the template's example phrase

*first-hand, 2026-10-20.*

- **Task:** see the right invocation phrase while testing the skill.
- **Steps:** set the invocation name to "meine Mia" in the skill's interaction model; built the model; opened the Test tab.
- **Expected:** the console suggests "Alexa, öffne meine Mia".
- **Actual:** the console showed the template's example phrase "Alexa, öffne hallo welt" although the invocation name was set correctly (the skill itself answered to the right name).
- **Severity:** Minor, but confusing when a tester follows the on-screen hint and gets nothing.
- **Workaround:** ignore the hint and say the name that was set.
- **Suggestion:** build the example phrase from the saved invocation name, or hide it when it does not match.

## 5. Nameless routing for a person who cannot learn a name

*docs/research (design guide, client lifecycle page). Not verified on a device.*

- **Task:** let Rose say "Did I take my pills?" and reach Mia without "Alexa, open Mia".
- **Steps:** read the design guide and the client lifecycle docs.
- **Expected:** a documented way for an add-on to be chosen implicitly, or at least a description of how implicit invocation works.
- **Actual:** the design guide leads with named invocation. The lifecycle page mentions implicit invocation "through proactive or conversational discovery" once, without a mechanism. The Web Simulator has a "Global" routing mode (documented), but we could not use it. We could not verify how reliably a nameless request reaches an add-on.
- **Severity:** Major. For someone with dementia a required name defeats the product.
- **Workaround:** in Mia Voice every utterance reaches Mia's tools without a name. On real Alexa+, a carer-built Routine can run a fixed command at pill time.
- **Suggestion:** document implicit invocation, and add the Care Mode proposal (`care-mode-proposal.md`): a household-chosen care add-on that receives care topics without being named.

## 6. Add-ons cannot speak first, call, or Drop In

*docs/research (Amazon staff answer on the hackathon forum).*

- **Task:** let Mia say "Now it's time for your morning pills" at 8:00, and offer "Shall I ask Tom to call you?".
- **Expected:** a way for an add-on to schedule a spoken prompt and start a call to an approved contact.
- **Actual:** not documented for Alexa+ add-ons. Amazon staff said an add-on cannot initiate Alexa-to-Alexa calling or Drop In; the same answer allows submissions to demonstrate functionality beyond current capabilities. Routines can run a command at a time and are the workaround.
- **Severity:** Major for care use: the person must not have to start the conversation.
- **Workaround:** Mia Voice speaks first through a proactive endpoint; the "call" ends as an alert email to Tom.
- **Suggestion:** a carer-approved proactive slot and a carer-approved call contact for a care add-on (see the Care Mode proposal).

## 7. LLM tool-pick reliability differs widely between models

*first-hand, 2026-10-12 to 2026-10-20 (our own probes; not an Amazon issue, recorded because anyone building an agent that calls tools will hit it).*

- **Task:** choose a model that reliably calls the right Mia tool for a spoken question.
- **Steps:** a probe of eight hard turns in English and German (sequential, same server), repeated; models run through Featherless's OpenAI-compatible endpoint.
- **Expected:** every model that supports tool calling picks "get_medication_status" for "Did I take my pills?".
- **Actual:**
  - `openai/gpt-oss-120b`: right tool 15 of 15 across two runs, 3 to 5 seconds per turn.
  - `moonshotai/Kimi-K2-Instruct-0905`: faster, but 5 of 8; it answered both pill questions without calling the pill tool.
  - Kimi-K3 4 of 8 (also missed pills); GLM-4.7 hit our 10-second deadline on every turn; Kimi-K2.6 timed out; Llama-3.3-70B returned HTTP 403 (gated); Mistral-Large-2411 returned HTTP 400 on the second step (our message format).
  - gpt-oss-120b used its whole token budget on reasoning in one German turn ("stopped: length"); sending `reasoning_effort: "low"` fixed it.
- **Severity:** Major for a safety-critical domain; the pill answer cannot depend on a model's mood.
- **Workaround / design answer: "Claude picks, doesn't write."** The model only chooses tools and fixed catalogue phrase ids. It writes no sentence that is spoken. All facts and safety sentences come from server templates, spoken verbatim. Pill questions that match a deterministic detector take a direct route to the pill tool with no model call; "I fell" goes straight to the alarm.
- **Suggestion:** for add-on authors: publish a recommended pattern and a small tool-routing test suite so developers can check their tool descriptions against the platform's model before shipping.

## 8. Setup pages do not say the tools are partner-only

*docs/research, from the hackathon FAQ.*

- **Task:** follow the add-on setup guide.
- **Actual:** the FAQ says the preview notice is on the add-on docs home page but "sometimes missing from individual setup-guide pages, which has caused some confusion." A developer who starts from a setup page can spend time before finding out.
- **Severity:** Minor, but it can cost a day.
- **Suggestion:** a banner on every setup page of a gated product.

## 9. Hackathon pages return HTTP 403 to scripted clients

*first-hand, 2026-10-20.*

- **Task:** read the rules and FAQ pages from a script to extract the requirements.
- **Actual:** a plain fetch returned 403 Forbidden for both pages; the same request with a browser User-Agent returned the page.
- **Severity:** Minor.
- **Suggestion:** none needed beyond awareness; the rules are in the page and in the Devpost form.

---

## What worked well (for the record)

- The hackathon FAQ was specific and fast to act on: it said plainly that the tools are gated and that a web page acting as a real MCP client satisfies the Alexa+ requirement.
- The Alexa+ docs on the client lifecycle are concrete: protocol version `2025-03-26`, `structuredContent` plus a `text` content item, no session id. That let us make the server accept both documented versions and keep responses small.
- The rules allow an Alexa+ submission as a self-hosted MCP server demonstrated in a simulator, with a locally runnable public repository enough for judging.
