// Builds out/devpost.html: one copy button per Devpost form field, filled from docs/project/*.md.
// Usage: node devpost-sheet.mjs [youtube-url]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("../..", import.meta.url).pathname;
const OUT = join(new URL(".", import.meta.url).pathname, "out", "devpost.html");
const VIDEO = process.argv[2] || "<paste the YouTube link>";
const REPO_URL = "https://github.com/kaiser-data/mia-alexa-care-companion";
const read = (p) => readFileSync(join(REPO, p), "utf8");

// "## Heading" -> body, from a markdown file.
function sections(md) {
  const out = {};
  let cur = null;
  for (const line of md.split("\n")) {
    const m = line.match(/^## (.+)$/);
    if (m) { cur = m[1].trim(); out[cur] = []; continue; }
    if (cur) out[cur].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join("\n").trim();
  return out;
}
// Devpost renders markdown, but repo-relative links break: point them at GitHub.
const absLinks = (s) => s.replace(/\]\((?!https?:|#)([^)]+)\)/g, (_, p) => `](${REPO_URL}/blob/main/docs/project/${p.replace(/^\.\.\/\.\.\//, "../../")})`)
  .replace(/blob\/main\/docs\/project\/\.\.\/\.\.\//g, "blob/main/");

const story = sections(read("docs/project/story.md"));
const feedback = read("docs/project/product-feedback.md");
const fb = sections(feedback);
const friction = read("docs/project/friction-log.md");
const care = read("docs/project/care-mode-proposal.md");
const testing = execFileSync("git", ["-C", REPO, "show", "29c0b0e:docs/submission/devpost.md"]).toString()
  .split("## Testing instructions for judges")[1].trim();

const fields = [
  ["Project overview", "Project name", "Mia: Always Remembers"],
  ["Project overview", "Elevator pitch (200)", "Your day, remembered. Your family, reassured. Mia is a gentle second brain on Alexa+ for seniors living with dementia: it keeps daily routines on track and keeps the family close."],
  ["Project details", "About the project (one field, all sections)", readFileSync(join(new URL(".", import.meta.url).pathname, "about.md"), "utf8").trim()],
  ["Project details", "Inspiration", absLinks(story["Inspiration"])],
  ["Project details", "What it does", absLinks(story["What it does"])],
  ["Project details", "How we built it", absLinks(story["How it was built"])],
  ["Project details", "Challenges we ran into", absLinks(story["Challenges"])],
  ["Project details", "Accomplishments that we're proud of", absLinks(story["What worked"])],
  ["Project details", "What we learned", absLinks(story["What was learned"])],
  ["Project details", "What's next for Mia", absLinks(story["What's next"])],
  ["Project details", "Built with (tags)", "typescript, node.js, model-context-protocol, mcp, hono, sqlite, vitest, amazon-ec2, amazon-ses, aws-iam, caddy, alexa-skills-kit, web-speech-api, elevenlabs, anthropic, featherless, open-meteo"],
  ["Project details", "Try it out links", `${REPO_URL}\n${VIDEO}`],
  ["Project details", "Video demo link", VIDEO],
  ["Additional info", "Track", "Alexa+"],
  ["Additional info", "Mini challenges", "AWS Builder, Open Source"],
  ["Additional info", "Repository URL", REPO_URL],
  ["Additional info", "GitHub username", "kaiser-data"],
  ["Additional info", "Testing instructions", testing.replace(/Mia is a hackathon prototype/, "Mia is a prototype")],
  ["Feedback", "Q1 Tools, APIs, SDKs used", absLinks(fb["1. Tools, APIs and SDKs used, and for what"])],
  ["Feedback", "Q2 What worked well", absLinks(fb["2. What worked well"])],
  ["Feedback", "Q3 What needs work", absLinks(fb["3. What needs work"])],
  ["Feedback", "Q4 Onboarding", absLinks(fb["4. Onboarding: zero to hello world"])],
  ["Feedback", "Q5 Build again?", absLinks(fb["5. Would we build with these devices and services again?"])],
  ["Feedback", "AI tools used", "Claude Code (Claude Opus) for design, code, tests and reviews; OpenAI Codex CLI for independent code and video reviews; Featherless (gpt-oss-120b) and Anthropic Claude as Mia's tool-picking model; ElevenLabs for the demo video voices; image generation for the brand images."],
  ["Additional info", "Product feedback (all)", absLinks(feedback.replace(/^# .*\n+/, ""))],
  ["Additional info", "AWS services used (§7)", absLinks(fb["7. AWS Builder mini challenge: which AWS services and how"])],
  ["Additional info", "Open Source (§8)", absLinks(fb["8. Open Source mini challenge"])],
  ["Additional info", "Feature requests (§6)", absLinks(fb["6. Feature requests"])],
  ["Additional info", "Friction log", absLinks(friction.replace(/^# .*\n+/, ""))],
  ["Additional info", "Care Mode proposal", absLinks(care.replace(/^# .*\n+/, ""))],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let group = "";
const rows = fields.map(([g, label, text], i) => {
  const head = g !== group ? `<h2>${esc((group = g))}</h2>` : "";
  return `${head}<section><div class="row"><b>${esc(label)}</b><span class="n">${text.length} chars</span>
    <button data-i="${i}">Copy</button></div><pre>${esc(text)}</pre></section>`;
}).join("\n");

writeFileSync(OUT, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mia Devpost Fields</title><style>
:root{--bg:#f5f3ee;--s:#fff;--ink:#1b1d22;--m:#5d6370;--l:#e2ded4;--a:#c2410c}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111317;--s:#1a1d23;--ink:#eceae4;--m:#9aa0ab;--l:#2b2f37;--a:#fb923c}}
:root[data-theme=dark]{--bg:#111317;--s:#1a1d23;--ink:#eceae4;--m:#9aa0ab;--l:#2b2f37;--a:#fb923c}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px 80px}h1{margin:0 0 4px}p.m{color:var(--m);margin:0 0 20px}
h2{margin:28px 0 10px;font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--a)}
section{background:var(--s);border:1px solid var(--l);border-radius:10px;margin-bottom:10px;overflow:hidden}
.row{display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--l)}.row b{flex:1}
.n{color:var(--m);font-size:13px}button{border:1px solid var(--a);background:var(--a);color:#fff;border-radius:7px;padding:5px 14px;font-weight:600;cursor:pointer}
button.ok{background:transparent;color:var(--a)}pre{margin:0;padding:12px 14px;max-height:160px;overflow:auto;white-space:pre-wrap;font:13px/1.45 ui-monospace,Menlo,monospace;color:var(--m)}
</style></head><body><main><h1>Mia · Devpost fields</h1><p class="m">Click Copy, paste into the form. Thumbnail: out/thumbnail.png · Video: out/mia-demo.mp4</p>
${rows}</main><script>
const T=${JSON.stringify(fields.map((f) => f[2]))};
document.addEventListener("click",async e=>{const b=e.target.closest("button[data-i]");if(!b)return;
try{await navigator.clipboard.writeText(T[b.dataset.i]);}catch{const t=document.createElement("textarea");t.value=T[b.dataset.i];document.body.append(t);t.select();document.execCommand("copy");t.remove();}
b.textContent="Copied ✓";b.classList.add("ok");});
</script></body></html>`);
console.log(OUT);
