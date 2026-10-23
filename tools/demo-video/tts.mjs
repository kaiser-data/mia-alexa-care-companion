// Text to speech with a cache. ElevenLabs (SDK, key from the project's .env.local) when the key is there,
// macOS `say` otherwise.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

try { process.loadEnvFile(new URL("../../.env.local", import.meta.url).pathname); } catch { /* no key: macOS voices */ }

const HERE = new URL(".", import.meta.url).pathname;
const CACHE = join(HERE, "tts-cache");
mkdirSync(CACHE, { recursive: true });

// role -> ElevenLabs voice id + language, macOS fallback voice
const ROLES = {
  rose: { voice: process.env.EL_VOICE_ROSE ?? "5u41aNhyCU6hXOcjPPv0", lang: "en", say: "Moira" }, // Carol, grandmotherly
  mia: { voice: process.env.EL_VOICE_MIA ?? "EXAVITQu4vr4xnSDxMaL", lang: "en", say: "Samantha" }, // Sarah, reassuring
  rose_de: { voice: process.env.EL_VOICE_ROSE ?? "5u41aNhyCU6hXOcjPPv0", lang: "de", say: "Anna" },
  mia_de: { voice: process.env.EL_VOICE_MIA ?? "EXAVITQu4vr4xnSDxMaL", lang: "de", say: "Anna" },
  narrator: { voice: process.env.EL_VOICE_NARRATOR ?? "cjVigY5qzO86Huf0OWal", lang: "en", say: "Daniel" }, // Eric
};

const client = process.env.ELEVENLABS_API_KEY ? new ElevenLabsClient() : null;
export function ttsEngine() { return client ? "elevenlabs" : "say"; }

export function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

export async function tts(role, text) {
  const r = ROLES[role];
  if (!r) throw new Error(`unknown role ${role}`);
  const engine = ttsEngine();
  const voice = engine === "elevenlabs" ? r.voice : r.say;
  const key = createHash("sha1").update(`${engine}|${voice}|${r.lang}|${text}`).digest("hex").slice(0, 16);
  const out = join(CACHE, `${role}-${key}.wav`);
  if (!existsSync(out)) {
    const raw = out.replace(/\.wav$/, engine === "elevenlabs" ? ".mp3" : ".aiff");
    if (engine === "elevenlabs") {
      const audio = await client.textToSpeech.convert(voice, {
        text, modelId: "eleven_v4", languageCode: r.lang, outputFormat: "mp3_44100_128",
        voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
      });
      await pipeline(Readable.fromWeb(audio), createWriteStream(raw));
    } else {
      execFileSync("say", ["-v", voice, "-o", raw, text]);
    }
    // Trim leading/trailing silence so the clip lines up with the captions.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af",
      "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
      "-ar", "48000", "-ac", "2", out]);
  }
  return { file: out, dur: duration(out) };
}
