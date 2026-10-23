# Care Mode for Alexa+: a proposal

From the team behind **Mia**, built as an Alexa+ add-on (an MCP server) for people living with dementia (Build, Ship, Shape: Amazon Developer Hackathon, Alexa+ track). Written 2026-10-20. Persona in this document: **Rose Whitaker**, 81, fictional; her son and carer is **Tom**.

This is a feature proposal for Amazon's Alexa+ team. It describes things Alexa+ add-ons cannot do today. It is not a description of current Alexa+ behaviour. Mia's simulator implements all of it so the idea can be seen working.

## The short version

A person with dementia cannot be expected to remember a name, a phrase or a menu. Today an Alexa+ add-on is reached by name ("Alexa, open ...") and can only answer; it cannot start a conversation. For Rose that means a pill reminder only works if she remembers to ask for it, which is exactly what she cannot do.

Care Mode asks for three things:

1. **Nameless care topics.** A household can mark one add-on as its trusted care add-on. Requests on care topics (medication, "what day is it", "who is Tom", feeling anxious) reach it without its name being spoken.
2. **Proactive speech at agreed times.** The care add-on may ask Alexa to speak first at times the carer set (pill time, leave-for-group time, bedtime), always ending in a yes/no question.
3. **Carer-set limits.** The carer, not the add-on and not the person living with dementia, controls which topics, which times and how often.

## Why: Rose's day

Rose lives alone in a small house in Columbus, Ohio. She has an Echo Dot in the kitchen. Tom lives about two hours away.

- **8:00, pills.** Rose is unsure if she took her morning pills. Once, she took them twice. She will not say "Alexa, ask Mia whether I took my pills". She says "Did I take my pills?" or nothing at all. Today the question goes to Alexa's general answer, not to the add-on that knows the log.
- **Monday 9:35, group day.** She goes to a day club alone, a ten-minute walk. She asks "Is it group today?" five to ten times on Monday mornings. She forgets her keys. A reminder that starts by itself, at 9:25, "You leave for Maple Grove Day Club at twenty to ten. Shall I tell you what to take?", solves the thing she cannot remember to ask for.
- **Afternoons and evenings.** Anxiety and loneliness. A gentle "Hello, Rose. Shall we have a little chat?" at a time Tom agreed.
- **2:00 at night.** She wakes and thinks she must get ready for work. The right answer is the same calm sentence every time.
- **Any time.** If she says "I fell", something has to happen immediately, with no questions first.

Every one of these needs the assistant to **start** or to be **reached without a name**. Neither is available to a hackathon add-on, so we built both in our own simulator and want to show Amazon why they matter.

## What Care Mode would need

### 1. Nameless care topics

- The carer, in the Alexa app, picks one add-on as the household's **care add-on** and confirms the topics it covers (a fixed, short list: medication, day and appointments, people and family, comfort, calling the carer).
- For requests on those topics from the care person's voice profile or device, Alexa routes to the care add-on's tools without the add-on name.
- Alexa must not route other requests (shopping, general questions) to it.
- If routing is unsure, Alexa answers normally. It never forces a wrong route.

Why it matters: the name is the hardest thing for Rose to retain. Today's design guide lists named invocation as the primary activation. The lifecycle page mentions implicit invocation "through proactive or conversational discovery" without describing how; we could not verify how reliably a nameless request reaches an add-on.

### 2. Proactive speech at agreed times

- The care add-on declares **prompt slots** (for example "pill time", "leave time", "bedtime", "afternoon chat"). The carer approves the times.
- At a slot, Alexa speaks the add-on's sentence on the person's device and listens for a yes or no.
- Every proactive prompt ends in a **yes/no question** so Rose can answer without knowing anything. In Mia: "Now it's time for your morning pills. Have you taken your morning pills yet?"
- Today a carer can set an Alexa Routine to run a command at a fixed time. That is a workable workaround, but the carer has to build and maintain it per slot, and the content cannot change with the log (it would ask again after she already took the pills).
- Add-ons also cannot start a call or Drop In (Amazon staff answer on the hackathon forum), so the offer "Shall I ask Tom to call you?" ends in a message to Tom rather than a call. Allowing a care add-on to call one carer-approved contact would close the loop.

