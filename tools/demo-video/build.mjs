// Cuts the recorded scenes (scenes/*.mp4 + *.json from record.mjs) into the demo video: waits removed, voices
// placed on the new timeline, overlays, Tom's inbox, title and closing slides with a narrator.
// Usage: node build.mjs   ->  out/mia-demo.mp4
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { tts } from "./tts.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const SCENES = join(HERE, "scenes");
const OUT = join(HERE, "out");
const TMP = join(OUT, "parts");
mkdirSync(TMP, { recursive: true });
const W = 1280, H = 720, FPS = 25;

const REPO_URL = "github.com/kaiser-data/mia-alexa-care-companion";

// The app scenes in running order, with the on-screen time and the caption.
const PLAN = [
  { id: "pills", when: "Monday · 8:00 AM", note: "Mia speaks first at pill time", caption: "Answers from the recorded dose, every time.", mail: false, drop: ["Your next pills are at eight o'clock in the evening."] },
  { id: "health", when: "Monday · 2:20 PM", note: "A health question", clock: "2:20", caption: "Health questions go to Tom, who knows her best.", mail: true },
  { id: "fell", when: "Monday · 4:10 PM", note: "A cry for help", clock: "4:10", caption: "A call for help reaches the family at once.", mail: true },
  { id: "night", when: "Tuesday · 2:00 AM", note: "Woken in the night", caption: "The same calm words, every night.", mail: false },
  { id: "german", when: "Montag · 10:30", note: "The same Mia in German", clock: "10:30", caption: "“Help, I fell.” → “I've told Tom right away.” Same alarm path, German templates.", mail: true },
];

const NARRATION = {
  intro: "I built Mia for my mum. She lives alone with dementia. I want her to manage on her own, with a companion she can simply talk to, and I want to know when she needs me.",
  arch: "The browser is a real MCP client. The model selects tools and fixed phrases; it never writes Mia's spoken answers. Pill questions and cries for help bypass the model. It deploys to AWS EC2 in Frankfurt, with Amazon SES for alerts.",
  care: "Care Mode is our proposal for Alexa Plus: a companion that speaks first at agreed times, and answers care questions without a name.",
  impact: "Alexa is already at home with millions of families. Mia turns that speaker into an affordable companion for every senior living alone, improved from the cloud every day, tuned to their needs. Life gets easier for them, and their families can relax.",
  next: "Next: a voice loop tuned for older speakers, a care page for families, and Mia on a real Echo.",
};

const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- HTML cards and overlays, rendered to PNG ----------
const BASE_CSS = `
  *{box-sizing:border-box;margin:0}
  body{width:${W}px;height:${H}px;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#f2efe8;overflow:hidden}
  .card{width:${W}px;height:${H}px;background:radial-gradient(1200px 700px at 70% 20%,#1d2433,#0b0e14);padding:80px 96px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:18px;letter-spacing:.2em;text-transform:uppercase;color:#fbb040;font-weight:700;margin-bottom:18px}
  h1{font-size:96px;letter-spacing:-.03em;line-height:1}
  h2{font-size:52px;letter-spacing:-.02em;line-height:1.1;margin-bottom:34px}
  .sub{font-size:30px;color:#c9c4b8;margin-top:18px;line-height:1.35;max-width:950px}
  .small{position:absolute;left:96px;bottom:44px;font-size:16px;color:#7f8794}
`;

