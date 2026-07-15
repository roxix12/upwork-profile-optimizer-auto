'use strict';

// Public GPT hard-limits chat message to 4000 characters
const MAX_MSG = 4000;
const MSG_SAFETY = 40;

// ---------- Public GPT client (service worker) ----------
const PUBLIC_GPT = {
  CHAT_URL:
    "https://publicgpt.lovable.app/_serverFn/1f52bca271952cad5ff37d96814219878833f65591cf5b6efeb8abd49a80b0d9",
  ORIGIN: "https://publicgpt.lovable.app",
  SUPABASE_URL: "https://iwrzhcjtaidmgnnduhus.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cnpoY2p0YWlkbWdubmR1aHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NTQwNDQsImV4cCI6MjA5OTQzMDA0NH0.8ihD6Fflin974YDpCej-Ni3b4Xz4UITDfe51ylRJ5kY",
};

function buildChatBody(message) {
  return {
    t: {
      t: 10,
      i: 0,
      p: {
        k: ["data"],
        v: [
          {
            t: 10,
            i: 1,
            p: {
              k: ["message", "history"],
              v: [
                { t: 1, s: String(message) },
                { t: 9, i: 2, a: [], o: 0 },
              ],
            },
            o: 0,
          },
        ],
      },
      o: 0,
    },
    f: 63,
    m: [],
  };
}

