import { describe, expect, it } from "vitest";
import { createTurnQueue, createTurnTaker, isPlayableReply, speechPlan } from "../public/turn.js";

function fakeTimers() {
  let next = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id: number) => { timers.delete(id); },
    fire: () => { const all = [...timers.values()]; timers.clear(); all.forEach((f) => f()); },
    pending: () => timers.size,
  };
}

describe("createTurnTaker", () => {
  it("waits for silence after the last words, then sends the whole turn once", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "Did I", isFinal: false });
    taker.heard({ text: "Did I take", isFinal: true, confidence: 0.8 });
    taker.heard({ text: "my pills", isFinal: true, confidence: 0.6 });
    expect(t.pending()).toBe(1);
    expect(turns).toEqual([]);
    t.fire();
    expect(turns).toEqual([{ text: "Did I take my pills", confidence: 0.7 }]);
  });
  it("an unfinished phrase is still sent when she stops talking (never cut off, never lost)", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "is it group", isFinal: false });
    t.fire();
    expect(turns).toEqual([{ text: "is it group" }]);
  });
  it("browsers that report confidence 0 do not count as unsure", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "hello", isFinal: true, confidence: 0 });
    t.fire();
    expect(turns).toEqual([{ text: "hello" }]);
  });
  it("reset drops what was heard", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "hello", isFinal: true });
    taker.reset();
    t.fire();
    expect(turns).toEqual([]);
  });
  it("hasPending is true after words, false after finish and after reset", () => {
    const t = fakeTimers();
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer });
    expect(taker.hasPending()).toBe(false);
    taker.heard({ text: "hello", isFinal: false });
    expect(taker.hasPending()).toBe(true);
    t.fire();
    expect(taker.hasPending()).toBe(false);
    taker.heard({ text: "again", isFinal: true });
    expect(taker.hasPending()).toBe(true);
    taker.reset();
    expect(taker.hasPending()).toBe(false);
  });
  it("an empty interim result does not arm the timer", () => {
    const t = fakeTimers();
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "   ", isFinal: false });
    expect(t.pending()).toBe(0);
    expect(taker.hasPending()).toBe(false);
  });
  it("a later interim replaces the earlier one (only the latest is sent)", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "is it", isFinal: false });
    taker.heard({ text: "is it group", isFinal: false });
    t.fire();
    expect(turns).toEqual([{ text: "is it group" }]);
  });
  it("the timer resets on each result: two results, one fire, one turn", () => {
    const t = fakeTimers();
    const turns: unknown[] = [];
    const taker = createTurnTaker({ timeoutMs: 1800, onTurn: (x) => turns.push(x), setTimer: t.setTimer, clearTimer: t.clearTimer });
    taker.heard({ text: "one", isFinal: true });
    taker.heard({ text: "two", isFinal: true });
    expect(t.pending()).toBe(1);
    t.fire();
    expect(turns).toEqual([{ text: "one two" }]);
  });
});

describe("speechPlan", () => {
  it("one utterance per sentence, pause between, none after the last", () => {
    expect(speechPlan({ sentences: ["Not yet.", "Now it's time."], rate: 0.9, breakMs: 700 })).toEqual([
      { text: "Not yet.", rate: 0.9, pauseAfterMs: 700 },
      { text: "Now it's time.", rate: 0.9, pauseAfterMs: 0 },
    ]);
  });
});

describe("createTurnQueue", () => {
  it("holds one pending turn and hands it over once", () => {
    const q = createTurnQueue();
    expect(q.has()).toBe(false);
    expect(q.take()).toBeNull();
    q.push({ text: "hello", confidence: 0.9 });
    expect(q.has()).toBe(true);
    expect(q.take()).toEqual({ text: "hello", confidence: 0.9 });
    expect(q.has()).toBe(false);
  });
  it("a second turn is merged into the slot so no words are lost", () => {
    const q = createTurnQueue();
    q.push({ text: "where is", confidence: 0.9 });
    q.push({ text: "my tea", confidence: 0.7 });
    expect(q.take()).toEqual({ text: "where is my tea", confidence: 0.7 });
  });
  it("merges turns without confidence (typed text)", () => {
    const q = createTurnQueue();
    q.push({ text: "a" });
    q.push({ text: "b" });
    expect(q.take()).toEqual({ text: "a b" });
  });
});

describe("isPlayableReply", () => {
  it("only a reply with at least one sentence string is played", () => {
    expect(isPlayableReply({ sentences: ["Hello."], rate: 0.9, breakMs: 700 })).toBe(true);
    expect(isPlayableReply({})).toBe(false);
    expect(isPlayableReply({ sentences: [] })).toBe(false);
    expect(isPlayableReply({ sentences: [""] })).toBe(false);
    expect(isPlayableReply({ sentences: "Hello." })).toBe(false);
    expect(isPlayableReply(null)).toBe(false);
  });
});