function titleCard() {
  return `<div class="card"><div class="kicker">The gentle second brain for Alexa+</div><h1>Mia</h1>
    <p class="sub">Always remembers. Sure of the day, safe at home, family in the loop.<br><span style="font-size:26px;color:#c9c4b8">Built by a son for his mother, who lives alone with dementia.</span></p>
    <p class="sub" style="font-size:24px;color:#a8b0bc">In the demo: Rose, 81, and her son Tom, who lives two hours away.</p>
    <p style="position:absolute;left:96px;bottom:48px;font-size:22px;color:#a8b0bc">Real app · typed input · ElevenLabs voices · waits shortened · Rose and Tom are fictional</p></div>`;
}
function archCard() {
  const steps = [
    ["Browser simulator", "a real MCP client · Rose speaks, no name needed"],
    ["Mia Voice", "the language model picks a tool + reviewed phrases"],
    ["Mia MCP server", "16 tools · Streamable HTTP · bearer token"],
    ["Encrypted store", "SQLite · AES-256-GCM"],
    ["Alarm email", "Amazon SES → Tom's inbox"],
  ];
  return `<div class="card"><div class="kicker">How it works</div><h2>The model chooses. Templates speak.</h2>
    <div style="display:grid;gap:12px">${steps.map((s, i) => `
      <div style="display:grid;grid-template-columns:40px 260px 1fr;align-items:center;background:#161b24;border:1px solid #273042;border-radius:12px;padding:14px 22px;font-size:24px">
        <span style="color:#fbb040;font-weight:800;font-family:Menlo,monospace">${i + 1}</span><b>${s[0]}</b><span style="color:#a8b0bc">${s[1]}</span></div>`).join("")}</div>
    <p style="margin-top:24px;font-size:20px;color:#a8b0bc">Pill questions and cries for help bypass the model · deploys to EC2 Frankfurt with Amazon SES alerts</p></div>`;
}
function careCard() {
  const items = ["Care topics reach a trusted add-on without its name.", "The add-on may speak first at agreed times.", "The carer sets limits on both."];
  return `<div class="card"><div class="kicker">Proposal · not current Alexa+ behaviour</div><h2>Care Mode</h2>
    <ol style="list-style:none;padding:0;display:grid;gap:26px">${items.map((t, i) => `
      <li style="display:grid;grid-template-columns:64px 1fr;font-size:38px;line-height:1.25"><span style="color:#fbb040;font-weight:800;font-family:Menlo,monospace">${i + 1}</span>${t}</li>`).join("")}</ol></div>`;
}
function impactCard() {
  const items = [
    ["Everywhere", "Alexa is already at home with millions of families"],
    ["Affordable", "runs on the speaker they already own"],
    ["Always improving", "updated from the cloud, tuned to seniors"],
    ["Peace of mind", "easier days for them, calmer days for the family"],
  ];
  return `<div class="card"><div class="kicker">The bigger picture</div><h2>A gentle second brain in every home</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">${items.map(([t, d]) => `
      <div style="background:#161b24;border:1px solid #273042;border-radius:14px;padding:22px 26px">
        <div style="font-size:30px;font-weight:750;color:#fbb040">${t}</div><div style="font-size:22px;color:#c9c4b8;margin-top:6px">${d}</div></div>`).join("")}</div></div>`;
}
function nextCard() {
  const items = [["Voice loop tested with older speakers", "hear them reliably, answer faster"], ["Carer plan and alerts page", "Tom edits the plan and sees the day"], ["Alexa+ device integration", "as soon as access opens"]];
  return `<div class="card"><div class="kicker">What's next</div><h2>From prototype to her kitchen</h2>
    <div style="display:grid;gap:16px">${items.map((t, i) => `
      <div style="display:grid;grid-template-columns:56px 1fr;align-items:baseline;font-size:36px;line-height:1.25"><span style="color:#fbb040;font-weight:800;font-family:Menlo,monospace">${i + 1}</span>
        <span><b>${t[0]}</b><br><span style="font-size:24px;color:#a8b0bc">${t[1]}</span></span></div>`).join("")}</div></div>`;
}
function endCard() {
  return `<div class="card" style="align-items:center;text-align:center"><h1 style="font-size:120px">Mia</h1>
    <p class="sub" style="margin:14px auto 40px">Always remembers. Sure of the day, safe at home, family in the loop.</p>
    <p style="font-family:Menlo,monospace;font-size:28px">${REPO_URL}</p>
    <p style="font-size:20px;color:#a8b0bc;margin-top:14px">Open source · MIT · Prototype, not an emergency service · Fictional persona: Rose Whitaker</p></div>`;
}
function inboxCard(mail) {
  const body = esc(mail.text ?? "").replace(/\n/g, "<br>");
  return `<div class="card" style="justify-content:flex-start;padding:56px 96px">
    <div class="kicker">Carer alert · the email Mia sent</div>
    <div style="background:#f7f7f5;color:#1b1d22;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5)">
      <div style="display:flex;gap:14px;align-items:center;padding:18px 26px;background:#ecebe6;border-bottom:1px solid #dcdad3;font-size:18px;color:#5d6370">
        <span style="width:12px;height:12px;border-radius:6px;background:#e5534b"></span><span style="width:12px;height:12px;border-radius:6px;background:#e3b341"></span><span style="width:12px;height:12px;border-radius:6px;background:#57ab5a"></span>
        <span style="margin-left:14px">Inbox — tom@example.com</span></div>
      <div style="padding:28px 34px">
        <div style="font-size:18px;color:#5d6370;margin-bottom:6px">From: Mia &lt;mia@example.com&gt;</div>
        <div style="font-size:30px;font-weight:700;margin-bottom:22px;line-height:1.25">${esc(mail.subject)}</div>
        <div style="font-size:21px;line-height:1.55;color:#2b2f37">${body}</div>
      </div></div>
    <p style="margin-top:18px;font-size:18px;color:#a8b0bc">App-generated email, captured by a local Amazon SES stand-in for this recording.</p></div>`;
}
function phoneCard(mail, clock) {
  const title = String(mail.subject ?? "").replace(/^\[Mia\]\s*/, "");
  const urgent = /URGENT/.test(title);
  return `<div style="position:absolute;left:18px;top:200px;width:252px;height:440px;border-radius:36px;background:#05070a;border:3px solid #39404d;
      box-shadow:0 20px 60px rgba(0,0,0,.6);padding:16px 12px;font-family:-apple-system,Helvetica,Arial,sans-serif">
    <div style="text-align:center;color:#c9c4b8;font-size:13px;font-weight:600">Tom's phone</div>
    <div style="text-align:center;color:#f2efe8;font-size:44px;font-weight:300;margin:6px 0 14px">${clock}</div>
    <div style="background:rgba(242,239,232,.95);color:#1b1d22;border-radius:16px;padding:12px 13px;${urgent ? "border:3px solid #e5534b;" : ""}">
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#5d6370;margin-bottom:6px">
        <span style="width:20px;height:20px;border-radius:6px;background:#fbb040;display:grid;place-items:center;color:#1a1206;font-weight:800;font-size:12px">M</span>
        <b style="color:#1b1d22">Mia</b><span style="margin-left:auto">now</span></div>
      <div style="font-size:15px;font-weight:700;line-height:1.3">${esc(title.replace(/\.$/, ""))}</div>
      <div style="font-size:12px;color:#5d6370;margin-top:6px">Severity: ${urgent ? "high" : "medium"} · email alert</div></div>
    <div style="position:absolute;left:12px;right:12px;bottom:14px;font-size:10px;color:#7f8794;text-align:center;line-height:1.3">The email Mia sent, captured by a local Amazon SES stand-in for this recording</div>
  </div>`;
}
function overlay(p) {
  return `<div style="position:absolute;left:24px;top:52px;display:flex;gap:10px;align-items:center">
      <span style="background:rgba(11,14,20,.85);border:1px solid #39404d;border-radius:999px;padding:8px 16px;font-size:20px;font-weight:700">${esc(p.when)}</span>
      <span style="background:rgba(251,176,64,.92);color:#1a1206;border-radius:999px;padding:8px 16px;font-size:18px;font-weight:700">${esc(p.note)}</span></div>
    <div style="position:absolute;right:24px;top:52px;background:rgba(11,14,20,.85);border:1px solid #39404d;border-radius:999px;padding:8px 16px;font-size:16px;color:#c9c4b8">Browser simulator · proposed Care Mode</div>
    <div style="position:absolute;right:24px;top:110px;width:330px;background:rgba(11,14,20,.9);border-left:4px solid #fbb040;border-radius:10px;padding:14px 18px;font-size:22px;line-height:1.35;font-weight:600">${esc(p.caption)}</div>`;
}

