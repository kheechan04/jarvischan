# Jarvischan local agent

A small companion program you run on your own computer so the
[Jarvischan](https://jarvis-vercel-blush.vercel.app) web page can open apps,
URLs and files **on that computer**. Jarvischan itself runs on Vercel, which
is a stateless cloud function with no route to your machine — this agent is
what makes "open Chrome" / "close Notepad" / "lock my screen" actually work.

**Windows only right now.** It uses Windows-specific commands (`start`,
`explorer`, `taskkill`, `rundll32`) under the hood.

Runs entirely on your machine, talks to nothing but the Jarvischan page
(checked by a pairing token and an origin check — see **Security** below).

## Setup (once)

1. Install [Node.js](https://nodejs.org) if you don't have it (any recent
   LTS version works).
2. Open a terminal in this folder and run:
   ```
   npm install
   ```

## Running it

Double-click **`start-agent.bat`**. A terminal window opens and prints a
pairing token, e.g.:

```
Jarvischan local agent
Pairing token (paste into the Jarvischan page once):
  0bb2bc0ad19170908a6c59f5724f4e3c4c7469d3a97dcc1c
Listening on ws://localhost:8765
```

Keep that window open — closing it stops the agent. (`npm start` from a
terminal does the same thing, if you'd rather not use the .bat file.)

## Pairing the web page (once)

On the Jarvischan page, click the **"Local agent"** button (bottom toolbar,
next to the wake-word button). It'll ask for the token — paste the one from
the terminal. Once paired, the browser remembers it: the page auto-connects
on every future visit, and auto-reconnects if the agent restarts. You won't
need to do this again unless you re-pair with a different token.

The token is also saved to `~/.jarvischan-agent/token.txt` if you need it
again later without restarting the agent.

## Run it automatically at login (optional)

Double-click **`install-autostart.bat`**. It adds a shortcut to your Windows
Startup folder so the agent launches (minimized) every time you log in — no
need to remember to start it by hand. Run **`uninstall-autostart.bat`** to
remove it.

## What it can do

| Say (roughly) | Command | Notes |
|---|---|---|
| "open Chrome" / "크롬 열어줘" | `open_app` | Only apps listed in `apps.json` |
| "close Notepad" / "메모장 닫아줘" | `close_app` | Tries a normal close first (lets the app prompt to save); force-closes only if you explicitly say so |
| "open youtube.com" | `open_url` | `http(s)://` only |
| "open my downloads folder" | `open_path` | Accepts `desktop`/`downloads`/`documents`/`pictures` (and their Korean names) or a full path |
| "find the file called X" | `find_files` | Read-only search under Desktop/Documents/Downloads |
| "lock my screen" | `lock_screen` | |
| "take a screenshot" | `take_screenshot` | Saved to your Desktop |
| "copy this to my clipboard" | `set_clipboard` | |
| "turn the volume down" | `adjust_volume` | Simulates the hardware volume keys |

## Adding more apps

Edit `apps.json`. Each entry is:

```json
"friendly name": { "open": "shell command to launch it", "process": "processname.exe" }
```

`process` is optional — you only need it if you also want `close_app` to
work for that app. `explorer` is permanently blocked from being closed (it's
the Windows desktop shell, not just a file browser window — killing it takes
down the taskbar too).

## Security

This is a personal, single-user tool, not a hardened multi-tenant service.

- **Allow-list only.** No arbitrary shell command execution, no file
  delete/move, no shutdown/restart/sleep, no simulated keyboard typing.
  `open_app`/`close_app` only work on apps you've explicitly added to
  `apps.json`.
- **Pairing token.** Generated once on first run, stored in
  `~/.jarvischan-agent/token.txt`. No command is accepted without it.
- **Origin check.** Only WebSocket connections from the Jarvischan page's own
  URL are accepted — anything else is rejected at the handshake, before
  authentication is even checked.

## Sharing this with someone else

If someone else uses the **same computer**, they can just use the same
token — it's tied to the machine, not to a person.

If someone wants this to work **on their own computer**, they need their own
copy: copy this whole `local-agent/` folder to their machine (a zip is
fine — `node_modules` doesn't need to come along, `npm install` rebuilds
it), install Node.js, run `npm install`, then `start-agent.bat`. Their
agent generates its own token, independent of yours — each person's
browser only ever talks to their own computer's agent.

## Troubleshooting

- **Button stuck on "connecting…"**: the pairing token doesn't match what's
  in `~/.jarvischan-agent/token.txt` (often because the agent was restarted
  and generated a new one). Click the button again — a bad token now resets
  the button back to "off" automatically, so the next click prompts for a
  fresh one.
- **"local agent not connected" when trying a command**: the agent isn't
  running, or the port (8765 by default) is blocked. Check the terminal
  window is still open.
- **Port already in use**: another copy of the agent is already running.
  Only one instance can run at a time per computer.
