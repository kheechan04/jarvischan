// Jarvischan local agent.
//
// Runs on this computer only (not deployed anywhere) and lets the Jarvischan
// web page open apps, URLs and files here — things the Vercel server can
// never do, since it's a stateless cloud function with no route to this
// machine. The page connects straight to ws://localhost from the browser
// and relays the assistant's tool calls here.
//
// Deliberately allow-list only: no arbitrary shell command execution, no
// file delete/move, no immediate shutdown/restart, no simulated keyboard
// typing. open_app/close_app only work on apps listed in apps.json, and
// run_routine only chains the commands below, as written in routines.json.
// The one power action is a *scheduled* shutdown at least a minute out,
// which Windows announces and cancel_shutdown (or `shutdown /a`) undoes.
"use strict";

const { WebSocketServer } = require("ws");
const { exec, spawn } = require("child_process");
const readline = require("readline");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.JARVIS_AGENT_PORT) || 8765;
// The page this agent is allowed to take commands from. Update this if you
// move to a different Vercel URL or a custom domain.
const ALLOWED_ORIGINS = new Set([
  "https://jarvischan.vercel.app",
  "https://jarvis-vercel-blush.vercel.app", // old address, now redirects
  "http://localhost:3000" // vercel dev
]);

const CONFIG_DIR = path.join(os.homedir(), ".jarvischan-agent");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.txt");
const APPS_FILE = path.join(__dirname, "apps.json");
const ROUTINES_FILE = path.join(__dirname, "routines.json");

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

// The agent usually runs minimized from autostart, so its console output is
// out of sight when something goes wrong. Mirror it to a file (minus the
// pairing token) so "it said it opened it but didn't" can be traced later.
const LOG_FILE = path.join(CONFIG_DIR, "agent.log");
try { if (fs.statSync(LOG_FILE).size > 1000000) fs.writeFileSync(LOG_FILE, ""); } catch (e) {}
for (const level of ["log", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (line.includes(TOKEN)) return;
    try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + line.slice(0, 500) + "\n"); } catch (e) {}
  };
}

