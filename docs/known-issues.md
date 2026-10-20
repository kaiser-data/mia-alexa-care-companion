# Known issues

Open findings from the Plan 2 reviews, merged to main on 2026-10-20 without a fix.

## Answers

- **A picked question can take the place of a skipped answer.** When an answer is skipped for its own question, the LLM's picked question should not fill that place.
- **Compound group names match too loosely.** "Gymnastikgruppe" is matched to the only group by its "-gruppe" ending. With a second appointment the plural/compound match should apply only when no other appointment matches exactly, and an unknown compound should get "I don't know".

## Echo Dot

- **Alexa+ devices do not run the classic skill in development.** The skill (`packages/voice/alexa/`) works in the Alexa developer console simulator, but an Echo on Alexa+ answers "not supported on this device".
