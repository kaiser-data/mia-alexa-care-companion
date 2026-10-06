# Research: Practical Implementation, Multilingual, Senior-Friendly Speech, Voice Testing

**Date:** 2026-10-06
**Feeds into:** [Mia design spec](../superpowers/specs/2026-10-06-mia-design.md)

---

## 1. Findings that change the plan

### 1.1 Hackathon participants do NOT get the Alexa+ developer tools
The hackathon FAQ states that the Alexa+ add-on tools (Category SDK, MCP Toolkit, `alexa-ai` CLI, Web Simulator) "are in preview and available to select partners only." Participants must "build a self-hosted MCP server (or Agent Skill) … and demo it via your own web-based simulator or front end." A "locally runnable public repo plus your demo video is enough — judges can download, build, and test it themselves." ([FAQ](https://amazonappdev2026.devpost.com/details/faqs))

**Consequence:** we cannot deploy to a real Echo. We build:
1. the **Mia MCP server** — spec-compliant, ready for Alexa+ when access opens, and
2. **our own "Alexa+ simulator" voice front end** that connects to it as an MCP client.

### 1.2 That is good news for language and seniors
Because we own the voice pipeline, we control **speech recognition, end-of-turn timing, voice, speaking speed and language** — none of which an Alexa+ add-on could control (Alexa+ phrases the reply itself; add-ons only return data — [conversation surface](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-conversation-surface.html)).

### 1.3 German works now
- Alexa+ itself launched in Germany/Austria in Early Access on 2026-05-07 ([Thurrott](https://www.thurrott.com/a-i/335775/alexa-launches-in-early-access-in-germany-and-austria), [teltarif](https://www.teltarif.de/en/alexaplus-deutschland-amazon/news/103392.html)), but the MCP Toolkit is documented as US-only / en-US ([overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html)).
- In our own simulator, German is a configuration value: Amazon Transcribe, Amazon Polly and Nova 2 Sonic all support de-DE.

### 1.4 Real Alexa+ invocation is by name — a risk for the real-device future
Amazon's design guide lists **named invocation** ("Alexa, open <name>") as the primary activation ([design guide](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-design-guide-overview.html)); the client lifecycle page also mentions implicit invocation "through proactive or conversational discovery" ([lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html)), and the simulator has a "Global" routing mode ([simulator](https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html)). How reliably Alexa+ routes "Did I take my pills?" to Mia without a name is **unverified**. For a person with dementia, a required name is a dealbreaker → ask at office hours (Oct 19) and record in the friction log.

### 1.4b Can the add-on start automatically?
- **Not documented for Alexa+ add-ons.** "Implicit … proactive or conversational discovery" is mentioned once, without mechanism. Classic Alexa skills had **Name-Free Interaction** (NFI toolkit, CanFulfillIntentRequest) ([NFI](https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html)); no add-on equivalent is documented.
- **Routines** can trigger actions at a time without voice input; classic skills could expose "custom tasks" to Routines ([Routines Kit](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2023/10/routines-kit-ga-alexa-october-2023)). For add-ons, a carer-made routine with a custom command is the practical workaround.
- **Add-ons cannot initiate calling or Drop In** (Amazon staff answer, [forum](https://amazonappdev2026.devpost.com/forum_topics/45199-alexa-mcp-can-an-add-on-initiate-alexa-to-alexa-calling-or-drop-in)). The same answer allows demonstrating functionality beyond current capabilities in submissions.
- **Consequence:** Mia Voice implements nameless routing + proactive prompts; the spec proposes **"Care Mode" for Alexa+** (trusted add-on per household, proactive prompts, care contact handoff, senior speech profile) as product feedback.

### 1.5 Other Alexa+ facts worth keeping
- Alexa+ client initializes with protocol version `2025-03-26`, sends `tools/call`, reads `structuredContent` + `content[type=text]`; no session id — context comes from conversation history ([lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html)). → Our server must accept both `2025-03-26` and `2025-11-25`.
- Requirements: Streamable HTTP, < 500 ms, remote URL, OAuth 2.1 + PKCE S256 ([quickstart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)).
- Certification requires Alexa accessibility features support (VoiceView, Captions, Magnifier) ([certify](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-certify.html)).
- Local Inspector (`@alexa-ai/addon-local-inspector`, Node 24+) produces `certification-verdict.json` — but is preview-gated too ([inspector](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html)). We use the open **MCP Inspector** instead.
- Real Alexa already has "Alexa, speak slower" — 7 speeds, built for older and hard-of-hearing users ([Amazon](https://www.aboutamazon.com/news/devices/alexa-speak-slower)). We mirror this.

---

## 2. Voice pipeline options for the simulator

| | **A. Cascade (recommended)** | B. Nova 2 Sonic speech-to-speech |
|---|---|---|
| Chain | Amazon Transcribe streaming → Claude on Bedrock (MCP client) → Amazon Polly neural | One bidirectional stream, built-in tool use |
| German | ✅ de-DE in all three | ✅ voices `tina`, `lennart`; polyglot `tiffany`/`matthew` ([docs](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-language-support.html)) |
| End-of-turn control | ✅ our own silence timeout (calibratable) | ✅ configurable pause before end of turn ([AWS](https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-nova-sonic-language-support-french-italian-german/)) |
| Speaking speed | ✅ SSML `<prosody rate>` + `<break>` on neural voices (**not** on generative voices — [Pipecat/AWS](https://docs.pipecat.ai/server/services/tts/aws)) | ⚠️ only via prompt, not guaranteed |
| Exact wording of safety-critical answers | ✅ we can speak server text verbatim | ⚠️ model re-voices it |
| Custom vocabulary (Tom, Maple Grove) | ✅ Transcribe custom vocabulary | ⚠️ none documented |
| Testability per stage | ✅ ASR, tool choice, TTS measured separately | ⚠️ end-to-end only |
| Latency | ~1.5–3 s (fine for seniors) | lower |
| Limits | — | 8-min connection limit ([docs](https://docs.aws.amazon.com/de_de/nova/latest/nova2-userguide/using-conversational-speech.html)) |

**Recommendation: A (cascade).** Control and measurability matter more than speed for this user group. Nova 2 Sonic stays as a stretch comparison mode.

**Judge-friendly fallback:** a clearly labeled "no-AWS mode" using the browser Web Speech API so judges can run the repo without AWS credentials. Labeled as lower quality in the UI and README — never presented as the real pipeline.

---

## 3. Speaking for older listeners

### Evidence
- Speak **clearly and slightly slower, but keep natural rhythm** — exaggerated slowness hurts comprehension; use **short, right-branching sentences**; **verbatim repetition** helps; give **extra time** to respond ([NCBI: communication needs of an aging society](https://www.ncbi.nlm.nih.gov/books/NBK97337/), [GSA guide](https://www.lasell.edu/Documents/talk-of-ages/GSA_Communicating-with-Older-Adults-low-Final.pdf)).
- Don't shout or over-exaggerate ([Alzheimer's Society](https://www.alzheimers.org.uk/about-dementia/stages-and-symptoms/dementia-symptoms/communicating-dementia-sensory-impairment)).
- Voice assistants for older users: **filter information** to avoid overload; in a dementia-specific voice assistant, **adjusting the pauses** between user input and the assistant's voice improved usability ([CUE-D, PMC12742637](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12742637/), [review, UAIS 2026](https://link.springer.com/article/10.1007/s10209-026-01352-5)).

### Mia speaking rules (become testable requirements)
1. **Max 2 sentences per turn, max ~12 words per sentence**, one idea per sentence.
2. **Key fact first, repeated at the end**: "Today is Monday. … It's a group day. Yes — Monday."
3. **Speaking rate 85–90 %** by default (SSML), **600–800 ms breaks** between sentences; adjustable per person (§5).
4. **Times spoken the human way**: "half past two" / "halb drei", never "14:30".
5. **Her name and her people's names**, never pronouns for people ("Tom calls at seven", not "he calls").
6. **Same wording every time** for critical facts: date, medication, safety. These come from **server templates** (per language), spoken **verbatim** — the LLM may only add a short warm lead-in.
7. **"Pardon?" always works**: "What?", "Say that again", "Wie bitte?" → repeat last answer verbatim, 10 % slower.
8. **Never**: "you already asked", lists > 2 items, jargon, irony, questions with more than two options.
9. **Questions back to her are yes/no only.**
10. Voice: a **lower-pitched, warm neural voice** chosen per language after listening tests (age-related hearing loss affects high frequencies first — to be checked with the carer, not assumed).

### Plain-language levels (per profile)
- `simple` — rules above.
- `very_simple` — 1 sentence, ~8 words, always followed by the core fact again.
German follows *Einfache Sprache* conventions (short main clauses, no passive, no genitive).

---

## 4. Listening to older voices (speech recognition)

### Evidence
- ASR word error rate for older voices (60–85) is about **10 % absolute higher** than for adults ([Edinburgh](https://www.research.ed.ac.uk/en/publications/automatic-speech-recognition-for-ageing-voices/)).
- For speakers with dementia, mean WER ranged **22.9–44.4 %**, consistently higher than controls; **intensity, voice quality and pause ratio** predicted accuracy ([ACM CHI 2026, 10.1145/3772318.3791581](https://dl.acm.org/doi/10.1145/3772318.3791581); [Research Square](https://www.researchsquare.com/article/rs-9892520/latest.pdf)).
- Cognitively normal older adults WER 0.15–0.34 vs cognitively impaired 0.23–0.34 ([Research Square](https://www.researchsquare.com/article/rs-8824529/v1)).

**Take-away:** expect **1 in 4 to 1 in 3 words wrong**. The design must work *despite* errors, not assume they won't happen.

### Mia listening rules
1. **Long, calibrated end-of-turn timeout** (start 1.8 s, range 1.2–3.0 s). Never cut her off mid-thought.
2. **No wake word needed in the simulator** (always-listening in a session, or one big tap target) — and in real-Alexa terms, no add-on name.
3. **Custom vocabulary generated from her profile** (people, places, medication descriptions, group name) → Transcribe custom vocabulary per language.
4. **Meaning over words**: the LLM gets the n-best transcript + confidence; vague or broken sentences are fine.
5. **Low confidence → one yes/no check**, never "I didn't understand": "Do you mean your pills?"
6. **Two misses → safe default**: give today's summary and offer to call Tom. No dead ends.
7. **Distress words are matched twice**: by the LLM and by a keyword list per language ("help", "fallen", "Hilfe", "gestürzt") — a missed distress signal is the worst failure.

---

## 5. Automated calibration

A **3-minute calibration**, started by the carer from the carer page, with Rose at the device.

| Step | What happens | What gets set |
|---|---|---|
| 1. Hearing | Mia says the same sentence at 3 speeds and 2 voices. Carer taps which Rose understood best (or Rose says "the second one"). | `speechRate`, `voiceId` |
| 2. Speaking | Rose repeats 10 short phrases after Mia ("Did I take my pills?", "Who is Tom?", …). | — |
| 3. Measure | Per phrase: input level, speaking rate, **pauses inside the phrase**, ASR transcript vs. expected, confidence. | `endOfTurnTimeoutMs` = p95 inner pause + 600 ms (clamped 1.2–3.0 s); mic gain hint; `confidenceThreshold`; misheard words → custom vocabulary |
| 4. Report | Carer sees a one-screen result: "Recognized 8/10. Adjusted: wait longer (2.2 s), slower voice (85 %)." | saved to profile |

**Privacy:** calibration audio is processed in memory and **discarded**; only the numbers are stored (matches "no recordings").

**Continuous drift check** (no audio stored, events only): rising rate of "pardon?" → suggest slower speech; rising low-confidence turns or repeated retries → suggest re-calibration; shown in the daily summary.

---

## 6. Automated voice testing ("senior speech test bench")

### Test corpus
- ~40 intents/utterances per language (en-US, de-DE) × variants: plain, **vague** ("the thing… the pills"), **disfluent** ("um, is it… is it Monday"), **repeated**, **wrong word** ("my club" for group), **distress**.
- Expected outcome per item: tool name, required facts, forbidden content.

### Audio generation (synthetic, reproducible, no real person's voice)
Generate each utterance with Amazon Polly in several voices, then apply transforms with ffmpeg:
- slower rate (SSML 70–85 %), **inserted pauses 0.8–3 s** mid-sentence
- **lower volume** (−12 dB), **kitchen/TV noise** at 10–20 dB SNR, room reverb
- **voice tremor** (vibrato/tremolo filters), slight pitch drop
Each transform is a test dimension, so the report shows *which condition breaks what*.

**Honest limit:** synthetic speech is not real older speech. It catches regressions and timeout bugs, not true accuracy. True accuracy needs consented real recordings — the calibration run (§5) provides that per user, with audio discarded. Research corpora such as DementiaBank are licensed for research and **must not** go into the public repo.

### Measured per run
| Stage | Metric | Gate (initial) |
|---|---|---|
| ASR | WER per condition | report only, track trend |
| End-of-turn | % utterances cut off early | **0 %** for pauses ≤ calibrated timeout |
| Understanding | correct tool chosen | ≥ 90 % clean, ≥ 75 % hardest condition |
| Facts | answer facts match profile (checked against seed data) | 100 % |
| Safety | no medical advice, no "already asked", distress → alarm | **100 %** |
| Language | words per sentence, sentences per turn | ≤ 12 / ≤ 2 |
| Latency | speech end → audio start | p95 < 3 s |

### Where it runs
- **Every push (GitHub Actions):** text-level tests — tool selection, facts, safety, plain-language checks (no audio, cheap).
- **Nightly / on demand:** full audio bench against AWS; writes a **local HTML report** (WER heatmap: condition × intent).

---

## 7. Multilingual design

- `profile.language` (`en-US` | `de-DE`) drives Transcribe, Polly voice, LLM system prompt, templates, number/time formatting.
- **Critical templates per language**, reviewed by a native speaker (German: the project author).
- **Family content is never translated** — spoken as entered.
- **Language fallback:** Transcribe language identification can detect if she switches to her first language → answer in that language, notify carer in summary. (People with dementia often lose later-learned languages first.)
- Carer page labels: en + de.
- Adding a language = templates + voice id + vocabulary file; no code change.

---

## 8. Recommended architecture (updated)

```
 Browser "Echo" simulator (big ring, captions optional)
     │ mic audio / audio out (WebSocket)
     ▼
 Voice gateway (Node/TS)
   ├─ Amazon Transcribe streaming  (locale, custom vocabulary, calibrated end-of-turn)
   ├─ Orchestrator: Claude on Amazon Bedrock = "Alexa+ stand-in", MCP CLIENT
   │        │  MCP over Streamable HTTP (same as Alexa+ would use)
   │        ▼
   │   Mia MCP server  ──▶ DynamoDB (KMS) · alarms (SES/SNS) · summary (Bedrock)
   └─ Amazon Polly neural  (SSML rate/breaks; verbatim templates for critical facts)

 Carer web page ── calibration wizard · plan · alerts · summary · test-bench report
```

The Mia MCP server is unchanged in role: it is the real product and stays ready for Alexa+. It can also be connected to any MCP client (e.g. Claude Desktop) to show interoperability.

---

## 9. Scope impact (17 days, one developer)

Adding a voice front end, calibration and a test bench is significant. Proposed cuts:
- **Move to stretch:** Amazon Connect phone call, Nova 2 Sonic mode, MCP Apps widget, multiple carer roles, passkeys.
- **MVP calibration** = steps 1–3 with fixed phrase list; drift check = stretch.
- **MVP test bench** = text-level CI + audio bench for 3 conditions (clean, slow+pauses, noise); others stretch.
- **German** moves from stretch to **MVP** (cheap now, strong impact story).

---

## 10. Open questions

1. Office hours Oct 19: does real Alexa+ route nameless requests to an add-on reliably? Any de-DE plan for the MCP Toolkit?
2. Which German and English neural voices are clearest for Rose-like listeners? → listening test with the author's family (no recordings stored).
3. Should a judge-runnable demo need AWS at all? → recommend: AWS for full mode, labeled Web Speech fallback for zero-setup.
