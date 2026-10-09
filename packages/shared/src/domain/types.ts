export type Locale = "en-US" | "de-DE";
/** ISO 8601 weekday, Monday = 1 … Sunday = 7 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** 24 h local time, "08:00" */
export type HHMM = string;

export interface RoutineItem { time: HHMM; label: string }

export interface Medication {
  id: string;
  /** short spoken name, e.g. "your morning pills" */
  name: string;
  /** plain description spoken as entered, e.g. "the small white pill" */
  description: string;
  times: HHMM[];
  /** omitted = every day */
  weekdays?: Weekday[];
  /** a dose inside this appointment's time window is given there */
  takenAtAppointmentId?: string;
}

export type TravelMode = "alone" | "pickup" | "family_drives" | "at_home";

export interface Appointment {
  id: string;
  name: string;
  /** words she may use for it: "group", "Gruppe" */
  aliases: string[];
  location?: string;
  /** recurring weekdays; omitted when `date` is set */
  weekdays?: Weekday[];
  /** one-off date YYYY-MM-DD */
  date?: string;
  start: HHMM;
  end: HHMM;
  cancelledDates: string[];
  travelMode: TravelMode;
  leaveBy?: HHMM;
  expectedReturn?: HHMM;
  graceMinutes: number;
  checklist: string[];
}

export interface Person {
  id: string;
  name: string;
  /** en: "son"; de: includes possessive, "dein Sohn" */
  relationship: string;
  contact?: string;
  notes?: string;
}

export interface SpeechSettings {
  voiceId?: string;
  speechRate: number;
  sentenceBreakMs: number;
  plainLevel: "simple" | "very_simple";
  endOfTurnTimeoutMs: number;
  confidenceThreshold: number;
  customVocabulary: string[];
  lastCalibratedAt?: string;
}

export interface Profile {
  id: string;
  name: string;
  preferredName: string;
  locale: Locale;
  timezone: string;
  carerName: string;
  routine: RoutineItem[];
  medications: Medication[];
  appointments: Appointment[];
  people: Person[];
  comfortNotes: string[];
  lifeStory: string[];
  speech: SpeechSettings;
}

export const EVENT_TYPES = [
  "orientation_asked", "left_home", "arrived_home", "stayed_home",
  "med_asked", "med_confirmed", "med_duplicate_attempt", "med_not_due_attempt", "med_unsure",
  "anxious", "night_awake", "person_asked", "lonely", "call_requested",
  "distress", "repeat_asked", "unknown_question",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface CareEvent {
  profileId: string;
  type: EventType;
  /** ISO 8601 UTC instant */
  at: string;
  detail?: Record<string, string>;
}
