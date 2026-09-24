// Vercel serverless function — Jarvischan brain proxy.
// Keeps the free Groq API key server-side (never sent to the browser),
// checks a shared password, and relays the chat to Groq (OpenAI-compatible).
// The model can call real tools (weather, air quality, currency, Wikipedia,
// holidays, tech headlines, timer); results come back as cards for the page.
//
// Required env vars (set in Vercel → Project → Settings → Environment Variables):
//   GROQ_API_KEY    your free key from https://console.groq.com  (no credit card)
//   JARVIS_PASSWORD the shared password visitors must enter
// Optional:
//   GROQ_MODEL      pin a model, e.g. "openai/gpt-oss-120b". If unset — or not available
//                   to this key — the first usable model from PREFERRED below is picked.

const SYSTEM = [
  "You are JARVISCHAN, the voice of a personal AI command center for a solo founder.",
  "Reply as JARVISCHAN: warm, crisp, confident, a touch cinematic — never robotic.",
  "Your reply is spoken ALOUD: keep it to 1-3 short sentences, no lists, no markdown, no emoji.",
  "LANGUAGE: reply in the language the user used. Korean input → natural spoken Korean (해요체), numbers as digits with Korean units (e.g. 25도, 13만 5천 원). English input → English, numbers said as words.",
  "Tool arguments stay in English even when the user speaks Korean: romanized city names (Seoul, Busan, Jeju), ISO currency codes. For Wikipedia, set language to ko and query in Korean when the user speaks Korean.",
  "",
  "WHAT YOU CAN ACTUALLY DO (use the tools for these):",
  "- current weather and a 4-day forecast for any city",
  "- air quality: fine dust PM2.5 and PM10, AQI, UV index",
  "- currency conversion at today's European Central Bank rates",
  "- short Wikipedia summaries of people, companies and concepts",
  "- upcoming public holidays for a country (Korea by default)",
  "- today's top tech headlines from Hacker News",
  "- set a countdown timer in the browser",
  "- a quick system check of voice, mic and brain (the user just says 'system check')",
  "- general conversation, brainstorming and answering from your own knowledge",
  "- understanding and answering in Korean or English, by voice or text",
  "",
  "WHAT YOU CANNOT DO YET: web search, reading or sending email, calendars, Notion, social media, long-term memory (you forget everything when the page reloads). Acting on the user's own computer (opening apps/URLs/files, searching for files) only works when a local agent line below says it is connected right now — otherwise say it needs that connected first.",
  "Never claim you did, queued, drafted, scheduled or saved something unless a tool result confirms it. If asked for something you cannot do, say so plainly in one sentence and offer the closest thing you can do.",
  "When asked what you can do, name three or four of the real abilities above in one or two sentences — never invent others.",
  "Use tool results as the only source for live facts. If a tool returns an error, say what failed in plain words.",
  "If the user gives no city, use Seoul. Use the current date and time given below for anything time-related.",
  "",
  'FORMAT: on the FIRST line output exactly "ROUTE: <AgentName>" choosing one of Strategist, Researcher, Chief of Staff, Finance, Editor, Memory, Design, Engineering, Calendar, Email, Social, Ops, Marketing, Sales, Developer (or "ROUTE: none"). This only lights a node on screen. Then a blank line, then the spoken reply.'
].join("\n");

const UA = "jarvischan-core/1.0 (personal voice assistant on Vercel)";
const MAX_ROUNDS = 3;

