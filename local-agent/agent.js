// Jarvischan local agent.
//
// Runs on this computer only (not deployed anywhere) and lets the Jarvischan
// web page open apps, URLs and files here — things the Vercel server can
// never do, since it's a stateless cloud function with no route to this
// machine. The page connects straight to ws://localhost from the browser
// and relays the assistant's tool calls here.
//
// Deliberately allow-list only: no arbitrary shell command execution, no
// delete/write actions. open_app only launches what's listed in apps.json.
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
  const cmd = apps[key];
  if (!cmd) return { ok: false, error: "app not in allow-list: " + name + " (edit apps.json to add it)" };
  return new Promise((resolve) => {
    exec(cmd, (err) => {
      resolve(err ? { ok: false, error: "failed to launch " + name } : { ok: true, message: "opened " + name });
    });
  });
}

async function openUrl(url) {
  if (!isSafeUrl(url)) return { ok: false, error: "invalid url" };
  const r = await shellOpen(url);
  return r.ok ? { ok: true, message: "opened " + url } : { ok: false, error: r.error || "failed to open url" };
}

async function openPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return { ok: false, error: "missing path" };
  const resolved = path.resolve(raw);
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

async function runCommand(command, args) {
  args = args || {};
  try {
    switch (command) {
      case "open_app": return await openApp(args.app);
      case "open_url": return await openUrl(args.url);
      case "open_path": return await openPath(args.path);
      case "find_files": return await findFiles(args.query);
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
