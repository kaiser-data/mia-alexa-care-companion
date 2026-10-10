import { createTurnTaker, speechPlan } from "./turn.js";

const $ = (id) => document.getElementById(id);
const ring = $("ring");
const statusEl = $("status");
const captions = $("captions");

const LABELS = {
  "en-US": { idle: "Tap the circle to talk to Mia", listening: "I'm listening…", thinking: "One moment…", speaking: "", noMic: "Speech needs Chrome or Edge. You can type below.", fallback: ["Sorry, one moment.", "I'm still here."], unreachable: "Mia's server is not reachable.", placeholder: "…or type here", send: "Send", captions: "Captions", ring: "Talk to Mia" },
  "de-DE": { idle: "Tippe auf den Kreis, um mit Mia zu sprechen", listening: "Ich höre zu…", thinking: "Einen Moment…", speaking: "", noMic: "Sprache braucht Chrome oder Edge. Du kannst unten tippen.", fallback: ["Einen Moment bitte.", "Ich bin noch da."], unreachable: "Mias Server ist nicht erreichbar.", placeholder: "…oder hier tippen", send: "Senden", captions: "Untertitel", ring: "Mit Mia sprechen" },
};
const PROACTIVE_POLL_MS = 20000;

const FALLBACK_CONFIG = { locale: "en-US", endOfTurnTimeoutMs: 1800, rate: 0.9, breakMs: 700 };
const LISTEN_GRACE_MS = 10000;
let config = FALLBACK_CONFIG;
let serverDown = false;
try {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(String(res.status));
  config = { ...FALLBACK_CONFIG, ...(await res.json()) };
} catch {
  serverDown = true;
}
const L = LABELS[config.locale] ?? LABELS["en-US"];
document.documentElement.lang = config.locale.slice(0, 2);
$("typed").placeholder = L.placeholder;
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

function setState(s) {
  state = s;
  ring.dataset.state = s;
  statusEl.textContent = s === "idle" && serverDown ? L.unreachable : (L[s] ?? "");
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
      wantListening = false;
      statusEl.textContent = L.noMic;
      $("typed").focus();
    } else if (err === "network") {
      if (netRetries < 3) {
        netRetries++;
        retryPending = true;
        setTimeout(() => { retryPending = false; if (wantListening) try { recognition.start(); } catch { /* already running */ } }, 2000);
      } else {
        wantListening = false;
        statusEl.textContent = L.noMic;
        $("typed").focus();
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
    const dog = setTimeout(finish, Math.max(4000, (u.text.length * 120) / (u.rate || 1)));
    s.onend = finish;
    s.onerror = finish;
    speechSynthesis.speak(s);
  });
}

// Royalty-free stand-in: a short gentle tune. On real Alexa+ this is a hand-off to Alexa music.
async function playStandIn(artist) {
  caption("music", `♪ ${artist} — stand-in tune for the demo`);
  const ctx = new AudioContext();
  try { await ctx.resume(); } catch { /* play anyway */ }
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
  speechSynthesis.cancel();
  for (const u of speechPlan(reply)) {
    caption("mia", u.text);
    await speakOne(u);
    await wait(u.pauseAfterMs);
  }
  if (reply.action?.type === "play_music") await playStandIn(reply.action.artist);
}

async function send(turn) {
  if (busy) return false;
  busy = true;
  stopListening();
  setState("thinking");
  caption("rose", turn.text);
  try {
    const res = await fetch("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(turn) });
    if (!res.ok) throw new Error(String(res.status));
    await play(await res.json());
  } catch {
    await play({ sentences: L.fallback, rate: config.rate, breakMs: config.breakMs });
  }
  busy = false;
  listen();
  return true;
}

ring.addEventListener("click", () => {
  started = true;
  if (state === "idle") listen();
});
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("typed").value.trim();
  started = true;
  if (!text || busy) return; // while busy the typed text stays in the box
  $("typed").value = "";
  send({ text, confidence: 1 });
});
$("captions-toggle").addEventListener("change", (e) => { captions.hidden = !e.target.checked; });

// Mia speaks first (Care Mode demo). Browsers only allow sound after the first tap.
const pollBlocked = () =>
  !started || busy || state === "thinking" || state === "speaking" ||
  (wantListening && (taker.hasPending() || Date.now() - lastHeardAt < LISTEN_GRACE_MS));
setInterval(async () => {
  if (pollBlocked()) return;
  busy = true; // one lock for user turns and proactive replies
  let reply = null;
  try {
    const res = await fetch("/api/proactive");
    if (res.ok) ({ reply } = await res.json());
  } catch { /* try again at the next poll */ }
  if (!reply || (wantListening && (taker.hasPending() || Date.now() - lastHeardAt < LISTEN_GRACE_MS))) {
    busy = false;
    return;
  }
  stopListening();
  try { await play(reply); } catch { /* keep going */ }
  busy = false;
  if (started) listen();
}, PROACTIVE_POLL_MS);

setState("idle");
if (!recognition) statusEl.textContent = L.noMic;
