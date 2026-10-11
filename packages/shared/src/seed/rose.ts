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
      { time: "21:30", label: "bedtime", kind: "bedtime" },
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
    location: { latitude: 39.9612, longitude: -82.9988 },
    favouriteMusic: "Ella Fitzgerald",
    checkInTime: "15:30",
  };
}

/** Same fictional Rose, German-speaking — for the language demo and tests */
export function roseDe(): Profile {
  const p = rose();
  return {
    ...p,
    id: "rose-de",
    locale: "de-DE",
    routine: [
      { time: "07:30", label: "Kaffee" },
      { time: "08:00", label: "Frühstück" },
      { time: "12:00", label: "Mittagessen" },
      { time: "15:00", label: "Kaffee und Kuchen" },
      { time: "18:00", label: "Abendbrot" },
      { time: "19:00", label: "Toms Anruf" },
      { time: "21:30", label: "Schlafenszeit", kind: "bedtime" },
    ],
    medications: [
      { id: "morning-pills", name: "deine Morgentabletten", description: "die kleine weiße und die runde rosa Tablette", times: ["08:00"] },
      { id: "noon-pill", name: "deine Mittagstablette", description: "die kleine gelbe", times: ["12:00"], takenAtAppointmentId: "maple-grove" },
      { id: "evening-pill", name: "deine Abendtablette", description: "die weiße Kapsel", times: ["20:00"] },
    ],
    appointments: [{
      ...p.appointments[0]!,
      name: "Tagesgruppe",
      aliases: ["gruppe", "tagesgruppe", "club", "maple grove"],
      checklist: ["deinen Schlüssel am roten Band", "deine Handtasche", "deine Brille", "deinen Mantel"],
    }],
    people: [
      { id: "tom", name: "Tom", relationship: "dein Sohn", contact: "Tom ruft dich jeden Abend um sieben an." },
      { id: "lily", name: "Lily", relationship: "deine Enkelin", contact: "Lily ruft dich sonntags an." },
      { id: "june", name: "June", relationship: "deine Nachbarin", contact: "June wohnt nebenan und hat einen Schlüssel." },
      { id: "frank", name: "Frank", relationship: "dein Mann", notes: "Frank hat dich sehr geliebt." },
    ],
    comfortNotes: [
      "Du bist sicher zu Hause in der Linden Street.",
      "Tom ruft dich jeden Abend um sieben an. Er hat dich lieb.",
      "Du musst nicht mehr zur Arbeit. Du bist in Rente.",
      "June von nebenan hat einen Schlüssel und hilft gern.",
    ],
    lifeStory: [
      "Du warst 38 Jahre lang Bibliothekarin an einer Schule.",
      "Du liebst deinen Rosengarten, besonders die gelbe Kletterrose.",
      "Du magst Frank Sinatra und Ella Fitzgerald.",
      "Du hast Frank 1966 geheiratet.",
      "Dein Apfelkuchen ist der beste in der Straße.",
    ],
  };
}

export const SEED_PROFILES = { rose, "rose-de": roseDe } as const;
export type SeedId = keyof typeof SEED_PROFILES;
export const isSeedId = (s: string): s is SeedId => Object.hasOwn(SEED_PROFILES, s);
