// Jarvischan local agent.
//
// Runs on this computer only (not deployed anywhere) and lets the Jarvischan
// web page open apps, URLs and files here — things the Vercel server can
// never do, since it's a stateless cloud function with no route to this
// machine. The page connects straight to ws://localhost from the browser
// and relays the assistant's tool calls here.
//
// Deliberately allow-list only: no arbitrary shell command execution, no
// file delete/move, no shutdown/restart, no simulated keyboard typing.
// open_app/close_app only work on apps listed in apps.json.
"use strict";

const { WebSocketServer } = require("ws");
const { exec } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.JARVIS_AGENT_PORT) || 8765;
// The page this agent is allowed to take commands from. Update this if you
// move to a different Vercel URL or a custom domain.
const ALLOWED_ORIGINS = new Set([
  "https://jarvis-vercel-blush.vercel.app",
  "http://localhost:3000" // vercel dev
]);

const CONFIG_DIR = path.join(os.homedir(), ".jarvischan-agent");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.txt");
const APPS_FILE = path.join(__dirname, "apps.json");

function ensureToken() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(TOKEN_FILE)) {
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_FILE, token, "utf8");
    return token;
  }
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}
const TOKEN = ensureToken();

function loadApps() {
  try { return JSON.parse(fs.readFileSync(APPS_FILE, "utf8")); }
  catch (e) { console.error("apps.json unreadable:", e.message); return {}; }
}

function isSafeUrl(u) {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:"; }
  catch (e) { return false; }
}

function shellOpen(target) {
  // `start "" "<target>"` — the empty "" is required because cmd.exe's
  // `start` treats the first quoted argument as a window title.
  return new Promise((resolve) => {
    exec('start "" "' + String(target).replace(/"/g, "") + '"', (err) => {
      resolve(err ? { ok: false, error: String(err.message || err).slice(0, 160) } : { ok: true });
    });
  });
}

async function openApp(name) {
  const apps = loadApps();
  const key = String(name || "").toLowerCase().trim();
  const entry = apps[key];
  const cmd = entry && entry.open;
  if (!cmd) return { ok: false, error: "app not in allow-list: " + name + " (edit apps.json to add it)" };
  return new Promise((resolve) => {
    exec(cmd, (err) => {
      resolve(err ? { ok: false, error: "failed to launch " + name } : { ok: true, message: "opened " + name });
    });
  });
}

// Never killable even if a process name is added to apps.json for it later —
// explorer.exe is the Windows desktop shell itself (taskbar, desktop icons),
// not just a file-browser window, so "closing" it takes down the whole shell.
const CLOSE_BLOCKLIST = new Set(["explorer", "file explorer", "탐색기"]);
async function closeApp(name) {
  const apps = loadApps();
  const key = String(name || "").toLowerCase().trim();
  if (CLOSE_BLOCKLIST.has(key)) return { ok: false, error: "won't close " + name + " — that's the Windows desktop shell" };
  const entry = apps[key];
  const proc = entry && entry.process;
  if (!proc) return { ok: false, error: "no process name configured for " + name + " (edit apps.json to add one)" };
  return new Promise((resolve) => {
    exec('taskkill /IM "' + proc + '" /F', (err, stdout, stderr) => {
      if (err && /not found/i.test(String(stderr || ""))) resolve({ ok: true, message: name + " wasn't running" });
      else if (err) resolve({ ok: false, error: "failed to close " + name });
      else resolve({ ok: true, message: "closed " + name });
    });
  });
}

async function openUrl(url) {
  if (!isSafeUrl(url)) return { ok: false, error: "invalid url" };
  const r = await shellOpen(url);
  return r.ok ? { ok: true, message: "opened " + url } : { ok: false, error: r.error || "failed to open url" };
}

// Friendly names for common folders so voice commands don't need a full path
// dictated out loud ("다운로드 폴더 열어줘" instead of a Korean TTS spelling
// out "C colon backslash Users backslash...").
const FOLDER_ALIASES = {
  "desktop": "Desktop", "바탕화면": "Desktop",
  "downloads": "Downloads", "download": "Downloads", "다운로드": "Downloads",
  "documents": "Documents", "문서": "Documents",
  "pictures": "Pictures", "사진": "Pictures",
  "home": "", "홈": ""
};
async function openPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return { ok: false, error: "missing path" };
  const aliasKey = raw.toLowerCase();
  const resolved = (aliasKey in FOLDER_ALIASES)
    ? path.join(os.homedir(), FOLDER_ALIASES[aliasKey])
    : path.resolve(raw);
  if (!fs.existsSync(resolved)) return { ok: false, error: "path not found: " + raw };
  const r = await shellOpen(resolved);
  return r.ok ? { ok: true, message: "opened " + resolved } : { ok: false, error: r.error || "failed to open path" };
}

