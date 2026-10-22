# Mia: demo video script (under 3:00)

Target length **2:50**. The rules say the video "should be less than three (3) minutes" and judges "are not required to watch beyond three minutes". Upload to YouTube or Vimeo, public. No third-party trademarks or copyrighted music (no Alexa logo, no Ella Fitzgerald audio: when Mia plays music, cut the audio or keep it under 2 seconds of silence).

Everything on screen is fictional: **Rose Whitaker** (81, lives alone in Columbus, Ohio) and her son and carer **Tom**. No real names, no real inbox contents.

Every line Mia says below is a line the software can say. The sentences come from the catalogue in `packages/shared/src/i18n/templates.ts` and `phrases.ts`, and the profile in `packages/shared/src/seed/rose.ts`. The language model only picks which tool runs and which catalogue phrase ids come before or after; it writes no text. When a take shows a short extra lead-in ("Of course, Rose.", "Let me see.", "I'm glad.", "Thank you.") or a closing yes/no question ("Can I help with anything else?", "Shall I ask Tom to call you?"), that is the catalogue too. Keep it, or re-take. Plain pill questions and cries for help take a direct route; other turns ("I took them.", "Yes.", "And then?") go through the model. If the wrong tool answers, re-take.

## Setup (once)

| What | Value |
|---|---|
| Browser | Chrome (speech recognition and voice need it). Full screen, window about 1280x720, system volume up, quiet room. |
| Profile | `MIA_PROFILE=rose` (scenes 1 to 5), `MIA_PROFILE=rose-de` (scene 6) |
| Data | a **fresh `MIA_DATA_DIR` for every take**, for example `MIA_DATA_DIR=.mia-data/take-1a`. Never reuse a directory: earlier pills would change the answers. |
| Clock | `MIA_CLOCK_START=<ISO time with offset>` per scene, see below. The clock starts at that time and then runs on in real time. |
| Model | `LLM_PROVIDER=featherless` (default model `openai/gpt-oss-120b`) with `FEATHERLESS_API_KEY` from the secret store, or `anthropic`. Never show the key or `.env`. |
| Alarm email | start the server with `MIA_ALERT_EMAIL_TO` and `MIA_ALERT_EMAIL_FROM` set (Amazon SES, instance role on AWS). Open Tom's inbox in a second window and keep it ready for scenes 3 and 5. Run locally with AWS credentials for SES exported in the shell (never on screen), or on the Frankfurt EC2 instance (`MIA_PUBLIC_ORIGIN` set). The recipient must be SES-verified while the account is in the sandbox. |
| Date | **Monday 2026-10-26** is a group day (Rose goes Monday, Tuesday, Thursday). New York is still on summer time on that date (offset `-04:00`; clocks change on 2026-11-01), so the offsets below are right. |

Record on the Frankfurt EC2 instance if you can: then the closing slide is true as it stands. Deploy the current build first (`deploy/aws/deploy.sh`). For each take, on the server (the clock starts when `mia` restarts, so restart right before the take):

    printf 'MIA_PROFILE=rose\nMIA_DATA_DIR=.mia-data/take-1a\nMIA_CLOCK_START=2026-10-26T07:59:40-04:00\n' | sudo tee /etc/mia/take.env >/dev/null && sudo systemctl restart mia

then open `https://<ip-dashes>.sslip.io` (basic auth), tap the circle once, and talk. `/etc/mia/take.env` overrides `/etc/mia/mia.env`. After the last take: `sudo rm /etc/mia/take.env && sudo systemctl restart mia`.

Start command pattern (local, if you record on your own machine):

    MIA_PROFILE=rose MIA_DATA_DIR=.mia-data/take-1a MIA_CLOCK_START=2026-10-26T07:59:40-04:00 pnpm dev

then open `http://127.0.0.1:8788`, tap the circle once, and talk. Keep the optional captions on so viewers can read what Mia says.

Timing notes for recording:

- The page asks Mia "do you want to speak first?" every 20 seconds. After the clock passes the trigger time, Mia speaks within about 20 seconds. Cut the wait in the edit.
- Mia's first-speaking prompt for pills opens **at the dose time** (08:00), not before. That is why scene 1 starts the clock at 07:59:40 and not at 07:58. There is no on-page clock: add a caption "Monday, 8:00".
- Each scene is its own take with its own data directory and its own `MIA_CLOCK_START`. Cut them together.

## Scenes

