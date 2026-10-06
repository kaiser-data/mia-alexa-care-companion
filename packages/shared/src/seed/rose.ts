import type { Profile, SpeechSettings } from "../domain/types";

export function defaultSpeech(): SpeechSettings {
  return {
    speechRate: 90, sentenceBreakMs: 700, plainLevel: "simple",
    endOfTurnTimeoutMs: 1800, confidenceThreshold: 0.6, customVocabulary: [],
  };
}

/** Fictional demo persona — see docs/persona/rose.md */
export function rose(): Profile {
  return {
    id: "rose",
    name: "Rose Whitaker",
    preferredName: "Rose",
    locale: "en-US",
    timezone: "America/New_York",
    carerName: "Tom",
    routine: [
      { time: "07:30", label: "coffee" },
      { time: "08:00", label: "breakfast" },
      { time: "12:00", label: "lunch" },
      { time: "15:00", label: "tea" },
      { time: "18:00", label: "supper" },
      { time: "19:00", label: "Tom's call" },
      { time: "21:30", label: "bedtime" },
    ],
    medications: [
      { id: "morning-pills", name: "your morning pills", description: "the small white pill and the round pink one", times: ["08:00"] },
      { id: "noon-pill", name: "your noon pill", description: "the little yellow one", times: ["12:00"], takenAtAppointmentId: "maple-grove" },
      { id: "evening-pill", name: "your evening pill", description: "the white capsule", times: ["20:00"] },
    ],
    appointments: [
      {
        id: "maple-grove",
        name: "Maple Grove Day Club",
        aliases: ["group", "day club", "club", "maple grove"],
        location: "Maple Grove Community Center",
        weekdays: [1, 2, 4],
        start: "10:00", end: "14:00",
        cancelledDates: [],
        travelMode: "alone",
        leaveBy: "09:40", expectedReturn: "14:30", graceMinutes: 30,
        checklist: ["your keys on the red lanyard", "your handbag", "your glasses", "your coat"],
      },
    ],
    people: [
      { id: "tom", name: "Tom", relationship: "son", contact: "Tom calls you every evening at seven." },
      { id: "lily", name: "Lily", relationship: "granddaughter", contact: "Lily calls you on Sundays." },
      { id: "june", name: "June", relationship: "neighbor", contact: "June lives next door and has a key." },
      { id: "frank", name: "Frank", relationship: "husband", notes: "Frank loved you very much." },
    ],
    comfortNotes: [
      "You're safe at home on Linden Street.",
      "Tom calls you every evening at seven. He loves you.",
      "You don't need to go to work anymore. You retired from the library.",
      "June next door has a key and is always happy to help.",
    ],
    lifeStory: [
      "You were a school librarian for 38 years at Westgate Elementary.",
      "You love your rose garden, especially the yellow climbing rose by the porch.",
      "You love Frank Sinatra and Ella Fitzgerald.",
      "You married Frank in 1966 and went to Niagara Falls.",
      "You grew up in Dayton, the youngest of four sisters.",
      "Your apple pie is the best on Linden Street.",
    ],
    speech: defaultSpeech(),
  };
}
