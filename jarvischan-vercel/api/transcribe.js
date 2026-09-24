// Vercel serverless function — speech to text via Groq Whisper.
// The browser records one short utterance and POSTs the raw audio here;
// the Groq key stays server-side. Korean and English are detected automatically.
//
// Request:  POST /api/transcribe?lang=auto|ko|en
//           headers  x-jarvis-password  (encodeURIComponent'd shared password)
//                    x-audio-type       (recorder mime type, e.g. audio/webm)
//                    content-type       application/octet-stream
//           body     raw audio bytes (max 4 MB — Vercel caps request bodies at 4.5 MB)
// Response: { text, language: "ko" | "en" | "" }
//
// Uses the same env vars as api/chat.js: GROQ_API_KEY, JARVIS_PASSWORD.

const MAX_BYTES = 4 * 1024 * 1024;
const MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3",
  "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "m4a" };
const LANG = { korean: "ko", ko: "ko", english: "en", en: "en" };
// Whisper invents these on near-silent clips (Korean YouTube / broadcast outros)
const HALLUCINATION = /^(시청해\s*주셔서\s*감사합니다|구독과\s*좋아요.*|MBC\s*뉴스.*|감사합니다|thank you for watching|thanks for watching|thank you)[.!。\s]*$/i;

async function readAudio(req) {
  // Vercel hands octet-stream bodies over as a Buffer; otherwise read the stream
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : (v || "");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-jarvis-password, x-audio-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const PASS = process.env.JARVIS_PASSWORD || "";
  const KEY = process.env.GROQ_API_KEY || "";

  let given = "";
  try { given = decodeURIComponent(header(req, "x-jarvis-password")); } catch (e) { given = ""; }
  if (PASS && given !== PASS) return res.status(401).json({ error: "bad_password" });
  if (!KEY) return res.status(500).json({ error: "server_missing_key", message: "GROQ_API_KEY is not set on the server." });

  const audio = await readAudio(req);
  if (audio.length > MAX_BYTES) return res.status(413).json({ error: "too_large", message: "Recording is longer than the limit." });
  if (audio.length < 800) return res.status(400).json({ error: "empty_audio", message: "No audio received." });

  const mime = String(header(req, "x-audio-type") || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime] || "webm";
  const q = String((req.query && req.query.lang) || new URL(req.url, "http://x").searchParams.get("lang") || "auto");
  const lang = q === "ko" || q === "en" ? q : "";

  let lastErr = "";
  for (const model of MODELS) {
    const fd = new FormData();
    fd.append("file", new Blob([audio], { type: mime }), "speech." + ext);
    fd.append("model", model);
    fd.append("response_format", "verbose_json");
    fd.append("temperature", "0");
    if (lang) {
      fd.append("language", lang);
      fd.append("prompt", lang === "ko" ? "자비스찬에게 하는 짧은 음성 명령." : "A short voice command to Jarvischan.");
    }
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { authorization: "Bearer " + KEY }, body: fd, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      return res.status(502).json({ error: "upstream", message: "Whisper unreachable: " + String((e && e.message) || e).slice(0, 120) });
    }
    if (r.status === 429) return res.status(429).json({ error: "rate_limited", message: "Speech limit reached — try again shortly." });
    if (!r.ok) {
      lastErr = "Whisper " + r.status + ": " + (await r.text().catch(() => "")).slice(0, 160);
      console.error("transcribe failed", model, lastErr);
      if (r.status === 404 || /model_not_found|does not exist|decommissioned/i.test(lastErr)) continue;  // try the next model
      return res.status(502).json({ error: "upstream", message: lastErr });
    }
    const j = await r.json().catch(() => ({}));
    let text = String(j.text || "").trim();
    const segs = Array.isArray(j.segments) ? j.segments : [];
    if (segs.length && segs.every(s => Number(s.no_speech_prob) > 0.6)) text = "";   // mostly silence
    if (HALLUCINATION.test(text)) text = "";
    const detected = LANG[String(j.language || "").toLowerCase()] || (/[가-힣]/.test(text) ? "ko" : (text ? "en" : ""));
    return res.status(200).json({ text, language: lang || detected, model });
  }
  return res.status(502).json({ error: "upstream", message: lastErr || "no speech model available" });
};
