'use strict';

const tokenEl = document.getElementById("token");
const extraNotesEl = document.getElementById("extraNotes");
const resultBox = document.getElementById("resultBox");
const runStatus = document.getElementById("runStatus");
const aiStatus = document.getElementById("aiStatus");
const scoreBox = document.getElementById("scoreBox");

let lastScraped = null;
let lastData = null;
let lastResearch = null;
let busy = false;

const TALENT_SEARCH_URL =
  "https://www.upwork.com/nx/search/talent/?q=shopify%20theme%20developer&sort=best_match&nbs=1";

function setRun(msg, ok) {
  runStatus.textContent = msg || "";
  runStatus.className = "status " + (ok === false ? "err" : ok === true ? "ok" : "");
}

function setBusy(on) {
  busy = !!on;
  [
    "fullAutoBtn",
    "scrapeBtn",
    "researchBtn",
    "applyBtn",
    "applyTitleBtn",
    "applyOverviewBtn",
    "applySkillsBtn",
    "testAi",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });
}

function normalizeToken(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (/^eyJ/.test(s) && s.split(".").length === 3) return s;
  try {
    let o = JSON.parse(s);
    if (typeof o === "string") o = JSON.parse(o);
    if (o && o.access_token) {
      return JSON.stringify({
        access_token: o.access_token,
        refresh_token: o.refresh_token || "",
        expires_at: o.expires_at || 0,
        token_type: "bearer",
      });
    }
  } catch {
    /* keep */
  }
  return s;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getUpworkTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes("upwork.com")) {
    throw new Error("Pehle Upwork tab active karo");
  }
  return tab;
}

async function ensureContent(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    if (ping && ping.ok) return true;
  } catch {
    /* inject */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await new Promise((r) => setTimeout(r, 300));
  return true;
}

async function scrapeActive() {
  const tab = await getUpworkTab();
  await ensureContent(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, { action: "scrapeProfile" });
  if (!res || !res.ok) throw new Error((res && res.error) || "scrape fail");
  lastScraped = res.data;
  await chrome.storage.local.set({ lastScrape: lastScraped });
  return lastScraped;
}

function cleanOverviewLocal(text) {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, " ");
  s = s.replace(/\/n\/n/g, "\n\n").replace(/\/n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/^[-*]\s+/gm, "• ");
  return s.trim();
}

function recoverFromText(text) {
  if (!text || text.length < 20) return null;
  let raw = String(text);
  if (raw.includes("\\n") && raw.split("\n").length < 3) {
    raw = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  function grab(key) {
    const re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', "i");
    const m = raw.match(re);
    if (!m) return "";
    return m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }

  function grabArr(key) {
    const re = new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]', "i");
    const m = raw.match(re);
    if (!m) return [];
    const out = [];
    const itemRe = /"((?:\\.|[^"\\])*)"/g;
    let im;
    while ((im = itemRe.exec(m[1])) !== null) {
      out.push(im[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim());
    }
    return out.filter(Boolean);
  }

  if (raw.includes("=== APPLY TITLE ===") || raw.includes("=== OVERVIEW ===")) {
    const titleM = raw.match(/=== APPLY TITLE ===\s*\n([^\n]+)/);
    const ovM = raw.match(/=== OVERVIEW ===\s*\n([\s\S]*?)(?=\n=== |\n*$)/);
    const skillsM = raw.match(/=== SKILLS[^\n]*===\s*\n([^\n]+)/);
    const title = (titleM && titleM[1].trim()) || "";
    const overview = cleanOverviewLocal((ovM && ovM[1].trim()) || "");
    const skills = skillsM
      ? skillsM[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (title || overview) {
      return {
        titles: title ? [title] : [],
        overview,
        skills,
        audit: { score: "?" },
        seo_score_estimate: "?",
        apply: { title: title.slice(0, 70), overview, skills_priority: skills },
      };
    }
  }

  let title = grab("title");
  let overview = cleanOverviewLocal(grab("overview"));
  const titles = grabArr("titles");
  if (!title && titles[0]) title = titles[0];
  const skills = grabArr("skills");
  if (!title && !overview) return null;
  return {
    titles: titles.length ? titles : title ? [title] : [],
    overview,
    skills,
    audit: { score: 0 },
    seo_score_estimate: 0,
    apply: {
      title: String(title || "").slice(0, 70),
      overview,
      skills_priority: skills,
    },
  };
}