/* ---------------- tool definitions (sent to Groq) ---------------- */
const TOOLS = [
  fn("get_weather", "Current weather and 4-day forecast for a city.", {
    city: { type: "string", description: "City name in English, e.g. Seoul, Busan, Jeju, Tokyo. Translate Korean names to English." }
  }, ["city"]),
  fn("get_air_quality", "Current air quality for a city: PM2.5, PM10, US AQI and UV index.", {
    city: { type: "string", description: "City name in English, e.g. Seoul. Translate Korean names to English." }
  }, ["city"]),
  fn("convert_currency", "Convert an amount between currencies at today's ECB reference rate.", {
    amount: { type: "number", description: "Amount to convert, e.g. 100" },
    from: { type: "string", description: "ISO currency code to convert from, e.g. USD" },
    to: { type: "string", description: "ISO currency code to convert to, e.g. KRW" }
  }, ["amount", "from", "to"]),
  fn("wikipedia_summary", "Short Wikipedia summary of a person, company, place or concept.", {
    query: { type: "string", description: "What to look up, in the chosen edition's language, e.g. Sam Altman or 샘 올트먼" },
    language: { type: "string", enum: ["en", "ko"], description: "Wikipedia edition: ko when the user speaks Korean, otherwise en" }
  }, ["query"]),
  fn("upcoming_holidays", "Upcoming public holidays for a country.", {
    country_code: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. KR, US, JP. Default KR." }
  }, []),
  fn("tech_headlines", "Top tech and startup headlines from Hacker News right now.", {
    count: { type: "integer", description: "How many headlines, 1 to 5. Default 3." }
  }, []),
  fn("set_timer", "Start a countdown timer in the user's browser. It beeps and speaks when done.", {
    minutes: { type: "number", description: "Minutes, can be fractional. Use 0 if only seconds." },
    seconds: { type: "integer", description: "Extra seconds. Default 0." },
    label: { type: "string", description: "Short label, e.g. focus, tea" }
  }, ["minutes"])
];

// Only offered when the browser reports its local agent is connected (see
// module.exports below) — these dispatch to that agent and run for real on
// the user's own computer, they don't execute here on the server.
const DEVICE_TOOLS = [
  fn("open_app", "Open an application on the user's computer by name.", {
    app: { type: "string", description: "Friendly app name from the user's allow-list, e.g. chrome, notepad, calculator, explorer, vscode, spotify" }
  }, ["app"]),
  fn("close_app", "Close/quit an application on the user's computer by name. Tries a normal close first, which lets the app prompt to save unsaved changes — set force only if the user explicitly says to force/kill it, since that skips any save prompt. Refuses explorer (the Windows desktop shell) and anything not in the allow-list.", {
    app: { type: "string", description: "Friendly app name, same set as open_app" },
    force: { type: "boolean", description: "true only if the user explicitly asked to force-close/kill it. Default false." }
  }, ["app"]),
  fn("open_url", "Open a URL in the default browser on the user's computer.", {
    url: { type: "string", description: "Full URL starting with http:// or https://" }
  }, ["url"]),
  fn("open_path", "Open a file or folder on the user's computer with its default app (a folder opens in File Explorer). Accepts a friendly folder name (desktop, downloads, documents, pictures) or an absolute path.", {
    path: { type: "string", description: "e.g. downloads, desktop, or an absolute path like C:\\Users\\me\\Documents\\report.docx" }
  }, ["path"]),
  fn("find_files", "Search the user's Desktop, Documents and Downloads folders for files whose name contains a query.", {
    query: { type: "string", description: "Filename substring to search for" }
  }, ["query"]),
  fn("lock_screen", "Lock the user's computer screen immediately.", {}, []),
  fn("take_screenshot", "Capture the user's screen and save it as a PNG to their Desktop.", {}, []),
  fn("set_clipboard", "Copy text to the user's clipboard so they can paste it elsewhere.", {
    text: { type: "string", description: "The text to copy" }
  }, ["text"]),
  fn("adjust_volume", "Change the user's system volume by simulating the hardware volume keys.", {
    direction: { type: "string", enum: ["up", "down", "mute"], description: "up, down, or mute (toggles mute)" },
    steps: { type: "integer", description: "How many key-presses, roughly 2% each. Default 5. Ignored for mute." }
  }, ["direction"])
];

function fn(name, description, properties, required) {
  return { type: "function", function: { name, description,
    parameters: { type: "object", properties, required } } };
}

