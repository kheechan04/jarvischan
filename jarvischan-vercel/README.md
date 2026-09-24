# Jarvischan (Vercel)

A voice-driven "Jarvischan" command center you can deploy to a public URL.
Speak to it, it replies out loud, shows live weather + search-style result
cards, and runs a real LLM brain — all for **$0** using Groq's free tier.
A shared **password** gates it so strangers can't burn your free quota.

- **Voice in / out + clap-to-wake + wake-word** — say "Jarvischan" / "자비스찬"
  to start listening hands-free, or clap twice, or just tap the mic. Works
  smoothly once deployed to https (browser remembers the mic permission
  after one Allow).
- **Brain** — Groq (free, fast open models). The key stays server-side.
- **Weather** — live via open-meteo (no key).
- **Control your own computer** — an optional local agent (see §5 below) lets
  it open apps, URLs and files, take screenshots, adjust volume, etc.
- Not included: your personal Calendar/Gmail/Notion connectors (those only
  work inside the claude.ai artifact version).

## 1. Get a free Groq key (no credit card)
1. Go to https://console.groq.com and sign in.
2. **API Keys → Create API Key** → copy it (starts with `gsk_...`).

## 2. Deploy to Vercel

**Option A — drag & drop / Git (easiest)**
1. Put this folder in a GitHub repo (or use Vercel's "deploy folder").
2. On https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other**. If you imported this whole repository, set
   **Root Directory** to `jarvischan-vercel`. Deploy.

**Option B — CLI**
```bash
npm i -g vercel
cd jarvischan-vercel
vercel        # follow prompts
vercel --prod # deploy to production
```

## 3. Set environment variables (Vercel → Project → Settings → Environment Variables)
| Name | Value |
| --- | --- |
| `GROQ_API_KEY` | your `gsk_...` key |
| `JARVIS_PASSWORD` | any password you choose |
| `GROQ_MODEL` | *(optional)* pin a model such as `openai/gpt-oss-120b`. Leave it unset and the server picks the first model your key can use (`PREFERRED` in `api/chat.js`). |

After adding them, **redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the values.

## 4. Use it
- Open your `https://<project>.vercel.app` URL.
- Enter the password once.
- Tap the mic (allow the microphone once) and speak Korean or English — Groq
  Whisper detects which, and Jarvischan answers in the same language. The **Lang**
  menu can pin one language.
- Try: *"what can you do?"*, *"system check"*, *"weather in Busan"*,
  *"is the air bad today?"*, *"100 dollars in won"*, *"who is Sam Altman?"*,
  *"next holiday"*, *"tech headlines"*, *"timer 25 minutes"*, or just chat.
  In Korean too: *"오늘 미세먼지 어때?"*, *"제주 날씨 어때?"*, *"25분 타이머 맞춰줘"*.
- The brain calls real tools on the server (`api/chat.js` → `IMPL`): Open-Meteo
  weather + air quality, Frankfurter (ECB) currency, Wikipedia, Nager.Date
  holidays, Hacker News, and a browser timer. None of them need a key.
- Toggle **Clap ×2 to wake** to start listening by clapping twice, or
  **Say "Jarvischan" to wake** for hands-free voice activation.

## 5. Optional: let it control your own computer (local agent)

The tools above all run on Vercel's servers, which can only reach the public
internet — they have no way to open an app on *your* computer. For that,
there's a separate small program you run locally: see
[`../local-agent/README.md`](../local-agent/README.md). Once it's running and
paired (one click, one pasted token), you can say things like "open Chrome",
"take a screenshot", or "lock my screen" and it actually happens on your
machine. Windows only for now.

## Notes
- **Cost:** Vercel Hobby = free, Groq free tier = free. No billing attached.
- **Limits:** free models have per-minute / per-day caps (fine for personal use;
  if you share widely you may hit them — that only pauses replies, no charge).
- Voice input goes through Groq Whisper (`api/transcribe.js`), so it works in
  any browser that can record; Chrome's built-in recognizer is the fallback.
  Korean replies use a Korean voice — Chrome's "Google 한국의" sounds best.
- Change the agent names / persona in `api/chat.js` (the `SYSTEM` prompt) and in
  `index.html` (the `AGENTS` array) to match your own workflow.