async function renderPngs(browser, items) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const { html, file, transparent } of items) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${transparent ? "body{background:transparent}" : ""}</style></head><body>${html}</body></html>`);
    await page.screenshot({ path: file, omitBackground: Boolean(transparent) });
  }
  await page.close();
}


// The AWS infrastructure diagram, built up in stages in step with the narration.
const INFRA_STEPS = [
  "Rose just talks. Her words reach one small server on Amazon EC2, in Frankfurt.",
  "A language model picks one of sixteen MCP tools. Every word she hears comes from reviewed templates.",
  "Her data stays encrypted, in the EU.",
  "Alerts go out through Amazon SES, and Tom knows within seconds.",
  "All for about seventeen dollars a month.",
];
function infraCard(stage) {
  // [stage, x, y, w, h, title, detail]
  const boxes = [
    [1, 40, 300, 175, 120, "Rose's home", "Echo or browser · she just talks"],
    [1, 305, 232, 410, 62, "Caddy", "HTTPS · basic auth"],
    [1, 305, 312, 410, 72, "Mia Voice", "Care Mode · speaks first"],
    [2, 305, 402, 410, 72, "Mia MCP server", "16 tools · Streamable HTTP"],
    [2, 1045, 196, 200, 120, "Language model", "picks tools + phrase ids only"],
    [3, 305, 492, 410, 56, "Encrypted store", "SQLite · AES-256-GCM · encrypted EBS"],
    [4, 770, 402, 215, 72, "IAM instance role", "zero stored credentials"],
    [4, 770, 540, 215, 72, "Amazon SES", "alarm email"],
    [4, 1045, 532, 200, 88, "Tom's inbox", "within seconds"],
  ];
  // [stage, x1, y1, x2, y2]
  const arrows = [
    [1, 215, 360, 303, 268], [1, 510, 294, 510, 310], [2, 510, 384, 510, 400], [2, 715, 340, 1043, 262],
    [3, 510, 474, 510, 490], [4, 715, 438, 768, 438], [4, 877, 474, 877, 538], [4, 985, 576, 1043, 576],
  ];
  const on = (st) => st <= stage;
  const hot = (st) => st === stage && stage < 5;
  const box = ([st, x, y, w, h, t, d]) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:12px;
    background:${hot(st) ? "#2a2113" : "#161b24"};border:2px solid ${hot(st) ? "#fbb040" : "#2c3545"};opacity:${on(st) ? 1 : 0.12};
    ${hot(st) ? "box-shadow:0 0 28px rgba(251,176,64,.35);" : ""}display:flex;flex-direction:column;justify-content:center;padding:0 16px">
    <b style="font-size:21px">${t}</b><span style="font-size:15px;color:#a8b0bc;margin-top:2px">${d}</span></div>`;
  const line = ([st, x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hot(st) ? "#fbb040" : "#5b6578"}" stroke-width="3"
    marker-end="url(#${hot(st) ? "ah" : "a"})" opacity="${on(st) ? 1 : 0.12}"/>`;
  return `<div class="card" style="padding:0;display:block;position:relative">
    <div style="position:absolute;left:40px;top:34px"><div class="kicker" style="margin-bottom:8px">Built on AWS</div>
      <div style="font-size:40px;font-weight:750;letter-spacing:-.02em">One small server. A safe design.</div></div>
    <div style="position:absolute;left:252px;top:150px;width:760px;height:520px;border:2px dashed #3d4a5f;border-radius:18px"></div>
    <div style="position:absolute;left:270px;top:160px;font-size:15px;color:#8f9bb0;font-weight:700;letter-spacing:.06em">AWS CLOUD · EU-CENTRAL-1 (FRANKFURT)</div>
    <div style="position:absolute;left:285px;top:190px;width:450px;height:375px;border:2px solid #2c3545;border-radius:14px;opacity:${on(1) ? 1 : 0.12}"></div>
    <div style="position:absolute;left:300px;top:196px;font-size:15px;color:#fbb040;font-weight:700">Amazon EC2 · t4g.small</div>
    <svg width="1280" height="720" style="position:absolute;left:0;top:0">
      <defs><marker id="a" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5b6578"/></marker>
      <marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fbb040"/></marker></defs>
      ${arrows.map(line).join("")}</svg>
    ${boxes.map(box).join("")}
    ${stage >= 5 ? `<div style="position:absolute;left:252px;top:686px;width:760px;text-align:center;font-size:18px;color:#fbb040;font-weight:700;top:640px">≈ $17 a month · deployed with two scripts</div>` : ""}
  </div>`;
}

// Several stills, one per narration sentence, cut together without fades between them.
async function stagedPart(name, pngs, sentences) {
  const out = join(TMP, `${name}.mp4`);
  const lead = 0.5, gap = 0.35;
  const clips = [];
  for (const t of sentences) clips.push(await tts("narrator", t));
  const durs = clips.map((c, i) => (i === 0 ? lead : 0) + c.dur + (i === clips.length - 1 ? 0.9 : gap));
  const total = durs.reduce((a, b) => a + b, 0);
  const args = [];
  pngs.forEach((p, i) => args.push("-loop", "1", "-framerate", String(FPS), "-t", durs[i].toFixed(3), "-i", p));
  clips.forEach((c) => args.push("-i", c.file));
  let f = pngs.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}]`).join(";");
  f += `;${pngs.map((_, i) => `[v${i}]`).join("")}concat=n=${pngs.length}:v=1:a=0,fade=t=in:st=0:d=0.35,fade=t=out:st=${(total - 0.35).toFixed(2)}:d=0.35[v]`;
  let at = lead;
  clips.forEach((c, i) => {
    const ms = Math.round(at * 1000);
    f += `;[${pngs.length + i}:a]adelay=${ms}|${ms}[a${i}]`;
    at += c.dur + gap;
  });
  f += `;${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}[a]`;
  run([...args, "-filter_complex", f, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), ...ENC, out]);
  return out;
}

