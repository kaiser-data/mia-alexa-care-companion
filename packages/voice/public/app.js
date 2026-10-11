import { createTurnQueue, createTurnTaker, isPlayableReply, releasePlan, speechPlan } from "./turn.js";

const $ = (id) => document.getElementById(id);
const ring = $("ring");
const statusEl = $("status");
const captions = $("captions");
const noticeEl = $("notice");

const LABELS = {
  "en-US": { idle: "Tap the circle to talk to Mia", listening: "I'm listening…", thinking: "One moment…", speaking: "", noMic: "Speech needs Chrome or Edge. You can type below.", fallback: ["Sorry, one moment.", "I'm still here."], unreachable: "Mia's server is not reachable.", placeholder: "…or type here", typed: "Type a message", music: "stand-in tune for the demo", musicSkipped: "no audio available for the tune", send: "Send", captions: "Captions", ring: "Talk to Mia" },
  "de-DE": { idle: "Tippe auf den Kreis, um mit Mia zu sprechen", listening: "Ich höre zu…", thinking: "Einen Moment…", speaking: "", noMic: "Sprache braucht Chrome oder Edge. Du kannst unten tippen.", fallback: ["Einen Moment bitte.", "Ich bin noch da."], unreachable: "Mias Server ist nicht erreichbar.", placeholder: "…oder hier tippen", typed: "Nachricht eingeben", music: "Ersatzmelodie für die Demo", musicSkipped: "kein Ton für die Melodie verfügbar", send: "Senden", captions: "Untertitel", ring: "Mit Mia sprechen" },
};
const TURN_FETCH_TIMEOUT_MS = 15000;
const PROACTIVE_POLL_MS = 20000;

const FALLBACK_CONFIG = { locale: "en-US", endOfTurnTimeoutMs: 1800, rate: 0.9, breakMs: 700 };
const LISTEN_GRACE_MS = 10000;
let config = FALLBACK_CONFIG;
let serverDown = false;
try {
  const res = await fetch("/api/config", { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(String(res.status));
  config = { ...FALLBACK_CONFIG, ...(await res.json()) };
} catch {
  serverDown = true;
}
const L = LABELS[config.locale] ?? LABELS["en-US"];
document.documentElement.lang = config.locale.slice(0, 2);
$("typed").placeholder = L.placeholder;
$("typed").setAttribute("aria-label", L.typed);
$("type-form").querySelector("button[type=submit]").textContent = L.send;
$("captions-label").textContent = L.captions;
ring.setAttribute("aria-label", L.ring);

let state = "idle";
let busy = false;
let started = false;
let wantListening = false;
let lastHeardAt = 0;
let netRetries = 0;
let retryPending = false;
let micDead = false;
let proactiveInFlight = false;
let turnEpoch = 0;
const queue = createTurnQueue();

function setState(s) {
  state = s;
  ring.dataset.state = s;
  statusEl.textContent = L[s] ?? "";
}
// Persistent notice line: state changes never wipe it.
function refreshNotice() {
  noticeEl.textContent = micDead ? L.noMic : serverDown ? L.unreachable : "";
}
function markMicDead() {
  wantListening = false;
  micDead = true;
  setState("idle");
  refreshNotice();
  $("typed").focus();
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
    if (!wantListening) return;
    lastHeardAt = Date.now();
    netRetries = 0;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      taker.heard({ text: r[0].transcript, isFinal: r.isFinal, confidence: r[0].confidence });
    }
  };
  recognition.onerror = (e) => {
    const err = e.error;
    if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
      markMicDead();
    } else if (err === "network") {
      if (netRetries < 3) {
        netRetries++;
        retryPending = true;
        setTimeout(() => { retryPending = false; if (wantListening) try { recognition.start(); } catch { /* already running */ } }, 2000);
      } else {
        markMicDead();
      }
    }
    // no-speech / aborted: ignored, onend restarts listening
  };
  recognition.onend = () => {
    if (wantListening && retryPending) return; // the backoff timer restarts it
    if (wantListening) try { recognition.start(); } catch { /* already running */ }
  };
}

function listen() {
  if (!recognition) micDead = true;
  if (micDead) { setState("idle"); refreshNotice(); return; }
  wantListening = true;
  setState("listening");
  try { recognition.start(); } catch { /* already running */ }
}
// Only Mia's own speech closes the mic (no self-echo). Words heard so far are sent, never dropped:
// while Mia is busy they wait in the turn queue and go out after the reply.
function stopListening() {
  wantListening = false;
  taker.flush();
  try { recognition?.stop(); } catch { /* not running */ }
}

