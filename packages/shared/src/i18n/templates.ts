import type { Locale } from "../domain/types";
import { joinList } from "./words";

export interface Templates {
  todayIs(dateText: string): string;
  repeatDay(weekday: string): string;
  leaveFor(name: string, time: string): string;
  leaveAt(time: string): string;
  apptAt(name: string, time: string): string;
  apptUntil(name: string, time: string): string;
  apptTodayYes(name: string): string;
  apptNotToday(name: string, weekday: string): string;
  onDay(weekday: string): string;
  nothingToday(): string;
  nextRoutine(label: string, time: string): string;
  dontKnow(carer: string): string;
  take(items: string[]): string;
  thatsAll(): string;
  leavingOk(): string;
  keysCheck(): string;
  welcomeHome(name: string): string;
  niceTime(): string;
  notYet(): string;
  medDue(names: string): string;
  medIs(description: string): string;
  medTaken(name: string, time: string): string;
  medNextAt(time: string): string;
  medAtAppt(name: string, appointment: string): string;
  medUnsure(name: string): string;
  askCarerFirst(carer: string): string;
  medNoneToday(): string;
  medConfirmed(names: string): string;
  medEarlyNoted(carer: string): string;
  medAlreadyTaken(name: string, time: string): string;
  noMoreNow(): string;
  safeAtHome(): string;
  callOffer(carer: string): string;
  callRequested(carer: string): string;
  nightIs(time: string): string;
  nightSafe(): string;
  distressAck(carer: string): string;
  distressFollow(carer: string): string;
  distressFailed(carer: string): string;
  systemError(carer: string): string;
  personIs(name: string, relationship: string): string;
}

const EN: Templates = {
  todayIs: (d) => `Today is ${d}.`,
  repeatDay: (w) => `Today is ${w}.`,
  leaveFor: (n, t) => `You leave for ${n} at ${t}.`,
  leaveAt: (t) => `You leave at ${t}.`,
  apptAt: (n, t) => `${n} starts at ${t}.`,
  apptUntil: (n, t) => `${n} goes until ${t}.`,
  apptTodayYes: (n) => `Yes, ${n} is today.`,
  apptNotToday: (n, w) => `Not today. ${n} is on ${w}.`,
  onDay: (w) => `On ${w}.`,
  nothingToday: () => "Nothing special is planned today.",
  nextRoutine: (l, t) => `Next is ${l}, at ${t}.`,
  dontKnow: (c) => `I don't know that. I'll ask ${c}.`,
  take: (items) => `Take ${joinList(items, "en-US")}.`,
  thatsAll: () => "That's everything.",
  leavingOk: () => "Have a lovely time.",
  keysCheck: () => "Do you have your keys?",
  welcomeHome: (n) => `Welcome home, ${n}.`,
  niceTime: () => "Did you have a nice time?",
  notYet: () => "Not yet.",
  medDue: (n) => `Now it's time for ${n}.`,
  medIs: (d) => `That's ${d}.`,
  medTaken: (n, t) => `Yes. You took ${n} at ${t}.`,
  medNextAt: (t) => `Your next pills are at ${t}.`,
  medAtAppt: (n, a) => `You get ${n} at ${a} today.`,
  medUnsure: (n) => `I'm not sure if you had ${n} yet.`,
  askCarerFirst: (c) => `Let's ask ${c} first.`,
  medNoneToday: () => "There are no more pills today.",
  medConfirmed: (n) => `Thank you. I've noted ${n}.`,
  medEarlyNoted: (c) => `Thank you. I'll tell ${c}.`,
  medAlreadyTaken: (n, t) => `You took ${n} at ${t}.`,
  noMoreNow: () => "No more pills needed now.",
  safeAtHome: () => "You're safe at home.",
  callOffer: (c) => `Shall I ask ${c} to call you?`,
  callRequested: (c) => `I've asked ${c} to call you.`,
  nightIs: (t) => `It's ${t}, in the middle of the night.`,
  nightSafe: () => "You're safe at home. You can go back to sleep.",
  distressAck: (c) => `I've let ${c} know right away.`,
  distressFollow: (c) => `${c} will get in touch with you.`,
  distressFailed: (c) => `I couldn't reach ${c}. Please call for help.`,
  systemError: (c) => `I can't check right now. ${c} can help.`,
  personIs: (n, r) => `${n} is your ${r}.`,
};

const DE: Templates = {
  todayIs: (d) => `Heute ist ${d}.`,
  repeatDay: (w) => `Heute ist ${w}.`,
  leaveFor: (n, t) => `${n} ist heute. Du gehst um ${t} los.`,
  leaveAt: (t) => `Du gehst um ${t} los.`,
  apptAt: (n, t) => `${n} beginnt um ${t}.`,
  apptUntil: (n, t) => `${n} geht bis ${t}.`,
  apptTodayYes: (n) => `Ja, ${n} ist heute.`,
  apptNotToday: (n, w) => `Heute nicht. ${n} ist am ${w}.`,
  onDay: (w) => `Am ${w}.`,
  nothingToday: () => "Heute ist nichts Besonderes geplant.",
  nextRoutine: (l, t) => `Als Nächstes: ${l}, um ${t}.`,
  dontKnow: (c) => `Das weiß ich nicht. Ich frage ${c}.`,
  take: (items) => `Nimm ${joinList(items, "de-DE")} mit.`,
  thatsAll: () => "Das ist alles.",
  leavingOk: () => "Viel Freude heute.",
  keysCheck: () => "Hast du deinen Schlüssel dabei?",
  welcomeHome: (n) => `Willkommen zu Hause, ${n}.`,
  niceTime: () => "War es schön?",
  notYet: () => "Noch nicht.",
  medDue: (n) => `Jetzt ist Zeit für ${n}.`,
  medIs: (d) => `Das ist ${d}.`,
  medTaken: (n, t) => `Ja. Du hast ${n} um ${t} genommen.`,
  medNextAt: (t) => `Die nächsten Tabletten sind um ${t}.`,
  medAtAppt: (n, a) => `Heute bekommst du ${n} dort: ${a}.`,
  medUnsure: (n) => `Ich weiß nicht sicher, ob du ${n} schon hattest.`,
  askCarerFirst: (c) => `Wir fragen zuerst ${c}.`,
  medNoneToday: () => "Heute sind keine Tabletten mehr dran.",
  medConfirmed: (n) => `Danke. Ich habe ${n} notiert.`,
  medEarlyNoted: (c) => `Danke. Ich sage es ${c}.`,
  medAlreadyTaken: (n, t) => `Du hast ${n} um ${t} genommen.`,
  noMoreNow: () => "Jetzt brauchst du keine mehr.",
  safeAtHome: () => "Du bist sicher zu Hause.",
  callOffer: (c) => `Soll ich ${c} um einen Anruf bitten?`,
  callRequested: (c) => `Ich habe ${c} um einen Anruf gebeten.`,
  nightIs: (t) => `Es ist ${t}, mitten in der Nacht.`,
  nightSafe: () => "Du bist sicher zu Hause. Du kannst weiterschlafen.",
  distressAck: (c) => `Ich habe ${c} sofort Bescheid gegeben.`,
  distressFollow: (c) => `${c} meldet sich bei dir.`,
  distressFailed: (c) => `Ich konnte ${c} nicht erreichen. Bitte ruf um Hilfe.`,
  systemError: (c) => `Ich kann das gerade nicht nachsehen. ${c} hilft dir.`,
  personIs: (n, r) => `${n} ist ${r}.`,
};

export function templates(locale: Locale): Templates {
  return locale === "de-DE" ? DE : EN;
}