// ---------- parts ----------
const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

async function cardPart(name, png, narration, minDur) {
  const out = join(TMP, `${name}.mp4`);
  const lead = 0.6;
  let dur = minDur;
  const args = ["-loop", "1", "-framerate", String(FPS), "-i", png];
  let filter;
  if (narration) {
    const a = await tts("narrator", narration);
    dur = Math.max(minDur, lead + a.dur + 0.9);
    args.push("-i", a.file);
    filter = `[1:a]adelay=${lead * 1000}|${lead * 1000},apad,atrim=0:${dur}[a]`;
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    filter = `[1:a]atrim=0:${dur}[a]`;
  }
  filter += `;[0:v]trim=0:${dur},fade=t=in:st=0:d=0.35,fade=t=out:st=${(dur - 0.35).toFixed(2)}:d=0.35,setpts=PTS-STARTPTS[v]`;
  run([...args, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(2), ...ENC, out]);
  return out;
}

// Keeps the stretches around each voice and cuts the waits in between.
function keepSegments(events, end, extraEnd) {
  const raw = events.map((e) => [Math.max(0, e.t - (e.role === "rose" ? 0.6 : 0.7)), Math.min(end, e.t + e.dur + 0.35)]);
  raw.sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [a, b] of raw) {
    const last = segs[segs.length - 1];
    if (last && a - last[1] < 0.8) last[1] = Math.max(last[1], b);
    else segs.push([a, b]);
  }
  segs[segs.length - 1][1] = Math.min(end, segs[segs.length - 1][1] + (extraEnd ?? 0.6));
  return segs;
}