### 3. Carer-set limits and guardrails

- **Who sets it:** only the household owner or the named carer, in the Alexa app. The person living with dementia cannot switch it off by accident and the add-on cannot widen its own permissions.
- **Which topics:** a fixed allow-list; an add-on cannot register new nameless topics later without the carer approving again.
- **When:** time windows and a maximum number of proactive prompts per day (Mia's own rule: each prompt is spoken at most once).
- **Quiet hours:** no proactive prompt at night. Mia sends none between midnight and 5:00. At night Mia only answers when Rose speaks.
- **Visible to the carer:** a list of what was said proactively and what the add-on reported.
- **Off switch:** one clear switch that returns everything to normal Alexa+ behaviour.

## Privacy and safety guardrails

These are Mia's own rules; Care Mode should require them of any care add-on.

- **No medical advice.** Medication answers come only from the plan the carer entered and the log. A health question ("Can I take an aspirin?") gets "I can't answer that one. Let's ask Tom first." and Tom is emailed. In Mia, the model cannot write that sentence.
- **No made-up facts.** Every spoken fact comes from a tool result. The language model only chooses which tool to call and which fixed phrase (such as "Of course, Rose." or "Can I help with anything else?") to put before or after. No model-written text is spoken to the person.
- **A possible emergency always alerts.** "I fell", "Help", "too many pills" go to the carer at once, ahead of any model call, and ahead of reading the log. If the alert cannot be sent (when alarm email is configured), the person is told: "I couldn't reach Tom. Please call for help." She is never left with silence.
- **Not an emergency service.** Care Mode must not claim to call emergency services. The add-on alerts family.
- **Data minimisation.** Mia stores no audio and no transcripts. The only words of hers that are kept are those in a call for help or a health question (up to 200 characters) and an unknown name (80 characters), stored encrypted and emailed to the carer through Amazon SES. Sensitive fields are encrypted at rest (AES-256-GCM in the current build). Not everything stays on Mia's server: during a conversation, what she says and the tool results go to the language model provider (Featherless in this build), and in the browser simulator, speech recognition runs on the browser vendor's service (Chrome).
- **Consent and control.** Care Mode is set up by the carer with the person's agreement where possible. Care Mode should let the carer export and delete it (not built in Mia yet).
- **Honest limits.** Care Mode does not diagnose, does not track location and does not replace a person.

## How Mia demos it

The Mia simulator (a browser "Echo" connected to the Mia MCP server over Streamable HTTP) implements the three asks:

| Care Mode ask | In Mia |
|---|---|
| Nameless care topics | Every utterance goes to the brain, which always has Mia's 16 tools available. No name, no wake word inside a session. The model picks a tool: pills, day, group, people, comfort, night reassurance, health question, help, call request. |
| Proactive speech | The page asks `GET /api/proactive` every 20 seconds. The server answers with at most one unspoken prompt: pill time, leave-for-group (from 15 minutes before), welcome back from the group, bedtime, afternoon music, afternoon chat. Each ends in a yes/no question and is logged so it is spoken once. |
| Carer-set limits | The plan (medications and times, group days and leave-by time, bedtime, check-in time, favourite music) is the carer's profile data: a seed file in this demo, with a carer page planned. Quiet hours (00:00 to 05:00) and the prompt windows are fixed in code today. Nothing outside the plan is spoken. |

In the demo video, scenes 1 and 2 show Mia speaking first, with Rose saying nothing; scene 3 shows a nameless health question being routed and reported; the proposal is labelled **"Proposal, not current Alexa+ behaviour"** on screen.

## What we are not asking for

- No change to how other add-ons are invoked.
- No new access to the person's data for Amazon or for other add-ons.
- No always-on listening beyond what Alexa already does.

## Priority

**Important** for any add-on that serves a person who cannot learn or remember an invocation name (dementia, stroke, learning disability). The first ask (nameless routing) is the blocker; proactive speech is the second; carer controls are what make both safe.
