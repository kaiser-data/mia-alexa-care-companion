// The app scenes of the demo video (see docs/project/demo-video-script.md). Rose's lines are typed.
export const SCENES = [
  {
    id: "pills", profile: "rose", clock: "2026-10-26T07:59:52-04:00",
    steps: [{ waitMia: true }, { rose: "I took them." }, { rose: "Did I take my pills?", pause: 1500 }],
    expectMia: [
      "Now it's time for your morning pills. Have you taken your morning pills yet?",
      "Now it's time for your morning pills. That's the small white pill and the round pink one.",
      "Thank you. I've noted your morning pills.",
      "You took your morning pills at about eight o'clock. No more pills needed now. Your next pills are at eight o'clock in the evening.",
    ],
  },
  {
    id: "group", profile: "rose", clock: "2026-10-26T09:34:52-04:00",
    steps: [{ waitMia: true }, { rose: "Yes." }],
    expectMia: [
      "You leave for Maple Grove Day Club at twenty to ten. Shall I tell you what to take?",
      "Take your keys on the red lanyard and your handbag.",
      "Take your glasses and your coat.",
    ],
  },
  {
    id: "repeat", profile: "rose", clock: "2026-10-26T10:30:00-04:00",
    steps: [{ rose: "What day is it today?", pause: 1000 }, { rose: "What day is it today?", pause: 700 }, { rose: "What day is it today?", pause: 700 }],
  },
  {
    id: "health", profile: "rose", clock: "2026-10-26T14:20:00-04:00",
    steps: [{ rose: "Can I take an aspirin?", pause: 1200 }],
    expectMia: ["I can't answer that one. Let's ask Tom first."],
  },
  {
    id: "night", profile: "rose", clock: "2026-10-27T02:00:05-04:00",
    steps: [{ rose: "Is it morning?", pause: 1200 }],
    expectMia: ["It's two o'clock, in the middle of the night. You're safe at home. You can go back to sleep."],
  },
  {
    id: "fell", profile: "rose", clock: "2026-10-26T16:10:00-04:00",
    steps: [{ rose: "I fell.", pause: 1200 }],
    expectMia: ["I've let Tom know right away. Tom will get in touch with you."],
  },
  {
    id: "german", profile: "rose-de", clock: "2026-10-26T10:30:00-04:00",
    steps: [{ rose: "Hilfe, ich bin gestürzt.", pause: 1200 }],
    expectMia: [
      "Jetzt ist Zeit für deine Morgentabletten. Hast du deine Morgentabletten schon genommen?",
      "Danke. Ich habe deine Morgentabletten notiert.",
      "Ich habe Tom sofort Bescheid gegeben. Tom meldet sich bei dir.",
    ],
  },
];