/* ---------------- tool implementations ---------------- */
const WCODE = {0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",45:"fog",48:"rime fog",
  51:"light drizzle",53:"drizzle",55:"dense drizzle",56:"freezing drizzle",57:"freezing drizzle",
  61:"light rain",63:"rain",65:"heavy rain",66:"freezing rain",67:"freezing rain",
  71:"light snow",73:"snow",75:"heavy snow",77:"snow grains",
  80:"rain showers",81:"rain showers",82:"heavy rain showers",85:"snow showers",86:"snow showers",
  95:"thunderstorm",96:"thunderstorm with hail",99:"thunderstorm with hail"};
const round = v => Math.round(Number(v));

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(7000) });
  if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
  return r.json();
}

// Korean city names → names the geocoder knows. Searching "서울" finds nothing
// and "부산" lands on a different, inland Pusan, so translate first.
const KO_CITY = { "서울": "Seoul", "부산": "Busan", "인천": "Incheon", "대구": "Daegu", "대전": "Daejeon",
  "광주": "Gwangju", "울산": "Ulsan", "세종": "Sejong", "수원": "Suwon", "성남": "Seongnam", "고양": "Goyang",
  "용인": "Yongin", "창원": "Changwon", "청주": "Cheongju", "전주": "Jeonju", "천안": "Cheonan", "포항": "Pohang",
  "제주": "Jeju", "서귀포": "Seogwipo", "강릉": "Gangneung", "춘천": "Chuncheon", "원주": "Wonju", "여수": "Yeosu",
  "경주": "Gyeongju", "김해": "Gimhae", "안동": "Andong", "목포": "Mokpo", "속초": "Sokcho", "파주": "Paju", "평택": "Pyeongtaek" };
const HANGUL = /[가-힣]/;
const KO_CITY_EN = new Set(Object.values(KO_CITY).map(s => s.toLowerCase()));

async function geocode(city) {
  let q = String(city || "Seoul").trim().slice(0, 60);
  if (HANGUL.test(q)) {
    const base = q.replace(/\s+/g, "").replace(/(특별자치시|특별자치도|특별시|광역시|시|군)$/, "");
    q = KO_CITY[base] || q;
  }
  // Korean cities are searched inside Korea only — plain "Jeju" otherwise resolves to Ethiopia
  const kr = KO_CITY_EN.has(q.toLowerCase());
  const search = lang => getJSON("https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + lang +
    "&name=" + encodeURIComponent(q) + (kr ? "&countryCode=KR" : ""));
  let j = await search("en");
  let g = j && j.results && j.results[0];
  if (!g && HANGUL.test(q)) { j = await search("ko"); g = j && j.results && j.results[0]; }
  if (!g) return null;
  return { lat: g.latitude, lon: g.longitude, name: g.name + (g.country ? ", " + g.country : "") };
}

