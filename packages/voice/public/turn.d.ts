export interface HeardResult { text: string; isFinal: boolean; confidence?: number }
export interface Turn { text: string; confidence?: number }
export interface TurnTaker { heard(r: HeardResult): void; reset(): void; hasPending(): boolean }
export function createTurnTaker(o: {
  timeoutMs: number;
  onTurn: (t: Turn) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: never) => void;
}): TurnTaker;
export interface Utterance { text: string; rate: number; pauseAfterMs: number }
export function speechPlan(reply: { sentences: string[]; rate: number; breakMs: number }): Utterance[];
export interface TurnQueue { push(t: Turn): void; take(): Turn | null; has(): boolean }
export function createTurnQueue(): TurnQueue;
export function isPlayableReply(reply: unknown): boolean;