async function findFiles(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return { ok: false, error: "empty query" };
  const roots = ["Desktop", "Documents", "Downloads"]
    .map((d) => path.join(os.homedir(), d))
    .filter((p) => fs.existsSync(p));
  const results = [];
  const MAX_RESULTS = 8, MAX_DEPTH = 5;
  function walk(dir, depth) {
    if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; } // permission-denied folders etc. — skip quietly
    for (const ent of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.name.toLowerCase().includes(q)) results.push(full);
    }
  }
  roots.forEach((r) => walk(r, 0));
  return { ok: true, results, message: results.length + " file(s) found" };
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    // -EncodedCommand sidesteps quoting entirely (script is UTF-16LE/base64),
    // which matters here since screenshot/clipboard scripts contain quotes
    // and $ signs that would otherwise need fragile escaping through both
    // cmd.exe and PowerShell.
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    exec('powershell -NoProfile -NonInteractive -EncodedCommand ' + encoded,
      { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: String(stderr || err.message || err).slice(0, 200) });
        else resolve({ ok: true, stdout: String(stdout || "").trim() });
      });
  });
}

async function lockScreen() {
  return new Promise((resolve) => {
    exec("rundll32.exe user32.dll,LockWorkStation", (err) => {
      resolve(err ? { ok: false, error: "failed to lock screen" } : { ok: true, message: "screen locked" });
    });
  });
}

async function screenshot() {
  const dir = path.join(os.homedir(), "Desktop");
  const file = "jarvis-screenshot-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
  const out = path.join(dir, file);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
    '$bmp.Save("' + out.replace(/"/g, "") + '")'
  ].join("\n");
  const r = await runPowerShell(script);
  if (!r.ok) return { ok: false, error: r.error || "screenshot failed" };
  return { ok: true, message: "saved screenshot to Desktop", path: out };
}

async function setClipboard(text) {
  const t = String(text == null ? "" : text).slice(0, 5000);
  // Piping through stdin (Set-Clipboard -Value $input) instead of embedding
  // the text in the script avoids needing to escape arbitrary user/LLM text
  // for PowerShell string literals.
  return new Promise((resolve) => {
    const child = exec('powershell -NoProfile -NonInteractive -Command "$input | Set-Clipboard"',
      { timeout: 8000 }, (err) => {
        resolve(err ? { ok: false, error: "failed to copy to clipboard" } : { ok: true, message: "copied to clipboard" });
      });
    child.stdin.write(t); child.stdin.end();
  });
}

// Simulates the hardware volume keys via user32's keybd_event — same effect
// as pressing the physical keys, so it respects whatever app/system is
// currently handling volume. Each step is one keypress (~2% on most systems).
const VK_VOLUME_MUTE = 0xAD, VK_VOLUME_DOWN = 0xAE, VK_VOLUME_UP = 0xAF;
async function adjustVolume(direction, steps) {
  const dir = String(direction || "").toLowerCase();
  const vk = dir === "up" ? VK_VOLUME_UP : dir === "down" ? VK_VOLUME_DOWN : dir === "mute" ? VK_VOLUME_MUTE : null;
  if (vk == null) return { ok: false, error: "direction must be up, down, or mute" };
  const n = dir === "mute" ? 1 : Math.max(1, Math.min(20, parseInt(steps, 10) || 5));
  const press = [
    'Add-Type -TypeDefinition \'',
    'using System; using System.Runtime.InteropServices;',
    'public class JarvisVol { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }',
    "'",
    "for ($i=0; $i -lt " + n + "; $i++) {",
    "  [JarvisVol]::keybd_event(" + vk + ",0,0,[UIntPtr]::Zero)",
    "  [JarvisVol]::keybd_event(" + vk + ",0,2,[UIntPtr]::Zero)",
    "}"
  ].join("\n");
  const r = await runPowerShell(press);
  if (!r.ok) return { ok: false, error: r.error || "volume change failed" };
  return { ok: true, message: dir === "mute" ? "toggled mute" : "volume " + dir + " x" + n };
}

async function runCommand(command, args) {
  args = args || {};
  try {
    switch (command) {
      case "open_app": return await openApp(args.app);
      case "close_app": return await closeApp(args.app);
      case "open_url": return await openUrl(args.url);
      case "open_path": return await openPath(args.path);
      case "find_files": return await findFiles(args.query);
      case "lock_screen": return await lockScreen();
      case "screenshot": return await screenshot();
      case "set_clipboard": return await setClipboard(args.text);
      case "adjust_volume": return await adjustVolume(args.direction, args.steps);
      default: return { ok: false, error: "unknown command: " + command };
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

console.log("Jarvischan local agent");
console.log("Pairing token (paste into the Jarvischan page once):");
console.log("  " + TOKEN);
console.log("Listening on ws://localhost:" + PORT);
console.log("Allow-listed apps: " + Object.keys(loadApps()).join(", "));

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const origin = (req.headers && req.headers.origin) || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    console.log("rejected connection from origin: " + origin);
    ws.close(1008, "origin not allowed");
    return;
  }
  let authed = false;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === "auth") {
      authed = msg.token === TOKEN;
      ws.send(JSON.stringify({ type: "auth", ok: authed }));
      if (authed) console.log("paired with " + origin);
      return;
    }
    if (!authed) { ws.send(JSON.stringify({ type: "error", error: "not authenticated" })); return; }

    if (msg.type === "cmd") {
      console.log("cmd:", msg.command, JSON.stringify(msg.args || {}));
      const result = await runCommand(msg.command, msg.args);
      ws.send(JSON.stringify(Object.assign({ type: "result", id: msg.id }, result)));
    }
  });
});

wss.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use — is the agent already running?");
  } else {
    console.error("server error:", e && e.message);
  }
  process.exit(1);
});