const IMPL = {
  async get_weather({ city }) {
    const g = await geocode(city);
    if (!g) return { result: { error: "place not found: " + city } };
    const j = await getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + g.lat + "&longitude=" + g.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=4");
    const c = j.current || {}, d = j.daily || {};
    const days = (d.time || []).map((t, i) => ({
      date: t, summary: WCODE[d.weather_code[i]] || "",
      high_c: round(d.temperature_2m_max[i]), low_c: round(d.temperature_2m_min[i]),
      rain_chance_pct: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null
    }));
    const names = ["Today", "Tomorrow"];
    return {
      result: { place: g.name, now: { temp_c: round(c.temperature_2m), feels_c: round(c.apparent_temperature),
        summary: WCODE[c.weather_code] || "", humidity_pct: c.relative_humidity_2m, wind_kmh: round(c.wind_speed_10m) }, days },
      cards: { title: "weather · " + g.name, items: days.map((x, i) => ({
        title: names[i] || x.date, label: x.summary,
        desc: "High " + x.high_c + "°C · Low " + x.low_c + "°C" + (x.rain_chance_pct != null ? " · rain " + x.rain_chance_pct + "%" : "")
      })) }
    };
  },

  async get_air_quality({ city }) {
    const g = await geocode(city);
    if (!g) return { result: { error: "place not found: " + city } };
    const j = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + g.lat + "&longitude=" + g.lon +
      "&current=pm10,pm2_5,us_aqi,uv_index&timezone=auto");
    const c = j.current || {};
    // Korean Ministry of Environment PM2.5 bands (µg/m³)
    const pm25 = Number(c.pm2_5), pm10 = Number(c.pm10);
    const band25 = pm25 <= 15 ? "good" : pm25 <= 35 ? "moderate" : pm25 <= 75 ? "bad" : "very bad";
    const band10 = pm10 <= 30 ? "good" : pm10 <= 80 ? "moderate" : pm10 <= 150 ? "bad" : "very bad";
    return {
      result: { place: g.name, pm2_5_ugm3: round(pm25), pm2_5_level_korea: band25, pm10_ugm3: round(pm10),
        pm10_level_korea: band10, us_aqi: c.us_aqi, uv_index: c.uv_index,
        mask_advice: (band25 === "bad" || band25 === "very bad" || band10 === "bad" || band10 === "very bad") ? "mask recommended" : "no mask needed" },
      cards: { title: "air quality · " + g.name, items: [
        { title: "PM2.5 · " + round(pm25) + " µg/m³", label: band25, desc: "Fine dust (초미세먼지)" },
        { title: "PM10 · " + round(pm10) + " µg/m³", label: band10, desc: "Dust (미세먼지)" },
        { title: "US AQI · " + c.us_aqi, label: "UV index " + c.uv_index, desc: "" }
      ] }
    };
  },

  async convert_currency({ amount, from, to }) {
    const a = Number(amount);
    const f = String(from || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const t = String(to || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!isFinite(a) || f.length !== 3 || t.length !== 3) return { result: { error: "need an amount and two 3-letter currency codes" } };
    if (f === t) return { result: { amount: a, from: f, to: t, converted: a } };
    let j;
    try { j = await getJSON("https://api.frankfurter.dev/v1/latest?base=" + f + "&symbols=" + t); }
    catch (e) { if (e.status === 404 || e.status === 422) return { result: { error: "unsupported currency " + f + " or " + t } }; throw e; }
    const rate = j.rates && j.rates[t];
    if (!rate) return { result: { error: "unsupported currency " + t } };
    const converted = Math.round(a * rate * 100) / 100;
    return {
      result: { amount: a, from: f, to: t, rate, converted, rate_date: j.date, source: "European Central Bank" },
      cards: { title: "currency · " + f + " → " + t, items: [
        { title: a.toLocaleString("en-US") + " " + f + " = " + converted.toLocaleString("en-US") + " " + t,
          label: "ECB rate " + j.date, desc: "1 " + f + " = " + rate + " " + t }
      ] }
    };
  },

  async wikipedia_summary({ query, language }) {
    const q = String(query || "").slice(0, 100);
    const find = async lang => {
      const s = await getJSON("https://" + lang + ".wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=" + encodeURIComponent(q));
      const hit = s.query && s.query.search && s.query.search[0];
      return hit ? { lang, title: hit.title } : null;
    };
    // Korean edition first when asked; fall back to English if it has no article
    const hit = (language === "ko" && await find("ko")) || await find("en");
    if (!hit) return { result: { error: "no Wikipedia article found for " + q } };
    const p = await getJSON("https://" + hit.lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(hit.title.replace(/ /g, "_")));
    const url = (p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page) || "";
    return {
      result: { title: p.title, language: hit.lang, description: p.description || "", summary: String(p.extract || "").slice(0, 1200) },
      cards: { title: "wikipedia · " + p.title, items: [
        { title: p.title, url, label: p.description || hit.lang + ".wikipedia.org", desc: p.extract || "" }
      ] }
    };
  },

  async upcoming_holidays({ country_code }) {
    const cc = String(country_code || "KR").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "KR";
    let list;
    try { list = await getJSON("https://date.nager.at/api/v3/NextPublicHolidays/" + cc); }
    catch (e) { if (e.status === 404) return { result: { error: "no holiday data for country " + cc } }; throw e; }
    // merge consecutive days with the same name (e.g. Chuseok spans 3 days)
    const merged = [];
    for (const h of list) {
      const last = merged[merged.length - 1];
      if (last && last.name === h.name) last.end = h.date;
      else merged.push({ name: h.name, local_name: h.localName, start: h.date, end: h.date });
    }
    const top = merged.slice(0, 5);
    return {
      result: { country: cc, holidays: top },
      cards: { title: "holidays · " + cc, items: top.map(h => ({
        title: h.name + (h.local_name && h.local_name !== h.name ? " · " + h.local_name : ""),
        label: h.start === h.end ? h.start : h.start + " → " + h.end, desc: ""
      })) }
    };
  },

  async tech_headlines({ count }) {
    const n = Math.max(1, Math.min(5, parseInt(count, 10) || 3));
    const ids = await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json");
    const items = await Promise.all(ids.slice(0, n).map(id =>
      getJSON("https://hacker-news.firebaseio.com/v0/item/" + id + ".json").catch(() => null)));
    const stories = items.filter(Boolean).map(it => ({ title: it.title, points: it.score,
      url: it.url || "https://news.ycombinator.com/item?id=" + it.id }));
    return {
      result: { headlines: stories.map(s => ({ title: s.title, points: s.points })) },
      cards: { title: "tech headlines · hacker news", items: stories.map(s => ({
        title: s.title, url: s.url, label: s.points + " points", desc: "" })) }
    };
  },

  async set_timer({ minutes, seconds, label }) {
    const total = Math.round((Number(minutes) || 0) * 60 + (parseInt(seconds, 10) || 0));
    if (!(total > 0)) return { result: { error: "timer length must be more than zero" } };
    if (total > 6 * 3600) return { result: { error: "timer can be at most six hours" } };
    const lab = String(label || "timer").slice(0, 30);
    return { result: { started: true, total_seconds: total, label: lab,
      note: "The timer is running in the browser tab; it stops if the tab is closed." },
      action: { type: "timer", seconds: total, label: lab } };
  },

  // These four don't do anything here — the server has no route to the
  // user's own machine. They just hand the request to the browser as a
  // "device" action; handleTools()/runDeviceAction() there relay it to the
  // local agent over its own WebSocket and report what actually happened.
  async open_app({ app }) {
    const a = String(app || "").trim().slice(0, 40);
    if (!a) return { result: { error: "no app name given" } };
    return { result: { queued: true, app: a }, action: { type: "device", command: "open_app", args: { app: a } } };
  },

  async close_app({ app, force }) {
    const a = String(app || "").trim().slice(0, 40);
    if (!a) return { result: { error: "no app name given" } };
    return { result: { queued: true, app: a }, action: { type: "device", command: "close_app", args: { app: a, force: !!force } } };
  },

  async open_url({ url }) {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u)) return { result: { error: "url must start with http:// or https://" } };
    return { result: { queued: true, url: u }, action: { type: "device", command: "open_url", args: { url: u.slice(0, 500) } } };
  },

  async open_path({ path }) {
    const p = String(path || "").trim().slice(0, 300);
    if (!p) return { result: { error: "no path given" } };
    return { result: { queued: true, path: p }, action: { type: "device", command: "open_path", args: { path: p } } };
  },

  async find_files({ query }) {
    const q = String(query || "").trim().slice(0, 100);
    if (!q) return { result: { error: "no search query given" } };
    return { result: { queued: true, query: q,
      note: "Results aren't known yet — they'll show up in the user's results panel. Don't invent filenames." },
      action: { type: "device", command: "find_files", args: { query: q } } };
  },

  async lock_screen() {
    return { result: { queued: true }, action: { type: "device", command: "lock_screen", args: {} } };
  },

  async take_screenshot() {
    return { result: { queued: true, note: "Saved to the user's Desktop once it completes." },
      action: { type: "device", command: "screenshot", args: {} } };
  },

  async set_clipboard({ text }) {
    const t = String(text == null ? "" : text).slice(0, 5000);
    if (!t) return { result: { error: "no text given" } };
    return { result: { queued: true }, action: { type: "device", command: "set_clipboard", args: { text: t } } };
  },

  async adjust_volume({ direction, steps }) {
    const d = String(direction || "").toLowerCase();
    if (!["up", "down", "mute"].includes(d)) return { result: { error: "direction must be up, down, or mute" } };
    const n = Math.max(1, Math.min(20, parseInt(steps, 10) || 5));
    return { result: { queued: true, direction: d, steps: n },
      action: { type: "device", command: "adjust_volume", args: { direction: d, steps: n } } };
  }
};

