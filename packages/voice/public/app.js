import { createTurnTaker, speechPlan } from "./turn.js";

const $ = (id) => document.getElementById(id);
const ring = $("ring");
const statusEl = $("status");
const captions = $("captions");

const LABELS = {
  "en-US": { idle: "Tap the circle to talk to Mia", listening: "I'm listening…", thinking: "One moment…", speaking: "", noMic: "Speech needs Chrome or Edge. You can type below." },
  "de-DE": { idle: "Tippe auf den Kreis, um mit Mia zu sprechen", listening: "Ich höre zu…", thinking: "Einen Moment…", speaking: "", noMic: "Sprache braucht Chrome oder Edge. Du kannst unten tippen." },
};
const PROACTIVE_POLL_MS = 20000;

const config = await (await fetch("/api/config")).json();
const L = LABELS[config.locale] ?? LABELS["en-US"];
document.documentElement.lang = config.locale.slice(0, 2);

let state = "idle";
let busy = false;
let started = false;
let wantListening = false;

function setState(s) {
  state = s;
  ring.dataset.state = s;
  statusEl.textContent = L[s] ?? "";
}
function caption(who, text) {
  const p = document.createElement("p");
  p.className = who;
  p.textContent = text;
  captions.append(p);
  captions.scrollTop = captions.scrollHeight;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const taker = createTurnTaker({ timeoutMs: config.endOfTurnTimeoutMs, onTurn: (turn) => send(turn) });
let recognition = null;
if (Recognition) {
  recognition = new Recognition();
  recognition.lang = config.locale;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      taker.heard({ text: r[0].transcript, isFinal: r.isFinal, confidence: r[0].confidence });
    }
  };
  recognition.onend = () => {
    if (wantListening) try { recognition.start(); } catch { /* already running */ }
  };
}

function listen() {
  if (!recognition) { setState("idle"); statusEl.textContent = L.noMic; return; }
  wantListening = true;
  setState("listening");
  try { recognition.start(); } catch { /* already running */ }
}
function stopListening() {
  wantListening = false;
  taker.reset();
  try { recognition?.stop(); } catch { /* not running */ }
}

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}
function speakOne(u) {
  return new Promise((resolve) => {
    const s = new SpeechSynthesisUtterance(u.text);
    s.lang = config.locale;
    s.rate = u.rate;
    const v = voiceFor(config.locale);
    if (v) s.voice = v;
    s.onend = resolve;
    s.onerror = resolve;
    speechSynthesis.speak(s);
  });
}

// Royalty-free stand-in: a short gentle tune. On real Alexa+ this is a hand-off to Alexa music.
async function playStandIn(artist) {
  caption("music", `♪ ${artist} — stand-in tune for the demo`);
  const ctx = new AudioContext();
  const notes = [392, 440, 494, 523, 494, 440, 392, 330, 349, 392, 440, 392];
  let t = ctx.currentTime + 0.1;
  for (const f of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
    t += 1;
  }
  await wait(notes.length * 1000 + 300);
  await ctx.close();
}

async function play(reply) {
  setState("speaking");
  for (const u of speechPlan(reply)) {
    caption("mia", u.text);
    await speakOne(u);
    await wait(u.pauseAfterMs);
  }
  if (reply.action?.type === "play_music") await playStandIn(reply.action.artist);
}

async function send(turn) {
  if (busy) return;
  busy = true;
  stopListening();
  setState("thinking");
  caption("rose", turn.text);
  try {
    const res = await fetch("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn) });
    if (res.ok) await play(await res.json());
  } catch { /* the next turn tries again */ }
  busy = false;
  listen();
}

ring.addEventListener("click", () => {
  started = true;
  if (state === "idle") listen();
});
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("typed").value.trim();
  $("typed").value = "";
  started = true;
  if (text) send({ text, confidence: 1 });
});
$("captions-toggle").addEventListener("change", (e) => { captions.hidden = !e.target.checked; });

// Mia speaks first (Care Mode demo). Browsers only allow sound after the first tap.
setInterval(async () => {
  if (!started || busy || state === "thinking" || state === "speaking") return;
  try {
    const { reply } = await (await fetch("/api/proactive")).json();
    if (!reply) return;
    busy = true;
    stopListening();
    await play(reply);
  } catch { /* try again at the next poll */ }
  busy = false;
  if (started) listen();
}, PROACTIVE_POLL_MS);

setState("idle");
if (!recognition) statusEl.textContent = L.noMic;