### 0. Opening (0:00 to 0:12), caption and voice-over

Screen: the Mia page, big circle, caption "Rose, 81, lives alone with Alzheimer's. Her son Tom lives two hours away."

Voice-over (author):
"Mia is built as an add-on for Alexa Plus, by a carer for his mother, who lives with dementia. Rose never has to learn a name or a command. Mia knows her day, her pills and her people, and tells Tom when something is wrong. This is our own simulator of Alexa Plus, because the Alexa Plus tools are closed to hackathon participants."

### 1. Morning pills, Mia speaks first (0:12 to 0:55)

`MIA_PROFILE=rose` `MIA_CLOCK_START=2026-10-26T07:59:40-04:00`

Screen: the circle, captions on. Tap once. Do not say anything.

| Who | Line |
|---|---|
| Mia (speaks first, at 8:00) | "Now it's time for your morning pills. Have you taken your morning pills yet?" |
| Rose | "Did I take my pills?" |
| Mia | "Now it's time for your morning pills. That's the small white pill and the round pink one." |
| Rose | "I took them." |
| Mia | "Thank you. I've noted your morning pills." |
| *(about 30 seconds later, cut the wait)* Rose | "Did I take my pills?" |
| Mia | "You took your morning pills at about eight o'clock. No more pills needed now. Your next pills are at eight o'clock in the evening." |

Say "I took them" within the first two minutes after 8:00. Mia says the time rounded to five minutes and puts "about" in front of it unless the minute is exactly :00 (at 8:03 or 8:04 she says "about five past eight"). Both are fine; just do not re-record the line.

If you want the stronger moment, add a second "I took them." instead of the question. Mia answers: "You took your morning pills at about eight o'clock. No more pills needed now." Either way the point is the same: **no double dose**, said kindly, never "you already asked".

Caption: "Answers come from the log Tom's plan creates, never from the model."

### 2. A group day: leave-by reminder, checklist, weather (0:55 to 1:20)

`MIA_PROFILE=rose` `MIA_CLOCK_START=2026-10-26T09:34:45-04:00`

| Who | Line |
|---|---|
| Mia (speaks first, from 9:25 on) | "You leave for Maple Grove Day Club at twenty to ten. Shall I tell you what to take?" |
| Rose | "Yes." |
| Mia | *(only if it is cold or rainy in Columbus on that date)* "It's cold today. Wear your warm coat." or "It may rain today. Take your umbrella." Then: "Take your keys on the red lanyard and your handbag." |
| Rose | "And then?" |
| Mia | "Take your glasses and your coat." |

The weather line comes from the Open-Meteo forecast for Columbus on the simulated date (Monday 2026-10-26), with a 250 ms timeout. If that day is mild, or the lookup is slow, there is no weather sentence, which is correct. If there is none, say so in the voice-over ("on a cold day she also hears a weather line"). Do not fake it.

Caption: "She never said 'Mia'. She never said 'group'. Mia spoke first and asked a yes or no question."

### 3. A health question: Mia does not answer, Tom is told (1:20 to 1:45)

`MIA_PROFILE=rose` `MIA_CLOCK_START=2026-10-26T14:20:00-04:00`

| Who | Line |
|---|---|
| Rose | "Can I take an aspirin?" |
| Mia | "I can't answer that one. Let's ask Tom first." |

Cut to Tom's inbox. An email arrives within seconds:

- Subject: `[Mia] Rose has a health question: "Can I take an aspirin?".`
- The words in quotes are what the model passed as her words; they may differ slightly.
- Body: the same sentence, then "Rule: health_question", "Severity: medium", the time, and "Sent by Mia (local mode, not production)."

Caption: "Mia never gives medical advice. It says so, and it tells Tom."

### 4. Two in the morning (1:45 to 1:58)

`MIA_PROFILE=rose` `MIA_CLOCK_START=2026-10-27T02:00:05-04:00`

Ask within 50 seconds; from 02:01 Mia says "about two o'clock" (also correct, but not this line).

| Who | Line |
|---|---|
| Rose | "Is it morning?" |
| Mia | "It's two o'clock, in the middle of the night. You're safe at home. You can go back to sleep." |

Caption: "At night, a confused question gets the same calm answer, every time."

### 5. "I fell" (1:58 to 2:15)

`MIA_PROFILE=rose` `MIA_CLOCK_START=2026-10-26T16:10:00-04:00`

| Who | Line |
|---|---|
| Rose | "I fell." |
| Mia | "I've let Tom know right away. Tom will get in touch with you." |