function formatResult(data) {
  if (!data) return "";
  const lines = [];
  lines.push("=== PROFILE SCORE ===");
  lines.push("Now: " + (data.audit && data.audit.score) + " → After: " + data.seo_score_estimate);
  lines.push("");
  lines.push("=== TITLES ===");
  (data.titles || []).forEach((t, i) => lines.push(i + 1 + ". " + t));
  lines.push("");
  lines.push("=== APPLY TITLE ===");
  lines.push((data.apply && data.apply.title) || "");
  lines.push("");
  lines.push("=== OVERVIEW ===");
  lines.push(cleanOverviewLocal(data.overview || (data.apply && data.apply.overview) || ""));
  lines.push("");
  lines.push("=== SKILLS (replace list) ===");
  lines.push((data.skills || (data.apply && data.apply.skills_priority) || []).join(", "));
  lines.push("");
  lines.push(">>> Apply Title/Overview, phir Skills Edit open karke Apply Skills");
  return lines.join("\n");
}

function showScore(data) {
  if (!data) {
    scoreBox.style.display = "none";
    return;
  }
  const a = (data.audit && data.audit.score) != null ? data.audit.score : "?";
  const e = data.seo_score_estimate != null ? data.seo_score_estimate : "?";
  scoreBox.style.display = "block";
  scoreBox.textContent = "Score: " + a + " → " + e;
}

function acceptOptimizeResult(res) {
  if (res && res.parsed && res.data) {
    if (res.data.overview) res.data.overview = cleanOverviewLocal(res.data.overview);
    if (res.data.apply) {
      res.data.apply.overview = cleanOverviewLocal(
        res.data.apply.overview || res.data.overview
      );
    }
    lastData = res.data;
    chrome.storage.local.set({ lastOptimizeData: lastData });
    resultBox.value = formatResult(res.data);
    showScore(res.data);
    setRun(
      "Ready ✓ · " +
        ((res.data.apply && res.data.apply.title) || "").slice(0, 34) +
        " · Apply dabao",
      true
    );
    return true;
  }
  const recovered = recoverFromText(res && res.raw_text);
  if (recovered) {
    lastData = recovered;
    chrome.storage.local.set({ lastOptimizeData: recovered });
    resultBox.value = formatResult(recovered);
    showScore(recovered);
    setRun("Recovered ✓ · Apply dabao", true);
    return true;
  }
  resultBox.value = (res && res.raw_text) || "";
  setRun((res && res.message) || "Parse fail", false);
  return false;
}

function normalizePayload(data) {
  const apply = (data && data.apply) || {};
  const overview = cleanOverviewLocal(apply.overview || data.overview || "");
  return {
    ...data,
    overview,
    apply: {
      title: apply.title || (data.titles && data.titles[0]) || "",
      overview,
      skills_priority: apply.skills_priority || data.skills || [],
    },
  };
}

async function getApplyPayload() {
  if (lastData && lastData.apply && (lastData.apply.title || lastData.apply.overview)) {
    return normalizePayload(lastData);
  }
  const d = await chrome.storage.local.get({ lastOptimizeData: null, lastOptimizeRaw: "" });
  if (d.lastOptimizeData && d.lastOptimizeData.apply) {
    lastData = d.lastOptimizeData;
    return normalizePayload(lastData);
  }
  const fromBox = recoverFromText(resultBox.value || d.lastOptimizeRaw || "");
  if (fromBox) {
    lastData = fromBox;
    await chrome.storage.local.set({ lastOptimizeData: fromBox });
    return normalizePayload(fromBox);
  }
  return null;
}