function extractReply(payload) {
  if (!payload) return null;
  function walk(node, depth) {
    if (!node || depth > 20) return null;
    if (node.p && Array.isArray(node.p.k) && Array.isArray(node.p.v)) {
      const map = {};
      node.p.k.forEach((k, i) => {
        map[k] = node.p.v[i];
      });
      if (map.reply != null) {
        const r = map.reply;
        if (typeof r === "string") return r;
        if (r && r.s) return r.s;
        if (r && r.p && Array.isArray(r.p.v)) {
          for (const v of r.p.v) {
            if (v && v.s) return v.s;
            const inner = walk(v, depth + 1);
            if (inner) return inner;
          }
        }
      }
      for (const v of node.p.v) {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
    }
    if (Array.isArray(node)) {
      for (const x of node) {
        const found = walk(x, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(payload, 0);
}

function extractError(payload) {
  function walk(node, depth) {
    if (!node || depth > 18) return null;
    if (node.c === "$TSR/Error" || node.t === 25) {
      const m = node.s && node.s.message;
      if (m && m.s) return m.s;
      if (typeof m === "string") return m;
    }
    if (node.p && Array.isArray(node.p.k)) {
      const i = node.p.k.indexOf("error");
      if (i >= 0) {
        const v = node.p.v[i];
        if (v && v.s && typeof v.s === "string") return v.s;
        const nested = walk(v, depth + 1);
        if (nested) return nested;
      }
      for (const x of node.p.v || []) {
        const f = walk(x, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  return walk(payload, 0);
}

function parseAuthInput(raw) {
  if (!raw || typeof raw !== "string") {
    return { access_token: "", refresh_token: "", expires_at: 0 };
  }
  let s = raw.trim();
  if (!s) return { access_token: "", refresh_token: "", expires_at: 0 };

  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) {
    return { access_token: s, refresh_token: "", expires_at: 0 };
  }

  for (let i = 0; i < 2; i++) {
    if (!s.startsWith("{") && !s.startsWith('"')) break;
    try {
      const obj = JSON.parse(s);
      if (typeof obj === "string") {
        s = obj.trim();
        continue;
      }
      if (obj && typeof obj === "object") {
        const access =
          obj.access_token ||
          obj.accessToken ||
          (obj.currentSession && obj.currentSession.access_token) ||
          "";
        const refresh =
          obj.refresh_token ||
          obj.refreshToken ||
          (obj.currentSession && obj.currentSession.refresh_token) ||
          "";
        const expires_at =
          obj.expires_at ||
          (obj.currentSession && obj.currentSession.expires_at) ||
          0;
        return {
          access_token: String(access || "").trim(),
          refresh_token: String(refresh || "").trim(),
          expires_at: Number(expires_at) || 0,
        };
      }
    } catch {
      break;
    }
  }

  const m = s.match(/"access_token"\s*:\s*"(eyJ[^"]+)"/);
  if (m) {
    const rm = s.match(/"refresh_token"\s*:\s*"([^"]+)"/);
    return { access_token: m[1], refresh_token: rm ? rm[1] : "", expires_at: 0 };
  }
  return { access_token: s, refresh_token: "", expires_at: 0 };
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  const url = `${PUBLIC_GPT.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: PUBLIC_GPT.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${PUBLIC_GPT.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.access_token) return null;
  await chrome.storage.local.set({
    publicGptToken: JSON.stringify({
      access_token: json.access_token,
      refresh_token: json.refresh_token || refreshToken,
      expires_at:
        json.expires_at || Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
      token_type: "bearer",
    }),
  });
  return json.access_token;
}

async function resolveAccessToken(rawFromMsg) {
  const store = await chrome.storage.local.get({ publicGptToken: "" });
  const raw = (rawFromMsg || store.publicGptToken || "").trim();
  let parsed = parseAuthInput(raw);
  const now = Math.floor(Date.now() / 1000);
  if (parsed.refresh_token && parsed.expires_at && parsed.expires_at < now + 60) {
    const fresh = await refreshAccessToken(parsed.refresh_token);
    if (fresh) parsed.access_token = fresh;
  }
  if (!parsed.access_token && parsed.refresh_token) {
    const fresh = await refreshAccessToken(parsed.refresh_token);
    if (fresh) parsed.access_token = fresh;
  }
  return parsed.access_token || "";
}

function humanizeApiError(err) {
  if (!err) return "No AI reply";
  const s = String(err);
  if (/too_big|at most 4000/i.test(s)) {
    return "Prompt too long (Public GPT max 4000 chars). Extension will auto-truncate — reload extension and retry.";
  }
  if (/unauthorized|invalid token|jwt/i.test(s)) {
    return "Token invalid/expired — Public GPT se naya token paste karo.";
  }
  // zod array as string
  if (s.includes('"code"') && s.length > 200) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr[0] && arr[0].message) {
        return arr.map((x) => x.message).join("; ");
      }
    } catch {
      /* keep */
    }
  }
  return s.slice(0, 400);
}

async function rawChat(message, accessToken) {
  if (!accessToken) {
    return {
      ok: false,
      error: "No Public GPT token — popup me paste karo (LinkedIn agent wala JSON).",
    };
  }
  // Hard clamp — Public GPT rejects message > 4000
  let msg = String(message || "");
  if (msg.length > MAX_MSG) {
    msg = msg.slice(0, MAX_MSG - 20) + "\n…[truncated]";
  }

  const res = await fetch(PUBLIC_GPT.CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/x-tss-framed, application/x-ndjson, application/json",
      "x-tsr-serverfn": "true",
      origin: PUBLIC_GPT.ORIGIN,
      referer: PUBLIC_GPT.ORIGIN + "/",
      Authorization: "Bearer " + accessToken.trim(),
    },
    body: JSON.stringify(buildChatBody(msg)),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Non-JSON from AI", raw: text.slice(0, 400) };
  }
  const reply = extractReply(json);
  const err = extractError(json);
  // Validation errors sometimes appear as reply text or error
  if (reply && /too_big|at most 4000|"code"\s*:\s*"too_big"/i.test(reply)) {
    return { ok: false, error: humanizeApiError(reply) };
  }
  if (err && /too_big|at most 4000/i.test(err)) {
    return { ok: false, error: humanizeApiError(err) };
  }
  if (reply) return { ok: true, text: reply, message_chars: msg.length };
  if (err && /unauthorized|invalid token|jwt/i.test(err)) {
    const store = await chrome.storage.local.get({ publicGptToken: "" });
    const parsed = parseAuthInput(store.publicGptToken || "");
    if (parsed.refresh_token) {
      const fresh = await refreshAccessToken(parsed.refresh_token);
      if (fresh && fresh !== accessToken) return rawChat(msg, fresh);
    }
  }
  return { ok: false, error: humanizeApiError(err || text.slice(0, 300)) };
}

function parseJsonLoose(text) {
  if (!text) return null;
  let raw = String(text).trim();
  // unescape if whole blob is a JSON string with \n
  if (raw.includes("\\n") && !raw.includes("\n") && raw.length > 50) {
    try {
      raw = JSON.parse('"' + raw.replace(/^"/, "").replace(/"$/, "").replace(/"/g, '\\"') + '"');
    } catch {
      raw = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);

  const attempts = [
    raw,
    raw.replace(/,\s*([}\]])/g, "$1"),
    raw.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"),
    // fix unescaped newlines inside strings (rough)
    raw.replace(/\r?\n/g, "\\n"),
  ];
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* next */
    }
  }
  return null;
}

/** Pull title/overview/skills even when full JSON is broken/truncated */
function extractPartialProfile(text) {
  if (!text) return null;
  let raw = String(text);
  // normalize escaped newlines from display
  if (raw.includes("\\n")) {
    raw = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  function grabString(keys) {
    for (const key of keys) {
      // "key": "value" with possible multiline until next "key" or end
      const re = new RegExp(
        '"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"',
        "i"
      );
      const m = raw.match(re);
      if (m && m[1]) {
        return m[1]
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .trim();
      }
    }
    return "";
  }

  function grabStringArray(key) {
    const re = new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]', "i");
    const m = raw.match(re);
    if (!m) return [];
    const items = [];
    const itemRe = /"((?:\\.|[^"\\])*)"/g;
    let im;
    while ((im = itemRe.exec(m[1])) !== null) {
      items.push(
        im[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
          .trim()
      );
    }
    return items.filter(Boolean);
  }

  function grabNumber(keys) {
    for (const key of keys) {
      const re = new RegExp('"' + key + '"\\s*:\\s*(\\d+)', "i");
      const m = raw.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  }

  let title = grabString(["title"]) || "";
  let applyOverview = "";
  const applyBlock = raw.match(/"apply"\s*:\s*\{([\s\S]*?)\}/i);
  if (applyBlock) {
    const t = applyBlock[1].match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/i);
    const o = applyBlock[1].match(/"overview"\s*:\s*"((?:\\.|[^"\\])*)"/i);
    if (t) title = t[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
    if (o) applyOverview = o[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }

  let overview = applyOverview || grabString(["overview"]);
  const titles = grabStringArray("titles");
  if (!title && titles[0]) title = titles[0];
  const skills = grabStringArray("skills").length
    ? grabStringArray("skills")
    : grabStringArray("skills_priority");
  const portfolio_titles = grabStringArray("portfolio_titles");
  const score = grabNumber(["score"]);
  const seo_score_estimate = grabNumber(["seo_score_estimate", "new_score"]);

  // fallback: first line that looks like Shopify title
  if (!title) {
    const tm = raw.match(
      /Shopify[^"\n|]{0,20}(?:\|[^"\n]{0,40}){0,3}/i
    );
    if (tm) title = tm[0].trim().slice(0, 70);
  }

  // fallback overview: longest chunk of text after "overview"
  if (!overview || overview.length < 40) {
    const idx = raw.toLowerCase().indexOf("overview");
    if (idx >= 0) {
      let chunk = raw.slice(idx, idx + 3000);
      chunk = chunk.replace(/^[\s\S]*?["']?overview["']?\s*[:\s]+["']?/i, "");
      // cut at next json key
      chunk = chunk.split(/"\s*,\s*"/)[0] || chunk;
      chunk = chunk.replace(/^"+|"+$/g, "").replace(/\\n/g, "\n").trim();
      if (chunk.length > overview.length) overview = chunk.slice(0, 2500);
    }
  }

  if (!title && !overview) return null;

  return {
    keyword_research: [],
    audit: {
      score: score != null ? score : 0,
      flagged_words: [],
      missing_keywords: [],
      title_issues: "partial extract",
      overview_issues: "partial extract",
    },
    titles: titles.length ? titles : title ? [title] : [],
    overview: overview || "",
    skills: skills,
    portfolio_titles: portfolio_titles,
    before_after: [],
    seo_score_estimate: seo_score_estimate != null ? seo_score_estimate : 0,
    apply: {
      title: String(title || "").slice(0, 70),
      overview: overview || "",
      skills_priority: skills,
    },
    _partial: true,
  };
}

/** Fix AI dumping literal \n /n into overview — make real line breaks + clean bullets */
function normalizeOverviewText(text) {
  if (!text) return "";
  let s = String(text);

  // Literal backslash-n sequences (common AI bug in JSON)
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, " ");
  // User-reported /n/n style mistakes
  s = s.replace(/\/n\/n/g, "\n\n").replace(/\/n/g, "\n");
  // Unicode line separators
  s = s.replace(/\u2028|\u2029/g, "\n");
  // Collapse crazy spaces but keep intentional blank lines
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  // Normalize bullets
  s = s.replace(/^[•·▪◦]\s*/gm, "• ");
  s = s.replace(/^[-*]\s+/gm, "• ");
  // No em dashes
  s = s.replace(/\u2014|\u2013/g, "-");
  // Strip leftover escaped quotes
  s = s.replace(/\\"/g, '"');
  return s.trim();
}

function defaultThemeSkills() {
  return [
    "Shopify",
    "Shopify Theme",
    "Liquid",
    "Shopify Online Store 2.0",
    "HTML",
    "CSS",
    "JavaScript",
    "Theme Customization",
    "Shopify Sections",
    "Shopify Plus",
    "Responsive Design",
    "Bug Fixes",
    "JSON Templates",
    "Shopify CLI",
    "Web Development",
  ];
}

function normalizeOptimizeData(json) {
  if (!json || typeof json !== "object") return null;
  if (!json.apply) json.apply = {};
  if (!json.apply.title && json.titles && json.titles[0]) {
    json.apply.title = String(json.titles[0]).slice(0, 70);
  }
  if (!json.apply.title && json.title) {
    json.apply.title = String(json.title).slice(0, 70);
  }

  let overview = json.apply.overview || json.overview || "";
  overview = normalizeOverviewText(overview);
  json.overview = overview;
  json.apply.overview = overview;

  if (!json.apply.skills_priority && json.skills) {
    json.apply.skills_priority = json.skills;
  }
  if (!json.skills || !json.skills.length) {
    json.skills = defaultThemeSkills();
  }
  // Filter out SEO-only junk skills if AI still returns them alone
  json.skills = (json.skills || []).filter(
    (s) => !/^(SEO|Google Analytics|Content Writing)$/i.test(String(s).trim())
  );
  if (json.skills.length < 8) {
    json.skills = [...new Set([...json.skills, ...defaultThemeSkills()])].slice(0, 15);
  }
  json.apply.skills_priority = json.skills;

  if (!json.titles) json.titles = [];
  if (json.apply.title) json.apply.title = String(json.apply.title).slice(0, 70);
  if (!json.apply.title && !json.apply.overview) return null;
  return json;
}

/**
 * Shopify THEME DEV / BUG FIX optimizer (NOT SEO).
 * Uses REAL competitor scrape data when provided.
 */
function buildOptimizerPrompt(profileText, extraNotes, competitorText) {
  const notes = String(extraNotes || "None").trim().slice(0, 80);

  const head = `Upwork profile writer for SHOPIFY THEME DEVELOPER.
Niche: theme bug fixes, Liquid, custom sections/blocks, custom themes, OS 2.0. NOT SEO/marketing.

Use COMPETITOR DATA (real top Shopify freelancers scraped) to match title patterns, skill tags, and overview hooks. Do not copy names. Mirror what wins.

TITLE max70, Shopify first. e.g. Shopify Theme Developer | Bug Fix | Custom Sections

OVERVIEW: real line breaks (JSON \\n). Bullets with •. NOT one paragraph. Structure:
hook (broken theme/custom section need)
WHAT I DO • bullets
HOW I WORK • bullets  
STACK: Liquid|OS2.0|HTML|CSS|JS
CTA
Max 1000 chars. Client voice. No fake %. No em dash. No visible \\n text.

SKILLS: 12 real Upwork skill names from competitors + theme-dev (Shopify, Liquid, Theme Customization, HTML, CSS, JavaScript, Online Store 2.0, Shopify Plus, Responsive Design, Web Development). Prefer exact skill names freelancers use.

JSON only:
{"score":40,"new_score":90,"titles":["t1","t2","t3"],"title":"best","overview":"hook\\n\\nWHAT I DO\\n• a\\n• b\\n\\nSTACK: Liquid\\n\\nMessage me.","skills":["Shopify","Liquid","HTML","CSS","JavaScript","Theme Customization","Shopify Plus","Responsive Design","Web Development","Shopify Theme Development","API Integration","eCommerce"]}

NOTES:${notes}
`;

  // Split budget between competitors + my profile
  const budget = MAX_MSG - MSG_SAFETY - head.length;
  let comp = String(competitorText || "").trim().replace(/\s+/g, " ");
  let profile = String(profileText || "(empty)").trim().replace(/\s+/g, " ");

  // Prefer profile; leave room for competitors
  const profileMax = Math.min(1200, Math.floor(budget * 0.45));
  const compMax = Math.max(200, budget - profileMax - 40);

  if (profile.length > profileMax) profile = profile.slice(0, profileMax - 1) + "…";
  if (comp.length > compMax) comp = comp.slice(0, compMax - 1) + "…";
  if (!comp) comp = "(no live scrape — use typical top Shopify theme developer patterns)";

  let full = head + "COMPETITORS:\n" + comp + "\nMY PROFILE:\n" + profile;
  if (full.length > MAX_MSG) full = full.slice(0, MAX_MSG - 8) + "…";
  return full;
}

/** Map compact AI shape → full shape for popup/apply */
function expandCompactData(j) {
  if (!j) return null;
  const title = (j.title || (j.titles && j.titles[0]) || (j.apply && j.apply.title) || "").slice(0, 70);
  const overview = normalizeOverviewText(j.overview || (j.apply && j.apply.overview) || "");
  const titles = j.titles && j.titles.length ? j.titles : title ? [title] : [];
  let skills = j.skills || (j.apply && j.apply.skills_priority) || [];
  if (!skills.length) skills = defaultThemeSkills();
  return normalizeOptimizeData({
    keyword_research: [
      { term: "Shopify Theme", frequency_note: "core" },
      { term: "Liquid", frequency_note: "core" },
      { term: "Custom Sections", frequency_note: "core" },
      { term: "Bug Fix", frequency_note: "core" },
    ],
    audit: j.audit || {
      score: j.score != null ? j.score : 0,
      flagged_words: j.flagged_words || [],
      missing_keywords: j.missing_keywords || [],
      title_issues: j.title_issues || "",
      overview_issues: j.overview_issues || "",
    },
    titles,
    overview,
    skills,
    portfolio_titles: j.portfolio_titles || [],
    before_after: j.before_after || [],
    seo_score_estimate: j.seo_score_estimate != null ? j.seo_score_estimate : j.new_score != null ? j.new_score : 0,
    apply: {
      title,
      overview,
      skills_priority: skills,
    },
  });
}

async function persistTokenFromMsg(tokenRaw) {
  if (!tokenRaw) return;
  const p = parseAuthInput(tokenRaw);
  if (!p.access_token) return;
  await chrome.storage.local.set({
    publicGptToken: p.refresh_token
      ? JSON.stringify({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
          expires_at: p.expires_at,
          token_type: "bearer",
        })
      : p.access_token,
  });
}

// ---------- Deep competitor research (open each profile) ----------
const TALENT_SEARCH_URL =
  "https://www.upwork.com/nx/search/talent/?q=shopify%20theme%20developer&sort=best_match&nbs=1";

let researchRunning = false;

function sleepBg(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setResearchStatus( partial ) {
  const prev = (await chrome.storage.local.get({ researchStatus: {} })).researchStatus || {};
  const next = { ...prev, ...partial, updated_at: Date.now() };
  await chrome.storage.local.set({ researchStatus: next });
  try {
    const cur = next.current || 0;
    const total = next.total || 10;
    if (next.running) {
      chrome.action.setBadgeText({ text: cur + "/" + total });
      chrome.action.setBadgeBackgroundColor({ color: "#14a800" });
    } else if (next.done) {
      chrome.action.setBadgeText({ text: "OK" });
      chrome.action.setBadgeBackgroundColor({ color: "#14a800" });
    } else if (next.error) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#b24020" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    /* ignore */
  }
  return next;
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch {
        /* */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs || 25000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        finish(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") {
        clearTimeout(timer);
        finish(true);
      }
    }).catch(() => {});
  });
}

async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (e) {
    // may already be injected
    console.warn("[UPO] inject", e.message || e);
  }
  await sleepBg(250);
}

async function tabMessage(tabId, msg, retries) {
  const n = retries || 4;
  let lastErr = null;
  for (let i = 0; i < n; i++) {
    try {
      await injectContent(tabId);
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (e) {
      lastErr = e;
      await sleepBg(800);
    }
  }
  throw lastErr || new Error("tab message fail");
}

function cleanProfileUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url, "https://www.upwork.com");
    if (!/\/freelancers\//.test(u.pathname)) return "";
    // drop query
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function buildResearchText(profiles) {
  return profiles
    .map((p, i) => {
      const skills = (p.skills || []).slice(0, 12).join(", ");
      const ov = (p.overview || p.snippet || "").replace(/\s+/g, " ").slice(0, 320);
      return (
        `#${i + 1} ${p.name || ""} | ${p.title || ""}\n` +
        `Rate: ${p.hourly || "?"} | ${p.job_success || "?"}\n` +
        `Skills: ${skills}\n` +
        `Overview: ${ov}\n` +
        `URL: ${p.url || ""}`
      );
    })
    .join("\n\n");
}

/**
 * Full pipeline:
 * 1) Open talent search
 * 2) Scrape list of top profile URLs
 * 3) Open EACH profile, scrape title/overview/skills
 * 4) Save deep research for AI
 */
async function runDeepResearch(opts) {
  if (researchRunning) {
    return { ok: false, error: "Research already running" };
  }
  researchRunning = true;
  const limit = Math.min(Number(opts && opts.limit) || 10, 10);
  const deepProfiles = [];
  // Keep service worker alive during multi-minute research
  const keepAlive = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo(() => {});
    } catch {
      /* */
    }
  }, 15000);

  try {
    await setResearchStatus({
      running: true,
      done: false,
      error: "",
      step: "Opening Shopify talent search...",
      current: 0,
      total: limit,
      log: [],
    });

    // 1) Search tab
    const searchTab = await chrome.tabs.create({
      url: TALENT_SEARCH_URL,
      active: true,
    });
    await waitTabComplete(searchTab.id, 30000);
    // SPA cards load late
    await sleepBg(5500);

    await setResearchStatus({
      step: "Scraping search list for profile links...",
    });

    let listRes = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // scroll search page to load more cards
        await chrome.scripting.executeScript({
          target: { tabId: searchTab.id },
          func: () => {
            window.scrollBy(0, 900);
            window.scrollBy(0, 900);
          },
        });
        await sleepBg(1200);
        listRes = await tabMessage(searchTab.id, {
          action: "scrapeTalentSearch",
          limit: limit,
        });
        if (listRes && listRes.ok && listRes.count > 0) break;
      } catch (e) {
        console.warn("[UPO] list scrape", e.message || e);
      }
      await sleepBg(1500);
    }

    if (!listRes || !listRes.profiles || !listRes.profiles.length) {
      throw new Error(
        "Talent search se profile links nahi mile. Login check karo / page load hone do."
      );
    }

    // unique URLs
    const urls = [];
    const seen = new Set();
    for (const p of listRes.profiles) {
      const u = cleanProfileUrl(p.url);
      if (u && !seen.has(u)) {
        seen.add(u);
        urls.push({ url: u, listMeta: p });
      }
    }
    if (!urls.length) {
      throw new Error("Koi valid /freelancers/ URL nahi mili search se");
    }

    const toOpen = urls.slice(0, limit);
    await setResearchStatus({
      step: "Opening " + toOpen.length + " profiles one-by-one...",
      total: toOpen.length,
      current: 0,
      list_count: toOpen.length,
    });

    // keep search tab; open profiles in background tabs
    for (let i = 0; i < toOpen.length; i++) {
      const item = toOpen[i];
      await setResearchStatus({
        step: "Opening profile " + (i + 1) + "/" + toOpen.length + "...",
        current: i,
        current_url: item.url,
      });

      let pTab = null;
      try {
        pTab = await chrome.tabs.create({ url: item.url, active: true });
        await waitTabComplete(pTab.id, 30000);
        // Upwork SPA: wait for profile content
        await sleepBg(4500);

        // scroll to load overview/skills
        try {
          await chrome.scripting.executeScript({
            target: { tabId: pTab.id },
            func: () => {
              window.scrollBy(0, 600);
              window.scrollBy(0, 600);
            },
          });
        } catch {
          /* */
        }
        await sleepBg(1200);

        const scrape = await tabMessage(pTab.id, { action: "scrapeProfile" }, 5);
        const d = (scrape && scrape.data) || {};
        const meta = item.listMeta || {};

        const row = {
          name: d.name || meta.name || "",
          title: d.title || meta.title || "",
          hourly: d.hourly || meta.hourly || "",
          job_success: d.job_success || meta.job_success || "",
          skills: (d.skills && d.skills.length ? d.skills : meta.skills) || [],
          overview: d.overview || meta.snippet || "",
          portfolio: d.portfolio || [],
          url: item.url,
          deep: true,
        };

        // require at least title or overview
        if (row.title || row.overview || (row.skills && row.skills.length)) {
          deepProfiles.push(row);
          await setResearchStatus({
            step: "Scraped " + (i + 1) + "/" + toOpen.length + ": " + (row.title || row.name || "").slice(0, 40),
            current: i + 1,
            scraped_count: deepProfiles.length,
          });
        } else {
          // still keep list meta
          deepProfiles.push({
            ...meta,
            url: item.url,
            deep: false,
            note: "shallow fallback",
          });
          await setResearchStatus({
            step: "Weak scrape " + (i + 1) + " — used list card data",
            current: i + 1,
          });
        }
      } catch (e) {
        console.warn("[UPO] profile", item.url, e.message || e);
        deepProfiles.push({
          ...(item.listMeta || {}),
          url: item.url,
          deep: false,
          error: e.message || String(e),
        });
        await setResearchStatus({
          step: "Error profile " + (i + 1) + ": " + (e.message || e),
          current: i + 1,
        });
      } finally {
        if (pTab && pTab.id) {
          try {
            await chrome.tabs.remove(pTab.id);
          } catch {
            /* */
          }
        }
        // polite delay so Upwork less likely to block
        await sleepBg(900);
      }
    }

    const research_text = buildResearchText(deepProfiles);
    const payload = {
      ok: true,
      deep: true,
      count: deepProfiles.length,
      profiles: deepProfiles,
      research_text,
      scraped_at: new Date().toISOString(),
      search_url: TALENT_SEARCH_URL,
    };

    await chrome.storage.local.set({
      lastResearch: payload,
      researchPending: false,
    });
    await setResearchStatus({
      running: false,
      done: true,
      error: "",
      step: "Done! " + deepProfiles.length + " profiles deep-scraped",
      current: deepProfiles.length,
      total: toOpen.length,
      scraped_count: deepProfiles.length,
    });

    // optional: close search tab? keep it for user
    return payload;
  } catch (e) {
    await setResearchStatus({
      running: false,
      done: false,
      error: e.message || String(e),
      step: "Failed: " + (e.message || e),
    });
    return { ok: false, error: e.message || String(e) };
  } finally {
    researchRunning = false;
    clearInterval(keepAlive);
  }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.action === "optimizeProfile") {
    (async () => {
      try {
        await persistTokenFromMsg(msg.token);
        const token = await resolveAccessToken(msg.token);
        const prompt = buildOptimizerPrompt(
          msg.profileText || "",
          msg.extraNotes || "",
          msg.competitorText || ""
        );
        console.log("[UPO] prompt chars:", prompt.length, "/", MAX_MSG);
        const result = await rawChat(prompt, token);
        if (!result.ok) {
          sendResponse(result);
          return;
        }

        let data =
          expandCompactData(parseJsonLoose(result.text)) ||
          expandCompactData(extractPartialProfile(result.text));

        await chrome.storage.local.set({
          lastOptimizeAt: Date.now(),
          lastOptimizeRaw: result.text,
          lastOptimizeData: data || null,
        });

        if (!data || !(data.apply && (data.apply.title || data.apply.overview))) {
          sendResponse({
            ok: true,
            parsed: false,
            raw_text: result.text,
            message:
              "AI reply aaya lekin title/overview extract nahi hua. Copy all dabao ya dobara Optimize.",
          });
          return;
        }

        sendResponse({
          ok: true,
          parsed: true,
          partial: !!data._partial,
          data,
          raw_text: result.text,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === "testAi") {
    (async () => {
      try {
        await persistTokenFromMsg(msg.token);
        const token = await resolveAccessToken(msg.token);
        const r = await rawChat('Reply with only: {"ok":true}', token);
        sendResponse(r);
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  // Start deep research — SW stays alive while runDeepResearch awaits tabs APIs
  if (msg.action === "startDeepResearch") {
    if (researchRunning) {
      sendResponse({ ok: false, error: "Research pehle se chal rahi hai — badge dekho" });
      return false;
    }
    // Hold the service worker on this async chain (MV3)
    (async () => {
      try {
        const r = await runDeepResearch({ limit: msg.limit || 10 });
        console.log("[UPO] deep research done", r && r.count);
      } catch (e) {
        console.error("[UPO] deep research", e);
        await setResearchStatus({
          running: false,
          done: false,
          error: e.message || String(e),
          step: "Failed",
        });
      }
    })();
    sendResponse({
      ok: true,
      started: true,
      message: "Deep research start — har profile open hogi. Badge pe 1/10 progress.",
    });
    return false;
  }

  if (msg.action === "getResearchStatus") {
    chrome.storage.local.get({ researchStatus: null, lastResearch: null }, (d) => {
      sendResponse({
        ok: true,
        status: d.researchStatus,
        research: d.lastResearch,
      });
    });
    return true;
  }

  if (msg.action === "stopDeepResearch") {
    // soft stop flag — next loop checks researchRunning only at start;
    // for true cancel we'd need a flag; set error state for user clarity
    researchRunning = false;
    setResearchStatus({
      running: false,
      done: false,
      error: "Stopped by user",
      step: "Stopped",
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
