# Persona: Rose Whitaker

> **Fictional character.** Rose is the demo and test persona for Mia. Any resemblance to real people is coincidental. Her situation is inspired by real family caregiving experience, but no real personal data is used anywhere in this project — not in the repo, the seed data, the tests, or the demo video.

## At a glance

| | |
|---|---|
| **Name** | Rose Whitaker ("Rosie" to old friends — Mia uses **Rose**) |
| **Age** | 81 |
| **Lives** | Alone, small single-story house on Linden Street, Columbus, Ohio |
| **Diagnosis** | Alzheimer's disease, early-to-moderate stage, diagnosed 2 years ago |
| **Device** | Echo Dot in the kitchen, Alexa+ (en-US) — no screen |
| **Tech comfort** | Low. Knows "Alexa, what's the weather" and "Alexa, play Frank Sinatra". Gets flustered by anything new. Never learned a skill name. |
| **Timezone** | America/New_York |

## Her people

| Name | Relationship | Notes for Mia |
|---|---|---|
| **Tom** | Son, 54 — **primary carer** (`carerName`) | Lives in Cincinnati, about 2 hours away. Calls **every evening at 7**. Visits most Saturdays. |
| **Lily** | Granddaughter, 19 | Tom's daughter, at college. Video-calls Sundays. Rose lights up when she's mentioned. |
| **June Parker** | Neighbor, next door | Has a spare key. Checks in on Wednesdays. |
| **Frank** | Late husband | Died in 2019. **Comfort note:** if Rose asks where Frank is, Mia does not correct harshly — "Frank loved you very much. Tom is calling tonight at 7." (Agreed with Tom.) |
| **Carol** | Group leader at Maple Grove | Friendly, runs the Tuesday sing-along. |

## Her week

**Group — "Maple Grove Day Club"** (adult day program, Maple Grove Community Center)
- **Monday, Tuesday, Thursday, 10:00–14:00**
- Travel mode: **alone** — a 10-minute walk, three blocks, same route for 40 years
- Leave by **9:40**, expected home **14:30** (grace 30 min → alert at 15:00)
- Bring: coat (in cold weather), handbag, keys, glasses, house key on the red lanyard
- Lunch is served at the group → her **noon pill is "taken at the group"** on group days

**Other fixed points**
- Wednesday: June checks in, around 11:00
- Saturday: Tom visits (most weeks)
- Sunday: video call with Lily, 16:00

## Daily routine

| Time | Item |
|---|---|
| 07:30 | Get up, coffee |
| 08:00 | Breakfast + **morning pills** |
| 09:40 | (Group days) leave for Maple Grove |
| 12:00 | Lunch (+ noon pill, at home on non-group days) |
| 15:00 | Tea, crossword or garden (weather permitting) |
| 18:00 | Supper |
| 19:00 | **Tom calls** |
| 20:00 | **Evening pill** |
| 21:30 | Bed — radio on low |

## Medications (as entered by Tom — plain descriptions only)

| Id | What Rose hears | Times |
|---|---|---|
| `morning-pills` | "the small white pill and the round pink one" | 08:00 daily |
| `noon-pill` | "the little yellow one" | 12:00 daily — **taken at the group** on Mon/Tue/Thu |
| `evening-pill` | "the white capsule" | 20:00 daily |

Mia never names doses, never advises on extra pills, never interprets symptoms.

## Her hardest moments (what Mia is for)

| Moment | What happens | Mia's job |
|---|---|---|
| **Medication** | Unsure if she took the morning pills; once took them twice | Answer only from the log; block duplicate with kindness; alert Tom on missed dose |
| **The day** | Asks "Is it a group day?" 5–10 times on Monday mornings | Same calm answer every time, with leave-by time and what to bring |
| **Leaving alone** | Sometimes forgets her keys; once took a long detour home | "Leaving" + "home" check-in; alert Tom if not home by 15:00 |
| **Late afternoon (sundowning)** | Gets anxious around 16:00–18:00 | Comfort notes, "Tom calls at 7", offer to call now |
| **Night** | Wakes ~3:00, thinks she must get ready for work at the library | "It's the middle of the night, you're retired, you're safe at home" |
| **Loneliness** | Long quiet afternoons on non-group days | Chat about her life story; mention Lily; offer to call Tom |

## Comfort notes (spoken as written)

- "You're safe at home on Linden Street."
- "Tom calls you every evening at seven. He loves you."
- "You don't need to go to work anymore — you retired from the library, and they threw you a lovely party."
- "June next door has a key and is always happy to help."

## Life-story topics (for `chat_about_life`)

- Worked **38 years as a school librarian** at Westgate Elementary — loved reading *Charlotte's Web* aloud
- Her **rose garden** — "a Rose growing roses" was Frank's favorite joke; her pride is a yellow climbing rose by the porch
- Music: **Frank Sinatra, Ella Fitzgerald**, and the Tuesday sing-along at Maple Grove
- Married Frank in **1966**; honeymoon at Niagara Falls
- Grew up in **Dayton**, the youngest of four sisters
- Makes "the best apple pie on Linden Street" (Tom's words)

## Demo storyline (video < 3 min)

1. **Monday 08:05** — "Alexa, what day is it?" → Monday, group day, leave at 9:40. "Did I take my pills?" → not yet, the small white and the round pink one. "I took them." → logged. Two minutes later: "I took my pills" → "You already took them at 8:06, no more needed." *(duplicate guard)*
2. **09:38** — "I'm going to my group now." → keys on the red lanyard, have a lovely time.
3. **15:00** — no "I'm home" → Tom's phone: email + SMS "Rose isn't home yet from Maple Grove (expected 14:30)." Tom taps *I'm on it*. 15:12 Rose: "I'm home." → alert resolved.
4. **03:10 night** — "Is it time for work?" → reassurance, logged.
5. **Carer page** — Tom sees the day: pills ✓, group ✓, late return, night waking; Bedrock summary: "Mostly a good day. Asked about the group 6 times before leaving…"