function loadApps() {
  try { return JSON.parse(fs.readFileSync(APPS_FILE, "utf8")); }
  catch (e) { console.error("apps.json unreadable:", e.message); return {}; }
}
function loadRoutines() {
  try { return JSON.parse(fs.readFileSync(ROUTINES_FILE, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") console.error("routines.json unreadable:", e.message); return {}; }
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
  if (!cmd) return { ok: false, code: "not_allowed", error: "app not in allow-list: " + name + " (edit apps.json to add it)" };
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

function isProcessRunning(proc) {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq ' + proc + '"', (err, stdout) => {
      resolve(!err && new RegExp(proc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(stdout || ""));
    });
  });
}
function taskkill(proc, force) {
  return new Promise((resolve) => {
    exec('taskkill /IM "' + proc + '"' + (force ? " /F" : ""), () => resolve());
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function closeApp(name, force) {
  const apps = loadApps();
  const key = String(name || "").toLowerCase().trim();
  if (CLOSE_BLOCKLIST.has(key)) return { ok: false, error: "won't close " + name + " — that's the Windows desktop shell" };
  const entry = apps[key];
  const proc = entry && entry.process;
  if (!proc) return { ok: false, code: "not_allowed", error: "no process name configured for " + name + " (edit apps.json to add one)" };
  if (!(await isProcessRunning(proc))) return { ok: true, message: name + " wasn't running" };

  // Tray apps (KakaoTalk, Discord) treat a normal close as "hide to the
  // tray" and keep running, so the graceful path below could never succeed
  // for them. "force": true in apps.json marks those — they have no
  // unsaved-document prompt to lose anyway.
  if (force || entry.force) {
    await taskkill(proc, true);
    return (await isProcessRunning(proc))
      ? { ok: false, error: "failed to force-close " + name }
      : { ok: true, message: "force-closed " + name };
  }

  // Graceful close first: no /F sends a normal close request (WM_CLOSE), so
  // an app with unsaved changes gets to show its own "save changes?" prompt
  // instead of losing them outright. Only report success once the process
  // has actually gone — taskkill returning isn't proof it closed, since the
  // app may just be sitting on that save prompt.
  await taskkill(proc, false);
  await sleep(1500);
  if (!(await isProcessRunning(proc))) return { ok: true, message: "closed " + name };
  return { ok: false, error: name + " didn't close — it may be waiting on an unsaved-changes prompt. Check it, or ask to force-close it." };
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
  "videos": "Videos", "동영상": "Videos", "비디오": "Videos",
  "music": "Music", "음악": "Music",
  "home": "", "홈": ""
};

// "jarvischan 폴더 열어줘" arrives as just a name. Before this, a bare name
// went through path.resolve() and so was looked up inside the agent's own
// folder — never found. Now search the usual places for a folder (then a
// file) with that name: exact name beats prefix beats substring, and a
// shallower hit beats a deeper one.
const SEARCH_SKIP = new Set(["node_modules", "appdata", "$recycle.bin", "__pycache__", "venv", ".venv"]);
function findByName(name) {
  const want = name.toLowerCase();
  const home = os.homedir();
  const roots = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"]
    .map((d) => path.join(home, d)).filter((p) => fs.existsSync(p));
  let best = null, scanned = 0;
  const consider = (full, isDir, depth) => {
    const n = path.basename(full).toLowerCase();
    const rank = n === want ? 0 : n.startsWith(want) ? 1 : n.includes(want) ? 2 : -1;
    if (rank < 0) return;
    const score = (isDir ? 0 : 100) + rank * 10 + depth;
    if (!best || score < best.score) best = { full, score };
  };
  function walk(dir, depth) {
    if (depth > 4 || scanned > 30000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (++scanned > 30000) return;
      if (ent.name.startsWith(".") || SEARCH_SKIP.has(ent.name.toLowerCase())) continue;
      const full = path.join(dir, ent.name);
      consider(full, ent.isDirectory(), depth);
      if (ent.isDirectory()) walk(full, depth + 1);
    }
  }
  // Top-level folders in the home directory itself (e.g. a project folder
  // kept at C:\Users\me\project), without descending into all of it.
  try {
    for (const ent of fs.readdirSync(home, { withFileTypes: true }))
      if (ent.isDirectory() && !ent.name.startsWith(".")) consider(path.join(home, ent.name), true, 1);
  } catch (e) {}
  roots.forEach((r) => walk(r, 0));
  return best && best.full;
}

// A window opened by a background program (this agent) often appears behind
// the browser instead of in front — so a folder could open and still look
// like nothing happened. Find the Explorer window showing that folder and
// bring it forward. The lone Alt press is the standard way to let a
// non-foreground process hand focus to a window; it types nothing.
async function focusExplorerWindow(folder) {
  const script = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JarvischanFocus { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr h); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr x); }'",
    "$want = '" + folder.replace(/'/g, "''") + "'",
    "for ($i = 0; $i -lt 20; $i++) {",
    "  foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {",
    "    try { $p = $w.Document.Folder.Self.Path } catch { continue }",
    "    if ($p -and $p.TrimEnd('\\') -ieq $want.TrimEnd('\\')) {",
    "      $h = [IntPtr]$w.HWND",
    "      if ([JarvischanFocus]::IsIconic($h)) { [JarvischanFocus]::ShowWindow($h, 9) | Out-Null }",
    "      [JarvischanFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [JarvischanFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)",
    "      [JarvischanFocus]::SetForegroundWindow($h) | Out-Null",
    "      'focused'; exit",
    "    }",
    "  }",
    "  Start-Sleep -Milliseconds 150",
    "}"
  ].join("\n");
  const r = await runPowerShell(script);
  return r.ok && r.stdout === "focused";
}

async function openPath(p) {
  let raw = String(p || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return { ok: false, error: "missing path" };
  const aliasKey = raw.toLowerCase().replace(/\s*(폴더|folder|디렉터리|디렉토리)$/, "").trim();
  let resolved;
  if (aliasKey in FOLDER_ALIASES) resolved = path.join(os.homedir(), FOLDER_ALIASES[aliasKey]);
  else if (path.isAbsolute(raw) && fs.existsSync(raw)) resolved = raw;
  else resolved = findByName(path.basename(aliasKey));
  if (!resolved || !fs.existsSync(resolved)) return { ok: false, code: "not_found", error: "path not found: " + raw };
  const isDir = fs.statSync(resolved).isDirectory();
  const r = await shellOpen(resolved);
  if (!r.ok) return { ok: false, error: r.error || "failed to open path" };
  const focused = isDir ? await focusExplorerWindow(resolved) : false;
  return { ok: true, message: "opened " + resolved + (isDir && !focused ? " (window may be behind)" : ""), path: resolved };
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
    // UTF-8 output: otherwise PowerShell writes stdout in the console's
    // code page (CP949 on a Korean Windows) and Korean window titles arrive
    // here garbled.
    script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" + script;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    // -Sta: the Windows Forms clipboard (screenshot) refuses to work from
    // a multi-threaded apartment.
    exec('powershell -NoProfile -NonInteractive -Sta -EncodedCommand ' + encoded,
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

// Clipboard only, no file: the point is pasting it straight into KakaoTalk,
// Discord or Notion with Ctrl+V, not collecting PNGs on the Desktop.
async function screenshot() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    // PowerShell isn't marked DPI-aware by default, so without this,
    // Windows hands .NET a scaled-down "logical" resolution instead of the
    // real one on any display running above 100% scaling (the default on
    // most laptops) — the capture below would then only cover the
    // top-left fraction of the actual screen instead of all of it.
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JarvischanDpi { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); }'",
    "[JarvischanDpi]::SetProcessDPIAware() | Out-Null",
    // VirtualScreen (not PrimaryScreen.Bounds) so a multi-monitor setup
    // gets the full combined desktop, not just the primary display.
    "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
    "[System.Windows.Forms.Clipboard]::SetImage($bmp)"
  ].join("\n");
  const r = await runPowerShell(script);
  if (!r.ok) return { ok: false, error: r.error || "screenshot failed" };
  return { ok: true, message: "screenshot copied to clipboard" };
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
    'public class JarvischanVol { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }',
    "'",
    "for ($i=0; $i -lt " + n + "; $i++) {",
    "  [JarvischanVol]::keybd_event(" + vk + ",0,0,[UIntPtr]::Zero)",
    "  [JarvischanVol]::keybd_event(" + vk + ",0,2,[UIntPtr]::Zero)",
    "}"
  ].join("\n");
  const r = await runPowerShell(press);
  if (!r.ok) return { ok: false, error: r.error || "volume change failed" };
  return { ok: true, message: dir === "mute" ? "toggled mute" : "volume " + dir + " x" + n };
}

// Battery goes through WMI, which takes about a second per PowerShell call —
// too slow to run before every chat turn. Keep a reading that refreshes once
// a minute instead; battery level doesn't move faster than that anyway.
let batteryCache = null;
async function refreshBattery() {
  const r = await runPowerShell(
    "$b = Get-CimInstance Win32_Battery | Select-Object -First 1\n" +
    "if ($b) { '' + $b.EstimatedChargeRemaining + ',' + $b.BatteryStatus + ',' + $b.EstimatedRunTime }");
  if (!r.ok || !r.stdout) return;
  const [pct, status, runtime] = r.stdout.split(",").map(Number);
  // BatteryStatus 1 = running on battery; everything else means plugged in.
  // EstimatedRunTime is a nonsense sentinel (71582788) while plugged in.
  const onBattery = status === 1;
  batteryCache = { percent: pct, plugged_in: !onBattery,
    minutes_left: onBattery && runtime > 0 && runtime < 100000 ? runtime : null };
}
refreshBattery();
setInterval(refreshBattery, 60000).unref();

function cpuTimes() {
  return os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
}
const gb = (bytes) => Math.round(bytes / 1073741824 * 10) / 10;

// The page asks for this right before each chat turn so the assistant can
// answer "배터리 몇 퍼센트야?" from real numbers — keep it fast (~250ms).
async function systemStatus() {
  const a = cpuTimes();
  await sleep(250);
  const b = cpuTimes();
  const total = b.total - a.total;
  const status = {
    cpu_percent: total > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : null,
    memory_used_gb: gb(os.totalmem() - os.freemem()),
    memory_total_gb: gb(os.totalmem()),
    uptime_hours: Math.round(os.uptime() / 360) / 10
  };
  try {
    const s = fs.statfsSync(process.env.SystemDrive ? process.env.SystemDrive + "\\" : "C:\\");
    status.disk_free_gb = gb(s.bavail * s.bsize);
    status.disk_total_gb = gb(s.blocks * s.bsize);
  } catch (e) {}
  if (batteryCache) status.battery = batteryCache;
  return { ok: true, status };
}

// Laptop panel brightness through WMI. Only works on built-in displays —
// external monitors don't expose this class, so a desktop setup gets an error.
async function setBrightness(level, direction, step) {
  let target = parseInt(level, 10);
  if (isNaN(target)) {
    const dir = String(direction || "").toLowerCase();
    if (dir !== "up" && dir !== "down") return { ok: false, error: "give a level 0-100 or direction up/down" };
    const cur = await runPowerShell("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness");
    const now = parseInt(cur.stdout, 10);
    if (!cur.ok || isNaN(now)) return { ok: false, error: "couldn't read brightness (built-in display only)" };
    const d = Math.max(5, Math.min(100, parseInt(step, 10) || 20));
    target = now + (dir === "up" ? d : -d);
  }
  target = Math.max(0, Math.min(100, target));
  const r = await runPowerShell(
    "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | " +
    "Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte]" + target + " } | Out-Null");
  if (!r.ok) return { ok: false, error: "couldn't set brightness (built-in display only)" };
  return { ok: true, message: "brightness " + target + "%" };
}

// SC_MONITORPOWER 2 = display off. This laptop uses Modern Standby (S0 low
// power idle) rather than classic S3 sleep, so a dark screen is also how it
// drops into standby — SetSuspendState would hibernate instead. Delayed a
// few seconds so the spoken reply and the user's hand leaving the mouse
// don't wake it straight back up.
async function displayOff() {
  setTimeout(() => {
    runPowerShell([
      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JarvischanMon { [DllImport(\"user32.dll\")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'",
      "[JarvischanMon]::PostMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2) | Out-Null"
    ].join("\n"));
  }, 4000);
  return { ok: true, message: "turning the display off in 4 seconds" };
}

function runShutdown(argStr) {
  return new Promise((resolve) => {
    exec("shutdown " + argStr, (err, stdout, stderr) => resolve({ err, out: String(stderr || stdout || "") }));
  });
}
async function scheduleShutdown(minutes) {
  const m = parseInt(minutes, 10);
  if (isNaN(m) || m < 1 || m > 1440) return { ok: false, error: "minutes must be between 1 and 1440" };
  const r = await runShutdown("/s /t " + m * 60);
  if (r.err) {
    // 1190 = "a system shutdown has already been scheduled"
    return { ok: false, error: /1190/.test(r.out) || r.err.code === 1190
      ? "a shutdown is already scheduled — cancel it first" : "failed to schedule shutdown" };
  }
  const at = new Date(Date.now() + m * 60000).toTimeString().slice(0, 5);
  return { ok: true, message: "shutdown scheduled in " + m + " min (" + at + ")" };
}
async function cancelShutdown() {
  const r = await runShutdown("/a");
  // 1116 = "unable to abort because no shutdown was in progress"
  if (r.err) return r.err.code === 1116 || /1116/.test(r.out)
    ? { ok: true, message: "no shutdown was scheduled" } : { ok: false, error: "failed to cancel shutdown" };
  return { ok: true, message: "scheduled shutdown cancelled" };
}

// Closes the window the user was last working in: walks top-level windows
// front to back and sends WM_CLOSE to the first real app window — the same
// as clicking its X, so unsaved-changes prompts still appear. Skips any
// window titled Jarvischan (the page's own tab/PWA window and this agent's
// console), since the user is usually talking to that one when asking.
const CLOSE_WINDOW_CS = `
using System; using System.Text; using System.Runtime.InteropServices;
public class JarvischanWin {
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public static string CloseTop(bool dryRun) {
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      if (!IsWindowVisible(h)) continue;
      if ((GetWindowLong(h, -20) & 0x80) != 0) continue;   // WS_EX_TOOLWINDOW
      if (GetWindow(h, 4) != IntPtr.Zero) continue;         // owned popups/dialogs
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) continue;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      string title = t.ToString();
      if (title.Length == 0 || title.IndexOf("Jarvischan", StringComparison.OrdinalIgnoreCase) >= 0) continue;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      string cls = c.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") continue;
      if (!dryRun) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);   // WM_CLOSE
      return title;
    }
    return "";
  }
}`;
async function closeWindow(dryRun) {
  const r = await runPowerShell(
    "Add-Type -TypeDefinition @'\n" + CLOSE_WINDOW_CS + "\n'@\n" +
    "[JarvischanWin]::CloseTop($" + (dryRun ? "true" : "false") + ")");
  if (!r.ok) return { ok: false, error: r.error || "failed to close window" };
  if (!r.stdout) return { ok: false, error: "no app window to close" };
  return { ok: true, message: (dryRun ? "would close: " : "closed window: ") + r.stdout.slice(0, 80) };
}

// What a routine step may run — everything except the read-only/reporting
// commands and run_routine itself (no routines calling routines).
const ROUTINE_STEP_COMMANDS = new Set(["open_app", "close_app", "open_url", "open_path",
  "set_clipboard", "adjust_volume", "set_brightness", "display_off", "lock_screen"]);

function findRoutine(name) {
  const routines = loadRoutines();
  const want = String(name || "").toLowerCase().trim();
  const bare = (s) => s.toLowerCase().replace(/\s*(모드|mode)$/, "").trim();
  for (const [key, r] of Object.entries(routines)) {
    const names = [key].concat((r && r.aliases) || []);
    if (names.some((n) => n.toLowerCase() === want || bare(n) === bare(want))) return { key, routine: r };
  }
  return null;
}
async function runRoutine(name) {
  const found = findRoutine(name);
  if (!found) return { ok: false, code: "not_found", error: "no routine called " + name + " (edit routines.json to add it)" };
  const steps = Array.isArray(found.routine.steps) ? found.routine.steps : [];
  const done = [], failed = [];
  for (const s of steps) {
    if (!s || !ROUTINE_STEP_COMMANDS.has(s.command)) { failed.push(String(s && s.command) + " (not allowed in routines)"); continue; }
    const r = await runCommand(s.command, s.args);
    const label = s.command + (s.args && s.args.app ? " " + s.args.app : "");
    (r.ok ? done : failed).push(r.ok ? label : label + ": " + r.error);
  }
  return { ok: failed.length === 0, message: found.key + " — " + done.length + "/" + steps.length + " done",
    error: failed.length ? found.key + " — failed: " + failed.join("; ") : undefined, done, failed };
}

async function runCommand(command, args) {
  args = args || {};
  try {
    switch (command) {
      case "open_app": return await openApp(args.app);
      case "close_app": return await closeApp(args.app, !!args.force);
      case "open_url": return await openUrl(args.url);
      case "open_path": return await openPath(args.path);
      case "find_files": return await findFiles(args.query);
      case "lock_screen": return await lockScreen();
      case "screenshot": return await screenshot();
      case "set_clipboard": return await setClipboard(args.text);
      case "adjust_volume": return await adjustVolume(args.direction, args.steps);
      case "system_status": return await systemStatus();
      case "set_brightness": return await setBrightness(args.level, args.direction, args.step);
      case "display_off": return await displayOff();
      case "schedule_shutdown": return await scheduleShutdown(args.minutes);
      case "cancel_shutdown": return await cancelShutdown();
      case "close_window": return await closeWindow(!!args.dry_run);
      case "run_routine": return await runRoutine(args.name);
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
console.log("Routines: " + (Object.keys(loadRoutines()).join(", ") || "(none)"));

// ---- floating icon ----
// An always-on-top round button (floating-icon.ps1) that wakes Jarvischan
// from any app: a click is relayed to the paired page, which starts
// listening exactly as if its mic button had been pressed. The page reports
// its mode back so the icon's ring shows listening/thinking/speaking.
// JARVIS_NO_ICON=1 turns it off.
const ICON_SCRIPT = path.join(__dirname, "floating-icon.ps1");
const ICON_IMAGE = path.join(__dirname, "icon.png");
const ICON_POS_FILE = path.join(CONFIG_DIR, "icon-position.txt");
let iconProc = null;
// Paired pages, oldest first. Icon clicks go to the newest one only, so a
// second open tab doesn't start a second recording at the same time.
const pairedPages = [];

function iconState(mode) {
  if (iconProc && iconProc.stdin.writable) iconProc.stdin.write(mode + "\n");
}

// The installed Chrome app if there is one (its Start Menu folder is
// localized — "Chrome 앱" here — so match any Chrome* folder), else the site.
function launchJarvischan() {
  const programs = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs");
  let lnk = null;
  try {
    for (const d of fs.readdirSync(programs)) {
      const p = path.join(programs, d, "Jarvischan.lnk");
      if (/^chrome/i.test(d) && fs.existsSync(p)) { lnk = p; break; }
    }
  } catch (e) {}
  return shellOpen(lnk || "https://jarvischan.vercel.app");
}

function handleIconEvent(ev) {
  if (ev === "click") {
    const page = pairedPages[pairedPages.length - 1];
    if (page) { console.log("floating icon: listen"); page.send(JSON.stringify({ type: "event", event: "activate" })); }
    // Nothing paired yet — open Jarvischan so there's something to talk to.
    else { console.log("floating icon: no page connected, opening Jarvischan"); launchJarvischan(); }
  } else if (ev === "launch") {
    launchJarvischan();
  } else if (ev === "hide") {
    console.log("floating icon hidden — restart the agent to bring it back");
  }
}

function startFloatingIcon() {
  if (process.env.JARVIS_NO_ICON === "1" || !fs.existsSync(ICON_SCRIPT) || !fs.existsSync(ICON_IMAGE)) return;
  iconProc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass",
    "-File", ICON_SCRIPT, ICON_IMAGE, ICON_POS_FILE], { windowsHide: true });
  iconProc.stdin.on("error", () => {});   // icon already gone; nothing to tell it
  readline.createInterface({ input: iconProc.stdout }).on("line", (l) => handleIconEvent(l.trim()));
  iconProc.stderr.on("data", (d) => console.error("floating icon:", String(d).trim().slice(0, 300)));
  iconProc.on("exit", () => { iconProc = null; });
}

const wss = new WebSocketServer({ port: PORT });
// Only once the port is ours — a second agent started by mistake exits on
// EADDRINUSE and shouldn't leave a second icon behind.
wss.on("listening", startFloatingIcon);

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
      // Tell the page what this PC actually has, so the assistant can name
      // real apps and routines instead of guessing from a hardcoded list.
      ws.send(JSON.stringify(authed
        ? { type: "auth", ok: true, apps: Object.keys(loadApps()), routines: Object.keys(loadRoutines()) }
        : { type: "auth", ok: false }));
      if (authed) {
        console.log("paired with " + origin);
        if (!pairedPages.includes(ws)) pairedPages.push(ws);
        iconState("idle");
      }
      return;
    }
    if (!authed) { ws.send(JSON.stringify({ type: "error", error: "not authenticated" })); return; }

    // The page's listening/thinking/speaking mode, mirrored on the icon —
    // only from the page that icon clicks currently go to.
    if (msg.type === "state") {
      if (ws === pairedPages[pairedPages.length - 1]) iconState(String(msg.mode || "idle").replace(/\W/g, ""));
      return;
    }

    if (msg.type === "cmd") {
      // system_status runs before every chat turn — keep it out of the log.
      const quiet = msg.command === "system_status";
      if (!quiet) console.log("cmd:", msg.command, JSON.stringify(msg.args || {}).slice(0, 200));
      const result = await runCommand(msg.command, msg.args);
      if (!quiet) console.log("  ->", result.ok ? "ok: " + (result.message || "") : "FAILED: " + result.error);
      ws.send(JSON.stringify(Object.assign({ type: "result", id: msg.id }, result)));
    }
  });

  ws.on("close", () => {
    const i = pairedPages.indexOf(ws);
    if (i < 0) return;
    pairedPages.splice(i, 1);
    iconState(pairedPages.length ? "idle" : "offline");
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