async function runTool(name, argsJson) {
  const impl = IMPL[name];
  if (!impl) return { result: { error: "unknown tool " + name } };
  let args = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch (e) { return { result: { error: "bad arguments" } }; }
  try { return await impl(args || {}); }
  catch (e) { return { result: { error: name + " service unreachable (" + String((e && e.message) || e).slice(0, 60) + ")" } }; }
}

/* ---------------- Groq call ---------------- */
// Model choice: GROQ_MODEL if set, otherwise the first of PREFERRED.
// If Groq says the model doesn't exist for this key, ask /models once and switch.
const PREFERRED = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"];
let activeModel = null;   // remembered while the function instance stays warm

async function availableModel(KEY) {
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { authorization: "Bearer " + KEY }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).filter(m => m && m.active !== false).map(m => m.id);
  return PREFERRED.find(p => ids.includes(p)) ||
    ids.find(id => !/whisper|guard|orpheus|compound|tts|safeguard/i.test(id)) || null;
}

function modelOptions(model) {
  // reasoning models think before answering — keep that short, hidden, and budgeted
  if (/^openai\/gpt-oss/.test(model)) return { reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 1200 };
  if (/^qwen\//.test(model)) return { reasoning_effort: "none", reasoning_format: "hidden", max_completion_tokens: 600 };
  return { max_completion_tokens: 300 };
}

async function groqOnce(KEY, model, payload) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": "Bearer " + KEY },
    body: JSON.stringify({ ...payload, model, ...modelOptions(model) }),
    signal: AbortSignal.timeout(25000)
  });
  if (r.ok) return { ok: true, json: await r.json(), model };
  const text = await r.text().catch(() => "");
  return { ok: false, status: r.status, text, model };
}

