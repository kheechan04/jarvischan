# Jarvischan

A movie-style voice assistant that runs in the browser. Talk to it in Korean
or English and it answers out loud, calls real tools, and — with an optional
local agent — controls apps on your own computer.

**Live:** https://jarvischan.vercel.app (password-gated) ·
**Project write-up:** https://kheechan04.github.io/jarvischan/

## What it does

- **Voice in / out** — tap the mic, clap twice, or say "Jarvischan" / "자비스찬".
  Speech goes through Groq Whisper, which detects Korean or English, and the
  reply comes back in the same language.
- **Real tools** — weather and air quality, currency conversion, Wikipedia,
  public holidays, tech headlines, and timers. None of them need an API key.
- **Local agent (optional, Windows)** — open or close apps, URLs and files,
  take screenshots, change the volume, or lock the screen on your own machine.
- **Installable** as a PWA from Chrome, or added to the home screen on iOS.
- **$0 to run** on Vercel Hobby and Groq's free tier.

## Repository layout

| Path | What it is |
| --- | --- |
| [`jarvischan-vercel/`](jarvischan-vercel/) | The web app deployed to Vercel: a single `index.html` plus two serverless functions (`api/chat.js`, `api/transcribe.js`). No build step, no npm dependencies. |
| [`local-agent/`](local-agent/) | A small Node.js program you run on your own computer so the page can control it. Localhost only, origin-checked, token-paired, and limited to an allow-list of commands. |
| [`JARVISCHAN_BUILD_GUIDE.md`](JARVISCHAN_BUILD_GUIDE.md) | Full build and deploy guide (Korean), including every file's source and the problems hit along the way. |

## Run your own

1. Get a free Groq API key at https://console.groq.com.
2. Import this repository into Vercel and set **Root Directory** to
   `jarvischan-vercel`.
3. Add the environment variables `GROQ_API_KEY` and `JARVIS_PASSWORD`, then
   redeploy.

Details are in [`jarvischan-vercel/README.md`](jarvischan-vercel/README.md).
To set up the local agent, see [`local-agent/README.md`](local-agent/README.md).

## License

[MIT](LICENSE)