async function runOptimize() {
  const token = normalizeToken(tokenEl.value);
  await chrome.storage.local.set({
    publicGptToken: token,
    extraNotes: extraNotesEl.value,
  });

  if (!lastScraped || !lastScraped.profile_text) {
    await scrapeActive();
  }
  if (!lastScraped || !lastScraped.profile_text) {
    throw new Error("Apna freelancers/~ profile open karke scrape karo");
  }

  // load research from storage if memory empty
  if (!lastResearch) {
    const st = await chrome.storage.local.get({ lastResearch: null });
    lastResearch = st.lastResearch;
  }

  const competitorText =
    (lastResearch && lastResearch.research_text) ||
    (lastResearch && lastResearch.profiles
      ? lastResearch.profiles
          .map(
            (p, i) =>
              `#${i + 1} ${p.title} | ${p.hourly} | skills: ${(p.skills || []).join(",")}`
          )
          .join("\n")
      : "");

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "optimizeProfile",
        profileText: lastScraped.profile_text,
        extraNotes: extraNotesEl.value,
        competitorText,
        token,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "Optimize fail"));
          return;
        }
        resolve(res);
      }
    );
  });
}

let researchPollTimer = null;

function stopResearchPoll() {
  if (researchPollTimer) {
    clearInterval(researchPollTimer);
    researchPollTimer = null;
  }
}

function formatResearchPreview(research) {
  if (!research) return "";
  const deep = research.deep ? "DEEP (each profile opened)" : "LIST ONLY";
  return (
    "=== RESEARCH " +
    deep +
    " · " +
    (research.count || 0) +
    " profiles ===\n\n" +
    (research.research_text || "").slice(0, 6000) +
    "\n\n>>> Apna freelancers/~ profile open karke AI Optimize dabao"
  );
}

/**
 * Start background deep research:
 * search → collect 10 links → OPEN each profile → scrape title/overview/skills
 * Popup can close; badge shows 1/10 progress.
 */
async function researchTop10() {
  setRun("Deep research start: search + har profile open hogi (2–4 min)...", null);

  // start in background service worker (survives popup close)
  const start = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "startDeepResearch", limit: 10 }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "no response" });
    });
  });

  if (!start.ok && !start.started) {
    throw new Error(start.error || "Research start fail");
  }

  setRun("Running… popup band bhi kar sakte ho. Icon pe badge 1/10 dekho.", true);

  stopResearchPoll();
  researchPollTimer = setInterval(async () => {
    try {
      const st = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "getResearchStatus" }, (res) => {
          resolve(res || {});
        });
      });
      const s = st.status || {};
      if (s.running) {
        setRun(
          (s.step || "Working...") +
            " · " +
            (s.current || 0) +
            "/" +
            (s.total || 10),
          null
        );
      }
      if (s.done && st.research) {
        stopResearchPoll();
        lastResearch = st.research;
        resultBox.value = formatResearchPreview(st.research);
        setRun(
          "Deep research DONE ✓ " +
            (st.research.count || 0) +
            " profiles opened & scraped",
          true
        );
        setBusy(false);
      }
      if (s.error && !s.running) {
        stopResearchPoll();
        setRun("Research fail: " + s.error, false);
        setBusy(false);
      }
    } catch {
      /* keep polling */
    }
  }, 1200);

  // wait up to ~5 min while popup stays open
  for (let i = 0; i < 250; i++) {
    const st = await chrome.storage.local.get({ researchStatus: null, lastResearch: null });
    const s = st.researchStatus || {};
    if (s.running) {
      setRun((s.step || "Working...") + " · " + (s.current || 0) + "/" + (s.total || 10), null);
    }
    if (s.done && st.lastResearch) {
      stopResearchPoll();
      lastResearch = st.lastResearch;
      resultBox.value = formatResearchPreview(st.lastResearch);
      setRun("Deep research DONE ✓ " + (st.lastResearch.count || 0) + " profiles", true);
      setBusy(false);
      return st.lastResearch;
    }
    if (s.error && !s.running) {
      stopResearchPoll();
      setBusy(false);
      throw new Error(s.error);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  // still running — user can close popup; badge continues
  setRun("Background me chal rahi hai — icon badge 1/10 dekho, baad me popup kholo", true);
  setBusy(false);
  return null;
}

async function load() {
  const d = await chrome.storage.local.get({
    publicGptToken: "",
    lastOptimizeData: null,
    lastOptimizeRaw: "",
    lastScrape: null,
    lastResearch: null,
    extraNotes: "",
    researchPending: false,
  });
  tokenEl.value = d.publicGptToken || "";
  extraNotesEl.value = d.extraNotes || "";
  lastScraped = d.lastScrape;
  lastResearch = d.lastResearch;

  if (d.lastOptimizeData && (d.lastOptimizeData.apply || d.lastOptimizeData.overview)) {
    lastData = d.lastOptimizeData;
    resultBox.value = formatResult(lastData);
    showScore(lastData);
  } else if (d.lastResearch && d.lastResearch.research_text) {
    resultBox.value =
      "=== SAVED RESEARCH (" +
      (d.lastResearch.count || "?") +
      ") ===\n\n" +
      d.lastResearch.research_text.slice(0, 4000);
  } else if (d.lastOptimizeRaw) {
    resultBox.value = d.lastOptimizeRaw;
  }

  // resume status if research running / done
  if (d.researchStatus && d.researchStatus.running) {
    setRun(
      (d.researchStatus.step || "Research running...") +
        " " +
        (d.researchStatus.current || 0) +
        "/" +
        (d.researchStatus.total || 10),
      null
    );
    // re-attach poll
    researchPollTimer = setInterval(async () => {
      const st = await chrome.storage.local.get({ researchStatus: null, lastResearch: null });
      const s = st.researchStatus || {};
      if (s.running) {
        setRun((s.step || "...") + " · " + (s.current || 0) + "/" + (s.total || 10), null);
      }
      if (s.done && st.lastResearch) {
        stopResearchPoll();
        lastResearch = st.lastResearch;
        resultBox.value = formatResearchPreview(st.lastResearch);
        setRun("Deep research DONE ✓ " + (st.lastResearch.count || 0), true);
      }
      if (s.error && !s.running) {
        stopResearchPoll();
        setRun("Research fail: " + s.error, false);
      }
    }, 1200);
  } else if (d.researchStatus && d.researchStatus.done && d.lastResearch) {
    setRun("Last research: " + (d.lastResearch.count || 0) + " deep profiles ready", true);
  }
}

tokenEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ publicGptToken: normalizeToken(tokenEl.value) });
});
extraNotesEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ extraNotes: extraNotesEl.value });
});