async function groq(KEY, payload) {
  const model = activeModel || process.env.GROQ_MODEL || PREFERRED[0];
  const r = await groqOnce(KEY, model, payload);
  if (r.ok) { activeModel = model; return r; }
  const missing = r.status === 404 || /model_not_found|does not exist|decommissioned/i.test(r.text || "");
  if (!missing) return r;
  const alt = await availableModel(KEY).catch(() => null);
  console.error("groq model unavailable:", model, "→ switching to", alt);
  if (!alt || alt === model) return r;
  const r2 = await groqOnce(KEY, alt, payload);
  if (r2.ok) activeModel = alt;
  return r2;
}

function cleanHistory(raw) {
  // only plain user/assistant turns from the browser — never system/tool roles
  return (Array.isArray(raw) ? raw : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

function clockLine(tz) {
  const zone = typeof tz === "string" && tz.length < 50 ? tz : "Asia/Seoul";
  try {
    return "Current date and time for the user: " + new Date().toLocaleString("en-US",
      { timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (" + zone + ").";
  } catch (e) {
    return "Current date and time for the user: " + new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }) + " (Asia/Seoul).";
  }
}

module.exports = async (req, res) => {
  // same-origin in production; permissive headers are harmless
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const PASS = process.env.JARVIS_PASSWORD || "";
  const KEY = process.env.GROQ_API_KEY || "";

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // password gate
  if (PASS && body.password !== PASS) {
    return res.status(401).json({ error: "bad_password" });
  }
  // lightweight auth ping (used by the page's password screen)
  if (body.ping) return res.status(200).json({ ok: true });

  if (!KEY) return res.status(500).json({ error: "server_missing_key",
    message: "GROQ_API_KEY is not set on the server." });

  const history = cleanHistory(body.messages);
  if (!history.length) return res.status(400).json({ error: "no_messages" });

  // the page's language setting: "ko"/"en" pins the reply language, "auto" follows the user
  const langLine = body.lang === "ko" ? "\nReply in Korean." : body.lang === "en" ? "\nReply in English." : "";
  const localAgentOn = !!body.localAgent;
  const localAgentLine = "\n" + (localAgentOn
    ? "LOCAL AGENT: connected right now. open_app/open_url/open_path/find_files really run on the user's computer."
    : "LOCAL AGENT: not connected. Don't offer or call open_app/open_url/open_path/find_files — tell the user to connect it first if they ask for this.");
  const system = SYSTEM + "\n" + clockLine(body.tz) + langLine + localAgentLine;
  const messages = [{ role: "system", content: system }, ...history];
  const activeTools = localAgentOn ? TOOLS.concat(DEVICE_TOOLS) : TOOLS;
  const cards = [];
  const actions = [];
  const toolsUsed = [];
  const toolNotes = [];   // tool results as plain text, for the no-tools fallback
  const busy = () => res.status(429).json({ error: "rate_limited",
    message: "Free model is busy or the daily limit was hit — try again shortly." });
  const done = text => res.status(200).json({ text: (text || "").trim(), cards, actions, tools: toolsUsed, model: activeModel });

  // Plain chat without tool definitions — how the brain worked before tools.
  // Used whenever a tool-enabled call fails, so a reply always comes back.
  async function plainReply() {
    const sys = system + (toolNotes.length
      ? "\nTool results already fetched for this question (use them, do not invent others):\n" + toolNotes.join("\n")
      : "\nTools are unavailable for this reply; answer from your own knowledge and say so if live data was needed.");
    const r = await groq(KEY, { temperature: 0.6,
      messages: [{ role: "system", content: sys }, ...history] });
    if (r.ok) {
      const m = (r.json.choices && r.json.choices[0] && r.json.choices[0].message) || {};
      return done(m.content);
    }
    console.error("groq plain fallback failed", r.status, (r.text || "").slice(0, 600));
    if (r.status === 429) return busy();
    return res.status(502).json({ error: "upstream", message: "Groq " + r.status + ": " + (r.text || "").slice(0, 160) });
  }

  try {
    let retried = false;
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS;
      const payload = { temperature: retried ? 0.1 : 0.4, messages };
      if (!lastRound) { payload.tools = activeTools; payload.tool_choice = "auto"; }

      const r = await groq(KEY, payload);
      if (!r.ok) {
        console.error("groq tool call failed", r.status, "round", round, (r.text || "").slice(0, 600));
        if (r.status === 429) return busy();
        // malformed tool call from the model — Groq suggests retrying cooler once
        if (r.status === 400 && /tool_use_failed/.test(r.text) && !retried) { retried = true; round--; continue; }
        return await plainReply();
      }

      const msg = (r.json.choices && r.json.choices[0] && r.json.choices[0].message) || {};
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length || lastRound) {
        if (!(msg.content || "").trim() && toolNotes.length) return await plainReply();
        return done(msg.content);
      }

      messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
      const outs = await Promise.all(calls.slice(0, 4).map(c => runTool(c.function && c.function.name, c.function && c.function.arguments)));
      calls.slice(0, 4).forEach((c, i) => {
        const out = outs[i];
        const name = c.function && c.function.name;
        const json = JSON.stringify(out.result);
        toolsUsed.push(name);
        toolNotes.push(name + ": " + json.slice(0, 1500));
        if (out.cards) cards.push(out.cards);
        if (out.action) actions.push(out.action);
        messages.push({ role: "tool", tool_call_id: c.id, name, content: json.slice(0, 4000) });
      });
      // any tool calls beyond the first four still need an answer so the thread stays valid
      calls.slice(4).forEach(c => messages.push({ role: "tool", tool_call_id: c.id,
        name: c.function && c.function.name, content: JSON.stringify({ error: "skipped: too many tools at once" }) }));
    }
    return await plainReply();
  } catch (e) {
    console.error("chat handler error", String((e && e.message) || e).slice(0, 300));
    try { return await plainReply(); }
    catch (e2) { return res.status(502).json({ error: "upstream", message: String((e2 && e2.message) || e2).slice(0, 200) }); }
  }
};

// exported for local testing of the tools without calling Groq
module.exports.IMPL = IMPL;
