import { describe, expect, it } from "vitest";
import { createTurnTaker, speechPlan } from "../public/turn.js";

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
});

describe("speechPlan", () => {
  it("one utterance per sentence, pause between, none after the last", () => {
    expect(speechPlan({ sentences: ["Not yet.", "Now it's time."], rate: 0.9, breakMs: 700 })).toEqual([
      { text: "Not yet.", rate: 0.9, pauseAfterMs: 700 },
      { text: "Now it's time.", rate: 0.9, pauseAfterMs: 0 },
    ]);
  });
});
