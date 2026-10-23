// Devpost thumbnail (3:2) in the style of the video's title card -> out/thumbnail.png
import { join } from "node:path";
import { chromium } from "playwright-core";

const OUT = join(new URL(".", import.meta.url).pathname, "out", "thumbnail.png");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1500px;height:1000px;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#f2efe8;
  background:radial-gradient(1300px 900px at 75% 25%,#1d2433,#0b0e14);display:flex;align-items:center;padding:0 110px;gap:90px}
.ring{flex:none;width:420px;height:420px;border-radius:50%;background:#1b2230;border:30px solid #fbb040;box-shadow:0 0 120px rgba(251,176,64,.45)}
.k{font-size:24px;letter-spacing:.2em;text-transform:uppercase;color:#fbb040;font-weight:700;margin-bottom:22px}
h1{font-size:150px;letter-spacing:-.04em;line-height:1}
p{font-size:42px;color:#d6d1c6;margin-top:26px;line-height:1.3}
</style></head><body><div class="ring"></div><div><div class="k">The gentle second brain for Alexa+</div><h1>Mia</h1>
<p>Sure of the day.<br>Safe at home.<br>Family in the loop.</p></div></body></html>`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.setContent(html);
await page.screenshot({ path: OUT });
await browser.close();
console.log(OUT);