function scenePart(p, overlayPng, phonePng) {
  const meta = JSON.parse(readFileSync(join(SCENES, `${p.id}.json`), "utf8"));
  const video = join(SCENES, `${p.id}.mp4`);
  meta.events = meta.events.filter((e) => !(p.drop ?? []).includes(e.text));
  const mail = p.mail ? meta.mails?.[0] : null;
  const segs = keepSegments(meta.events, meta.endT, mail ? 2.2 : undefined);
  // Old time -> new time.
  const map = (t) => {
    let acc = 0;
    for (const [a, b] of segs) {
      if (t >= a && t <= b) return acc + (t - a);
      acc += b - a;
    }
    return null;
  };
  const total = segs.reduce((s, [a, b]) => s + (b - a), 0);
  const inputs = ["-i", video, "-loop", "1", "-framerate", String(FPS), "-i", overlayPng];
  let f = segs.map(([a, b], i) => `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS[s${i}]`).join(";");
  f += `;${segs.map((_, i) => `[s${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[cut]`;
  if (mail && phonePng) {
    // The mail time, or the next kept moment if it fell into a cut.
    let mt = map(mail.t);
    if (mt === null) { let acc = 0; for (const [a, b] of segs) { if (a >= mail.t) { mt = acc; break; } acc += b - a; } }
    mt = Math.min(mt ?? total - 2, total - 1.8);
    inputs.push("-loop", "1", "-framerate", String(FPS), "-i", phonePng);
    f += `;[cut][1:v]overlay=0:0:shortest=1[ov];[ov][2:v]overlay=x='if(lt(t,${mt.toFixed(2)}),-320,min(0,-320+(t-${mt.toFixed(2)})*1400))':y=0:shortest=1[v]`;
  } else {
    f += `;[cut][1:v]overlay=0:0:shortest=1[v]`;
  }
  const firstAudio = inputs.filter((x) => x === "-i").length;
  const voices = meta.events.map((e) => ({ ...e, nt: map(e.t) })).filter((e) => e.nt !== null);
  voices.forEach((e, i) => {
    inputs.push("-i", e.file);
    const ms = Math.round(e.nt * 1000);
    f += `;[${i + firstAudio}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  f += `;${voices.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[a]`;
  const out = join(TMP, `${p.id}.mp4`);
  run([...inputs, "-filter_complex", f, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), ...ENC, out]);
  return { out, total, mails: meta.mails ?? [] };
}

// ---------- main ----------
const browser = await chromium.launch({ channel: "chrome", headless: true });
const png = (n) => join(TMP, `${n}.png`);
const cards = [
  { html: titleCard(), file: png("title") },
  ...INFRA_STEPS.map((_, i) => ({ html: infraCard(i + 1), file: png(`infra-${i + 1}`) })),
  { html: careCard(), file: png("care") },
  { html: impactCard(), file: png("impact") },
  { html: nextCard(), file: png("next") },
  { html: endCard(), file: png("end") },
  ...PLAN.map((p) => ({ html: overlay(p), file: png(`ov-${p.id}`), transparent: true })),
];
const mailsBy = {};
for (const p of PLAN.filter((x) => x.mail)) {
  const meta = JSON.parse(readFileSync(join(SCENES, `${p.id}.json`), "utf8"));
  if (meta.mails?.[0]) { mailsBy[p.id] = meta.mails[0]; cards.push({ html: phoneCard(meta.mails[0], p.clock), file: png(`phone-${p.id}`), transparent: true }); }
}
await renderPngs(browser, cards);
await browser.close();

const parts = [];
parts.push(await cardPart("title", png("title"), NARRATION.intro, 6));
for (const p of PLAN) {
  const s = scenePart(p, png(`ov-${p.id}`), mailsBy[p.id] ? png(`phone-${p.id}`) : null);
  parts.push(s.out);
}
parts.push(await stagedPart("infra", INFRA_STEPS.map((_, i) => png(`infra-${i + 1}`)), INFRA_STEPS));
parts.push(await cardPart("impact", png("impact"), NARRATION.impact, 8));
parts.push(await cardPart("care", png("care"), NARRATION.care, 8));
parts.push(await cardPart("next", png("next"), NARRATION.next, 8));
parts.push(await cardPart("end", png("end"), null, 4));

const list = join(TMP, "list.txt");
writeFileSync(list, parts.map((f) => `file '${f}'`).join("\n"));
const final = join(OUT, "mia-demo.mp4");
run(["-f", "concat", "-safe", "0", "-i", list, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", ...ENC, "-movflags", "+faststart", final]);
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString());
if (dur > 178) console.error(`WARNING: ${dur.toFixed(1)} s is over the 3:00 budget`);
console.log(`${final}  ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}`);
for (const f of parts) console.log(`  ${f.split("/").pop()}  ${Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString()).toFixed(1)} s`);