document.getElementById("saveToken").addEventListener("click", async () => {
  await chrome.storage.local.set({ publicGptToken: normalizeToken(tokenEl.value) });
  aiStatus.textContent = "Token saved";
  aiStatus.className = "hint ok";
});

document.getElementById("testAi").addEventListener("click", async () => {
  aiStatus.textContent = "Testing...";
  const token = normalizeToken(tokenEl.value);
  await chrome.storage.local.set({ publicGptToken: token });
  chrome.runtime.sendMessage({ action: "testAi", token }, (res) => {
    if (chrome.runtime.lastError) {
      aiStatus.textContent = chrome.runtime.lastError.message;
      aiStatus.className = "hint err";
      return;
    }
    if (res && res.ok) {
      aiStatus.textContent = "AI OK ✓";
      aiStatus.className = "hint ok";
    } else {
      aiStatus.textContent = "AI fail: " + ((res && res.error) || "unknown");
      aiStatus.className = "hint err";
    }
  });
});

document.getElementById("researchBtn").addEventListener("click", async () => {
  setBusy(true);
  try {
    await researchTop10();
    // if still running in background, keep button free after short start
    const st = await chrome.storage.local.get({ researchStatus: null });
    if (st.researchStatus && st.researchStatus.running) {
      // poll will setBusy false on complete
      setRun(
        (st.researchStatus.step || "Research running...") +
          " — popup band kar sakte ho, badge dekho",
        null
      );
    }
  } catch (e) {
    stopResearchPoll();
    setRun(e.message || String(e), false);
    setBusy(false);
  }
});

