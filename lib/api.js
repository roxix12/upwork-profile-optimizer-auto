'use strict';

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
        return {
          access_token: String(obj.access_token || obj.accessToken || "").trim(),
          refresh_token: String(obj.refresh_token || obj.refreshToken || "").trim(),
          expires_at: Number(obj.expires_at || 0) || 0,
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

async function rawChat(message, accessToken) {
  if (!accessToken) return { ok: false, error: "No Public GPT token. Popup me paste karo." };
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
    body: JSON.stringify(buildChatBody(message)),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Non-JSON from AI", raw: text.slice(0, 300) };
  }
  const reply = extractReply(json);
  const err = extractError(json);
  if (reply) return { ok: true, text: reply };
  if (err && /unauthorized|invalid token|jwt/i.test(err)) {
    const store = await chrome.storage.local.get({ publicGptToken: "" });
    const parsed = parseAuthInput(store.publicGptToken || "");
    if (parsed.refresh_token) {
      const fresh = await refreshAccessToken(parsed.refresh_token);
      if (fresh && fresh !== accessToken) return rawChat(message, fresh);
    }
  }
  return { ok: false, error: err || "No AI reply" };
}

function parseJsonLoose(text) {
  if (!text) return null;
  let raw = String(text).trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  PUBLIC_GPT,
  parseAuthInput,
  resolveAccessToken,
  rawChat,
  parseJsonLoose,
};