This goes straight to the alarm: no language model in the path, no questions first. Cut to Tom's inbox:

- Subject: `[Mia] URGENT: Rose asked for help: "I fell.".` (punctuation as recognised)
- Body: the same sentence, "Rule: distress", "Severity: high", the time.

Voice-over: "If the email cannot be sent, Mia says so: 'I couldn't reach Tom. Please call for help.' She is never left with silence."

### 6. German in 20 seconds (2:15 to 2:35)

`MIA_PROFILE=rose-de` `MIA_CLOCK_START=2026-10-26T08:00:30-04:00` (the page language follows the profile: speech recognition and voice switch to German)

| Who | Line |
|---|---|
| Mia (speaks first) | "Jetzt ist Zeit für deine Morgentabletten. Hast du deine Morgentabletten schon genommen?" |
| Rose | "Ich habe sie genommen." |
| Mia | "Danke. Ich habe deine Morgentabletten notiert." |
| Rose | "Hilfe, ich bin gestürzt." |
| Mia | "Ich habe Tom sofort Bescheid gegeben. Tom meldet sich bei dir." |

Caption (English): "The same Mia in German. Alexa Plus add-ons are English (en-US) only today; in our simulator, a new language is a set of templates."

### 7. Architecture, Care Mode proposal, AWS (2:35 to 2:50), two slides

Slide A (about 8 seconds): the architecture diagram.

    Rose speaks  ->  browser "Echo" simulator (Chrome speech, no wake word)
                 ->  Mia Voice gateway  (LLM picks a tool + catalogue phrases)
                 ->  Mia MCP server     (Streamable HTTP, MCP 2025-11-25)
                 ->  encrypted store    (SQLite, AES-256-GCM)
                 ->  alarm email        (Amazon SES)
    Runs on one EC2 instance in Frankfurt (eu-central-1), HTTPS by Caddy.

If the takes were recorded locally, the last slide line reads "Also runs on one EC2 instance in Frankfurt (eu-central-1), HTTPS by Caddy."

Voice-over: "The Mia server is a real MCP server over Streamable HTTP, built to the documented Alexa Plus client behaviour. The simulator is an MCP client. The language model picks tools and phrase ids and writes nothing. Mia runs on one server on AWS in Frankfurt, and alarms go out through Amazon SES." If the takes were recorded locally, say instead: "The same build runs on one server on AWS in Frankfurt, and alarms go out through Amazon SES."

Slide B (about 7 seconds), labelled **"Proposal, not current Alexa+ behaviour":**

1. Care topics reach a trusted add-on without its name.
2. The add-on may speak first at agreed times.
3. Carer-set limits on both.

Voice-over: "What you saw, Mia speaking first and being reached without its name, is not possible in Alexa Plus add-ons today. We built it in the simulator and wrote it up as a Care Mode proposal for Amazon. Code, license and setup are in the repository."

End card: project name, `<repository URL>`, "Fictional persona: Rose Whitaker".

## Running order and time budget

| Scene | Start | Length |
|---|---|---|
| 0 Opening | 0:00 | 0:12 |
| 1 Morning pills | 0:12 | 0:43 |
| 2 Group day | 0:55 | 0:25 |
| 3 Health question + email | 1:20 | 0:25 |
| 4 Night | 1:45 | 0:13 |
| 5 "I fell" + email | 1:58 | 0:17 |
| 6 German | 2:15 | 0:20 |
| 7 Architecture + Care Mode | 2:35 | 0:15 |

Total about 2:50. If a take runs long, shorten scene 1's second question first, then scene 2's "And then?".

## Pre-flight checklist

- [ ] Fresh `MIA_DATA_DIR` per take; `MIA_PROFILE` and `MIA_CLOCK_START` as listed.
- [ ] The startup log names the model and provider, never a key. No key, token or `.env` visible on screen.
- [ ] Terminal not on screen: the startup log prints the alert recipient address.
- [ ] Tom's inbox: only these two alarm emails visible; no real address in view (use a test inbox).
- [ ] Captions on; sound is clear; browser tab shows no other tabs or bookmarks.
- [ ] No Alexa logo, no copyrighted music. Music request is not part of the script.
- [ ] Mia's lines match this file word for word. If a line differs, the sentence template changed: fix the script, do not edit the video.
- [ ] Upload public to YouTube or Vimeo; paste the link in the Devpost form.