document.getElementById("scrapeBtn").addEventListener("click", async () => {
  setBusy(true);
  setRun("Fetching my profile...", null);
  try {
    const data = await scrapeActive();
    resultBox.value = "=== MY PROFILE ===\n\n" + (data.profile_text || "");
    setRun(
      "Scraped · title=" +
        (data.title || "?").slice(0, 32) +
        " · skills " +
        (data.skills || []).length,
      true
    );
  } catch (e) {
    setRun(e.message || String(e), false);
  } finally {
    setBusy(false);
  }
});

document.getElementById("fullAutoBtn").addEventListener("click", async () => {
  setBusy(true);
  setRun("My profile scrape + AI (with top-10 research)...", null);
  try {
    // prefer freelancers profile tab
    const tab = await getActiveTab();
    if (!tab || !tab.url || !/freelancers\//.test(tab.url)) {
      throw new Error("Apna profile tab active karo: upwork.com/freelancers/~…");
    }
    await scrapeActive();
    const res = await runOptimize();
    acceptOptimizeResult(res);
  } catch (e) {
    setRun(e.message || String(e), false);
  } finally {
    setBusy(false);
  }
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultBox.value || "");
    setRun("Copied", true);
  } catch {
    setRun("Copy fail", false);
  }
});

document.getElementById("copyOverview").addEventListener("click", async () => {
  try {
    const payload = await getApplyPayload();
    const ov = (payload && payload.apply && payload.apply.overview) || "";
    if (!ov) throw new Error("Overview empty");
    await navigator.clipboard.writeText(ov);
    setRun("Overview copied", true);
  } catch (e) {
    setRun(e.message || "fail", false);
  }
});

async function doApply(mode) {
  setBusy(true);
  setRun("Applying...", null);
  try {
    const payload = await getApplyPayload();
    if (!payload || !payload.apply) {
      throw new Error("Pehle Optimize chalao (Ready ✓)");
    }
    const tab = await getUpworkTab();
    await ensureContent(tab.id);

    let res;
    if (mode === "title") {
      res = await chrome.tabs.sendMessage(tab.id, {
        action: "applyTitleOnly",
        title: payload.apply.title,
      });
    } else if (mode === "overview") {
      res = await chrome.tabs.sendMessage(tab.id, {
        action: "applyOverviewOnly",
        overview: payload.apply.overview,
      });
    } else if (mode === "skills") {
      const skills = payload.apply.skills_priority || payload.skills || [];
      if (!skills.length) throw new Error("Skills list empty");
      res = await chrome.tabs.sendMessage(tab.id, {
        action: "applySkillsOnly",
        skills,
      });
      if (res && res.note) {
        resultBox.value = (resultBox.value || "") + "\n\n=== SKILLS APPLY LOG ===\n" + res.note;
      }
      setRun(
        res && res.ok
          ? "Skills: removed " +
              (res.removed || 0) +
              ", added " +
              ((res.added && res.added.length) || 0)
          : (res && res.note) || (res && res.error) || "Skills fail — modal open karke retry",
        !!(res && res.ok)
      );
      return;
    } else {
      // title + overview only (skills separate — safer)
      res = await chrome.tabs.sendMessage(tab.id, {
        action: "applyOptimized",
        data: { ...payload, only: null, apply: { ...payload.apply, skills_priority: [] } },
      });
      // re-apply title overview without skills in applyOptimized — we cleared skills_priority
      // Actually applyOptimized still runs title+overview. Good.
    }

    if (!res || res.ok === false) {
      throw new Error((res && res.error) || "apply fail");
    }

    if (mode === "all") {
      const r = res.results || {};
      setRun(
        "Title: " +
          (r.title && r.title.ok ? "OK" : "fail") +
          " · Overview: " +
          (r.overview && r.overview.ok ? "OK" : "fail") +
          " · Skills alag button se",
        true
      );
    } else {
      setRun("Apply " + mode + " OK", true);
    }
  } catch (e) {
    setRun(e.message || String(e), false);
  } finally {
    setBusy(false);
  }
}

document.getElementById("applyBtn").addEventListener("click", () => doApply("all"));
document.getElementById("applyTitleBtn").addEventListener("click", () => doApply("title"));
document.getElementById("applyOverviewBtn").addEventListener("click", () => doApply("overview"));
document.getElementById("applySkillsBtn").addEventListener("click", () => doApply("skills"));

load();
