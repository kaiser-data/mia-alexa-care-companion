// Pure turn-taking logic for the browser "Echo" (no DOM), unit-tested in Node.

/**
 * Decides when she has finished speaking: `timeoutMs` of silence after the last words (spec §9.1, never cut her off).
 * Interim words are kept, so a phrase is never lost when the recogniser does not finalise it.
 */
export function createTurnTaker({ timeoutMs, onTurn, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let parts = [];
  let confidences = [];
  let interim = "";
  let timer = null;

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function finish() {
    timer = null;
    const text = [...parts, interim].join(" ").replace(/\s+/g, " ").trim();
    const turn = confidences.length
      ? { text, confidence: Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 }
      : { text };
    parts = [];
    confidences = [];
    interim = "";
    if (text) onTurn(turn);
  }

  return {
    heard({ text, isFinal, confidence }) {
      if (!isFinal && !text.trim()) return; // an empty interim result must not arm the timer
      if (isFinal) {
        parts.push(text.trim());
        interim = "";
        if (typeof confidence === "number" && confidence > 0) confidences.push(confidence);
      } else {
        interim = text.trim();
      }
      clear();
      timer = setTimer(finish, timeoutMs);
    },
    hasPending() {
      return parts.length > 0 || interim !== "";
    },
    reset() {
      clear();
      parts = [];
      confidences = [];
      interim = "";
    },
  };
}

/** One utterance per sentence with the calibrated pause between sentences (spec §8 rule 3). */
export function speechPlan(reply) {
  return reply.sentences.map((text, i) => ({
    text,
    rate: reply.rate,
    pauseAfterMs: i < reply.sentences.length - 1 ? reply.breakMs : 0,
  }));
}

/** One-slot queue for a turn that arrives while Mia is busy: at most one pending turn, later words are appended, never dropped. */
export function createTurnQueue() {
  let slot = null;
  return {
    push(turn) {
      if (!slot) { slot = { ...turn }; return; }
      const text = `${slot.text} ${turn.text}`.replace(/\s+/g, " ").trim();
      const c = [slot.confidence, turn.confidence].filter((x) => typeof x === "number");
      slot = c.length ? { text, confidence: Math.min(...c) } : { text };
    },
    take() { const t = slot; slot = null; return t; },
    has() { return slot !== null; },
  };
}