let voices = speechSynthesis.getVoices();
speechSynthesis.addEventListener?.("voiceschanged", () => { voices = speechSynthesis.getVoices(); });
function voiceFor(lang) {
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}
function speakOne(u) {
  return new Promise((resolve) => {
    const s = new SpeechSynthesisUtterance(u.text);
    s.lang = config.locale;
    s.rate = u.rate;
    const v = voiceFor(config.locale);
    if (v) s.voice = v;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(dog); resolve(); };
    const dog = setTimeout(() => { speechSynthesis.cancel(); finish(); }, Math.max(4000, (u.text.length * 120) / (u.rate || 1)));
    s.onend = finish;
    s.onerror = finish;
    speechSynthesis.speak(s);
  });
}

// Royalty-free stand-in: a short gentle tune. On real Alexa+ this is a hand-off to Alexa music.
async function playStandIn(artist) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  try { if (Ctx) ctx = new Ctx(); } catch { ctx = null; }
  if (!ctx) { caption("music", `♪ ${artist} — ${L.musicSkipped}`); return; }
  caption("music", `♪ ${artist} — ${L.music}`);
  try {
    try { await Promise.race([ctx.resume(), wait(1000)]); } catch { /* play anyway */ }
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
  } finally {
    try { await Promise.race([ctx.close(), wait(1000)]); } catch { /* already closed */ }
  }
}

// The mic must not reopen while any speech is still playing (no self-echo).
async function waitSpeechIdle() {
  for (let waited = 0; speechSynthesis.speaking && waited < 2000; waited += 100) await wait(100);
  if (speechSynthesis.speaking) speechSynthesis.cancel();
}

async function play(reply) {
  stopListening();
  setState("speaking");
  speechSynthesis.cancel();
  try {
    for (const u of speechPlan(reply)) {
      caption("mia", u.text);
      await speakOne(u);
      await wait(u.pauseAfterMs);
    }
  } finally {
    await waitSpeechIdle();
  }
  if (reply.action?.type === "play_music") await playStandIn(reply.action.artist);
}

// Release the lock, then replay a queued turn or resume listening.
function release() {
  busy = false;
  const next = queue.take();
  const plan = releasePlan({ queued: Boolean(next), started, micDead });
  // play() closed the mic: reopen it without leaving "thinking", so she is heard while the queued turn is answered.
  if (plan.rearm && recognition) {
    wantListening = true;
    try { recognition.start(); } catch { /* already running */ }
  }
  if (plan.replay) { send(next); return; }
  if (plan.listen) listen();
}

async function send(turn) {
  if (busy) { queue.push(turn); return false; } // replayed by release()
  busy = true;
  turnEpoch++; // her turn wins over any proactive fetch still in flight
  try {
    // The mic stays on while Mia thinks: what she says meanwhile is queued (merged) and sent after the reply.
    setState("thinking");
    caption("rose", turn.text);
    let reply = null;
    try {
      const res = await fetch("/api/turn", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn),
        signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS), // the server answers within 10 s
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      reply = isPlayableReply(body) ? body : null;
      serverDown = false;
    } catch {
      serverDown = true;
    }
    refreshNotice();
    // If playing a real reply fails part-way, never follow it with the fallback line.
    try { await play(reply ?? { sentences: L.fallback, rate: config.rate, breakMs: config.breakMs }); } catch { /* keep going */ }
  } finally {
    release();
  }
  return true;
}

ring.addEventListener("click", () => {
  started = true;
  micDead = false;
  netRetries = 0;
  refreshNotice();
  if (state === "idle") listen();
});
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("typed").value.trim();
  started = true;
  if (!text) return;
  $("typed").value = ""; // while Mia is busy the turn is queued and replayed
  send({ text, confidence: 1 });
});
$("captions-toggle").addEventListener("change", (e) => { captions.hidden = !e.target.checked; });

// Mia speaks first (Care Mode demo). Browsers only allow sound after the first tap.
const pollBlocked = () =>
  !started || busy || state === "thinking" || state === "speaking" ||
  (wantListening && (taker.hasPending() || Date.now() - lastHeardAt < LISTEN_GRACE_MS));
setInterval(async () => {
  if (pollBlocked() || proactiveInFlight) return;
  proactiveInFlight = true; // not `busy`: her speech must never be dropped during the fetch
  const epoch = turnEpoch;
  let reply = null;
  try {
    const res = await fetch("/api/proactive", { signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS) });
    if (res.ok) ({ reply } = await res.json());
    if (!isPlayableReply(reply)) reply = null;
  } catch { /* try again at the next poll */ }
  proactiveInFlight = false;
  if (!reply || busy || epoch !== turnEpoch || (wantListening && (taker.hasPending() || Date.now() - lastHeardAt < LISTEN_GRACE_MS))) return;
  busy = true;
  try {
    await play(reply);
  } catch { /* keep going */ } finally {
    release();
  }
}, PROACTIVE_POLL_MS);

setState("idle");
if (!recognition) { micDead = true; }
refreshNotice();
