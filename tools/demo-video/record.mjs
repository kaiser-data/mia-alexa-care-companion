// Records one or more scenes of the real Mia app: starts Mia with a demo clock, drives Chrome by typing
// Rose's lines, replaces the browser voice with generated TTS and logs when each voice starts.
// Usage: node record.mjs [sceneId...]
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { tts, ttsEngine } from "./tts.mjs";
import { SCENES } from "./scenes.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const HERE = new URL(".", import.meta.url).pathname;
const OUT = join(HERE, "scenes");
mkdirSync(OUT, { recursive: true });
try { process.loadEnvFile(join(REPO, ".env")); } catch { /* none */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for Amazon SES: Mia's real SES client sends here (AWS_ENDPOINT_URL_SESV2), and the mail is kept for
// the "Tom's inbox" shot.
function startSesStandIn(mails) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        mails.push({ at: Date.now(), subject: m.Content?.Simple?.Subject?.Data, text: m.Content?.Simple?.Body?.Text?.Data });
      } catch { /* not a send call */ }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ MessageId: "demo-" + Date.now() }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function startMia(scene, sesPort) {
  const env = {
    ...process.env,
    MIA_PROFILE: scene.profile,
    MIA_DATA_DIR: `.mia-data/video-${scene.id}-${Date.now()}`,
    MIA_CLOCK_START: scene.clock,
    MIA_ALERT_EMAIL_TO: "tom@example.com",
    MIA_ALERT_EMAIL_FROM: "mia@example.com",
    AWS_ENDPOINT_URL_SESV2: `http://127.0.0.1:${sesPort}`,
    AWS_REGION: "eu-central-1",
    AWS_ACCESS_KEY_ID: "demo",
    AWS_SECRET_ACCESS_KEY: "demo",
    AWS_PROFILE: "",
    MIA_DEV_TOKEN: randomBytes(24).toString("hex"),
  };
  delete env.AWS_PROFILE;
  delete env.AWS_SESSION_TOKEN;
  const child = spawn("node_modules/.bin/tsx", ["packages/voice/src/main.ts"], { cwd: REPO, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://127.0.0.1:8788/")).ok) return { child, log: () => log }; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("Mia did not start:\n" + log);
}
function stopMia(m) { try { process.kill(-m.child.pid, "SIGTERM"); } catch { /* gone */ } }

// Replaces speechSynthesis: each utterance asks Node for TTS and ends after the clip's length.
const STUB = () => {
  const fake = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [], addEventListener() {}, removeEventListener() {},
    cancel() { fake.speaking = false; if (fake._cur) { clearTimeout(fake._t); const c = fake._cur; fake._cur = null; c.onend?.(); } },
    speak(u) {
      fake.speaking = true; fake._cur = u;
      window.__speak(u.text, u.lang).then((ms) => {
        if (fake._cur !== u) return;
        fake._t = setTimeout(() => { if (fake._cur !== u) return; fake._cur = null; fake.speaking = false; u.onend?.(); }, ms);
      });
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
};

async function waitTurnDone(page, { requireSpeaking = true, timeout = 60000 } = {}) {
  const t0 = Date.now();
  let spoke = !requireSpeaking;
  while (Date.now() - t0 < timeout) {
    const s = await page.getAttribute("#ring", "data-state");
    if (s === "speaking") spoke = true;
    if (spoke && s !== "speaking" && s !== "thinking") {
      await sleep(400);
      const again = await page.getAttribute("#ring", "data-state");
      if (again !== "speaking" && again !== "thinking") return;
    }
    await sleep(100);
  }
  throw new Error("turn did not finish");
}

async function recordScene(browser, scene) {
  const de = scene.profile.endsWith("-de");
  // Warm the cache so audio starts when the caption appears.
  for (const st of scene.steps) if (st.rose) await tts(de ? "rose_de" : "rose", st.rose);
  for (const line of scene.expectMia ?? []) {
    for (const sentence of line.split(/(?<=[.?!])\s+/)) await tts(de ? "mia_de" : "mia", sentence);
  }

  const mails = [];
  const ses = await startSesStandIn(mails);
  const mia = await startMia(scene, ses.address().port);
  try {
    await runScene(browser, scene, de, mails);
  } catch (err) {
    console.error(`[${scene.id}] failed: ${err.message}`);
    throw err;
  } finally {
    writeFileSync(join(OUT, `${scene.id}.log`), mia.log());
    stopMia(mia);
    ses.close();
    await sleep(800);
  }
}

async function runScene(browser, scene, de, mails) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, bypassCSP: true });
  const events = [];
  let t0 = 0;
  const now = () => (Date.now() - t0) / 1000;
  await ctx.exposeFunction("__speak", async (text) => {
    const a = await tts(de ? "mia_de" : "mia", text);
    events.push({ t: now(), role: "mia", text, file: a.file, dur: a.dur });
    return Math.round(a.dur * 1000) + 250;
  });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  t0 = Date.now();
  await page.goto("http://127.0.0.1:8788/");
  await page.waitForSelector("#ring");
  // Fit the page into one 720p frame: smaller ring, only the latest captions, and no microphone notice
  // (headless Chrome has no speech recognition; the demo types instead).
  await page.addStyleTag({ content: `
    html, body { overflow: hidden; }
    main { gap: 16px; padding: 24px 16px; }
    .ring { width: 200px; }
    .captions p { font-size: 30px; }
    #notice, .toggle { display: none; }
    .captions { max-height: none; overflow: hidden; }
    .captions p:not(:nth-last-child(-n+3)) { display: none; }
  ` });
  await page.evaluate(() => { const top = () => window.scrollTo(0, 0); addEventListener("scroll", top); setInterval(top, 50); });
  // Frame capture by screenshots (Playwright's screencast leaves a grey band in headless Chrome on macOS).
  const frameDir = join(OUT, `${scene.id}-frames`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const frames = [];
  let capturing = true;
  const capture = (async () => {
    while (capturing) {
      const t = now();
      const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.jpg`);
      try { await page.screenshot({ path: file, type: "jpeg", quality: 90 }); frames.push({ t, file }); } catch { /* page closing */ }
      const wait = 80 - ((now() - t) * 1000);
      if (wait > 0) await sleep(wait);
    }
  })();
  // Start the session the way a tap would, without the microphone.
  await page.evaluate(() => document.getElementById("type-form").requestSubmit());
  const startT = now();

  for (const st of scene.steps) {
    if (st.waitMia) {
      await waitTurnDone(page, { timeout: 70000 });
    } else if (st.rose) {
      await sleep(st.pause ?? 900);
      const a = await tts(de ? "rose_de" : "rose", st.rose);
      events.push({ t: now(), role: "rose", text: st.rose, file: a.file, dur: a.dur });
      const perChar = Math.min(60, (a.dur * 1000 * 0.75) / st.rose.length);
      await page.click("#typed");
      await page.type("#typed", st.rose, { delay: perChar });
      await sleep(Math.max(0, a.dur * 1000 - st.rose.length * perChar));
      await page.press("#typed", "Enter");
      await waitTurnDone(page);
    }
  }
  await sleep(1500);
  const endT = now();
  capturing = false;
  await capture;
  await ctx.close();
  // Variable frame rate -> 25 fps; the video starts at t = 0 (first frame held back to 0).
  let list = "";
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : f.t + 0.08;
    const start = i === 0 ? 0 : f.t;
    list += `file '${f.file}'\nduration ${(next - start).toFixed(3)}\n`;
  });
  list += `file '${frames[frames.length - 1].file}'\n`;
  const listFile = join(frameDir, "list.txt");
  writeFileSync(listFile, list);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=25,format=yuv420p", "-c:v", "libx264", "-crf", "18", join(OUT, `${scene.id}.mp4`)]);
  const mias = events.filter((e) => e.role === "mia").map((e) => e.text);
  writeFileSync(join(OUT, `${scene.id}.json`), JSON.stringify({ id: scene.id, engine: ttsEngine(), startT, endT, events,
    mails: mails.map((m) => ({ t: (m.at - t0) / 1000, subject: m.subject, text: m.text })) }, null, 2));
  console.log(`[${scene.id}] ${events.length} voice events, ${mails.length} mails, ${endT.toFixed(1)} s\n  Mia: ${mias.join(" | ")}`);
  for (const m of mails) console.log(`  Mail: ${m.subject}`);
}

const want = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--window-size=1280,900", "--hide-scrollbars"] });
try {
  for (const s of SCENES) if (!want.length || want.includes(s.id)) await recordScene(browser, s);
} finally {
  await browser.close();
}
