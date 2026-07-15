// Upwork Profile Optimisation — DOM scrape + skills replace + competitor research
(function () {
  "use strict";
  if (window.__UPO_CONTENT__) return;
  window.__UPO_CONTENT__ = true;

  function log(...a) {
    console.log("[UPO]", ...a);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  function dialogRoot() {
    return (
      document.querySelector("[role='dialog']") ||
      document.querySelector(".air3-modal") ||
      document.querySelector(".air3-fullscreen-element") ||
      document.querySelector("[data-test*='modal']") ||
      null
    );
  }

  function reactSetValue(el, value) {
    if (!el) return false;
    const val = String(value || "");
    el.focus();
    el.click();

    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Unidentified" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
    return true;
  }

  function normalizeOverviewText(text) {
    if (!text) return "";
    let s = String(text);
    s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, " ");
    s = s.replace(/\/n\/n/g, "\n\n").replace(/\/n/g, "\n");
    s = s.replace(/\u2028|\u2029/g, "\n");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    s = s.replace(/^[•·▪◦]\s*/gm, "• ");
    s = s.replace(/^[-*]\s+/gm, "• ");
    s = s.replace(/\u2014|\u2013/g, "-");
    s = s.replace(/\\"/g, '"');
    return s.trim();
  }

  function typeIn(el, text) {
    if (!el) return false;
    el.focus();
    let val = String(text || "");
    val = normalizeOverviewText(val);

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return reactSetValue(el, val);
    }
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      try {
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, val);
      } catch {
        el.innerText = val;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: val }));
      }
      return true;
    }
    return false;
  }

  /** Clear then type like a human (helps Upwork skill search autocomplete) */
  async function typeSearch(el, text) {
    if (!el) return false;
    el.focus();
    el.click();
    await sleep(80);

    // clear
    reactSetValue(el, "");
    el.select && el.select();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    await sleep(100);

    // character by character for React autocomplete
    let built = "";
    for (const ch of String(text)) {
      built += ch;
      reactSetValue(el, built);
      el.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) })
      );
      el.dispatchEvent(
        new KeyboardEvent("keypress", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) })
      );
      el.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" })
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) })
      );
      await sleep(35);
    }
    return true;
  }

  function findAllEditButtons() {
    return [...document.querySelectorAll("button, a, [role='button'], [aria-label]")]
      .filter((el) => {
        if (!visible(el)) return false;
        const a = (el.getAttribute("aria-label") || "").toLowerCase();
        const t = textOf(el).toLowerCase();
        return (
          a.includes("edit") ||
          t === "edit" ||
          a.includes("add") ||
          a.includes("update") ||
          /pencil|edit/i.test(el.innerHTML || "")
        );
      })
      .slice(0, 40)
      .map((el) => ({
        aria: el.getAttribute("aria-label") || "",
        text: textOf(el).slice(0, 50),
        tag: el.tagName,
      }));
  }

  function scrapeProfile() {
    const data = {
      url: location.href,
      scraped_at: new Date().toISOString(),
      name: "",
      title: "",
      overview: "",
      skills: [],
      portfolio: [],
      hourly: "",
      job_success: "",
    };

    data.name =
      textOf(document.querySelector("h1")) ||
      textOf(document.querySelector("[data-test='freelancer-name']")) ||
      textOf(document.querySelector("[data-qa='freelancer-name']")) ||
      "";

    const titleSelectors = [
      "[data-test='freelancer-title']",
      "[data-qa='freelancer-title']",
      "[data-test='title']",
      "h2.mb-0",
      "section h2",
      ".identity-title",
      "span[itemprop='jobTitle']",
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const t = textOf(el);
      if (t.length > 8 && t.length < 130 && t !== data.name) {
        data.title = t;
        break;
      }
    }
    if (!data.title) {
      document.querySelectorAll("main h2, [role='main'] h2, h2").forEach((el) => {
        if (data.title) return;
        const t = textOf(el);
        if (
          t.length > 10 &&
          t.length < 120 &&
          t !== data.name &&
          !/portfolio|work history|skills/i.test(t)
        ) {
          data.title = t;
        }
      });
    }

    const overviewSelectors = [
      "[data-test='description']",
      "[data-qa='description']",
      "section[data-test*='overview']",
      "div[data-test*='overview']",
      "div[data-test*='description']",
      "section.air3-card .break",
      "div.break",
      "[data-test='profile-overview']",
    ];
    let bestOverview = "";
    for (const sel of overviewSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = textOf(el);
        if (
          t.length > bestOverview.length &&
          t.length > 80 &&
          t.length < 10000 &&
          !/cookie|sign up|log in|find work|copyright/i.test(t.slice(0, 50))
        ) {
          bestOverview = t;
        }
      });
    }
    data.overview = bestOverview;

    const skillNodes = document.querySelectorAll(
      [
        "[data-test='skill']",
        "[data-qa='skill']",
        "a[href*='/o/profiles/skills/']",
        "a[href*='skill']",
        "span[data-test*='skill']",
        ".air3-badge",
        "button[data-test*='skill']",
        "span.air3-token",
        "[data-test='token']",
      ].join(",")
    );
    const skillSet = new Set();
    skillNodes.forEach((el) => {
      const t = textOf(el);
      if (t && t.length > 1 && t.length < 45 && !/more|show|less|\+\d/i.test(t)) {
        skillSet.add(t);
      }
    });
    data.skills = [...skillSet].slice(0, 40);

    const portNodes = document.querySelectorAll(
      "a[href*='portfolio'], [data-test*='portfolio'] h3, [data-test*='portfolio'] h4, article h3, article h4"
    );
    portNodes.forEach((el) => {
      const t = textOf(el);
      if (t && t.length > 3 && t.length < 140) data.portfolio.push(t);
    });
    data.portfolio = [...new Set(data.portfolio)].slice(0, 20);

    const bodyText = document.body ? textOf(document.body).slice(0, 8000) : "";
    const hm = bodyText.match(/\$[\d,.]+(?:\.\d{2})?\s*\/\s*hr/i);
    if (hm) data.hourly = hm[0];
    const js = bodyText.match(/(\d{1,3})%\s*Job Success/i);
    if (js) data.job_success = js[0];

    const ov = (data.overview || "").replace(/\s+/g, " ").trim().slice(0, 1800);
    data.profile_text = [
      "NAME: " + data.name,
      "TITLE: " + data.title,
      "HOURLY: " + data.hourly,
      "JOB_SUCCESS: " + data.job_success,
      "OVERVIEW: " + ov,
      "SKILLS: " + data.skills.slice(0, 20).join(", "),
      "PORTFOLIO: " + data.portfolio.slice(0, 8).join(" | "),
    ]
      .filter((line) => !/:\s*$/.test(line))
      .join("\n");

    data.dom_hints = {
      edit_buttons: findAllEditButtons(),
      page_title: document.title,
      has_dialog: !!dialogRoot(),
    };

    log("scraped", {
      title: data.title,
      overviewLen: data.overview.length,
      skills: data.skills.length,
    });
    return data;
  }

  /** Scrape talent search results cards (top freelancers list) */
  function scrapeTalentSearch(limit) {
    const max = Math.min(Number(limit) || 10, 15);
    const profiles = [];
    const seen = new Set();

    // Card / article / list item patterns on Upwork talent search
    const cards = [
      ...document.querySelectorAll(
        [
          "article",
          "[data-test='FreelancerTile']",
          "[data-test*='freelancer']",
          "section[data-test*='Freelancer']",
          "div[data-ev-label*='freelancer']",
          "div.up-card-section",
          "div[class*='freelancer']",
        ].join(",")
      ),
    ].filter(visible);

    // Fallback: profile links
    const linkCards = [...document.querySelectorAll('a[href*="/freelancers/"]')]
      .map((a) => a.closest("article, section, li, div[class*='card']") || a.parentElement)
      .filter(Boolean);

    const pool = cards.length >= 3 ? cards : [...cards, ...linkCards];

    for (const card of pool) {
      if (profiles.length >= max) break;
      // Prefer name/profile links, skip job/other links
      const links = [
        ...card.querySelectorAll('a[href*="/freelancers/"]'),
      ].filter((a) => {
        const h = a.getAttribute("href") || a.href || "";
        return /\/freelancers\/~|\/freelancers\/[^/?#]+/i.test(h) && !/\/jobs\//i.test(h);
      });
      const linkEl =
        links[0] ||
        (card.tagName === "A" && /freelancers/.test(card.href || "") ? card : null);
      const href = linkEl
        ? linkEl.href || linkEl.getAttribute("href") || ""
        : "";
      let abs = "";
      if (href) {
        try {
          const u = new URL(href, "https://www.upwork.com");
          abs = u.origin + u.pathname.replace(/\/$/, "");
        } catch {
          abs = href.split("?")[0];
        }
      }
      const key = abs || textOf(card).slice(0, 40);
      if (!key || seen.has(key)) continue;
      if (abs && !/\/freelancers\//.test(abs)) continue;
      // skip non-profile paths
      if (abs && /\/freelancers\/(search|directory)/i.test(abs)) continue;
      seen.add(key);

      const t = textOf(card);
      // title-like: often first substantial line after name
      let title = "";
      const titleEl =
        card.querySelector("[data-test*='title'], h4, h3, h2, strong") || null;
      title = textOf(titleEl);
      if (!title || title.length < 8) {
        const lines = t.split(/(?<=\.)\s+|\n/).filter((x) => x.length > 12 && x.length < 120);
        title = lines[0] || t.slice(0, 90);
      }

      const rateM = t.match(/\$[\d,.]+(?:\.\d{2})?\s*\/\s*hr/i);
      const jsM = t.match(/(\d{1,3})%\s*Job Success/i);

      // skills chips inside card
      const skills = [];
      card
        .querySelectorAll(
          ".air3-badge, .air3-token, [data-test*='skill'], a[href*='skill'], span[class*='skill']"
        )
        .forEach((el) => {
          const s = textOf(el);
          if (s && s.length > 1 && s.length < 40) skills.push(s);
        });

      const name =
        textOf(card.querySelector("h4 a, h3 a, a[data-test*='name'], [itemprop='name']")) ||
        textOf(card.querySelector("h4, h3")) ||
        "";

      // snippet / overview preview
      let snippet = "";
      const desc = card.querySelector(
        "[data-test*='description'], [data-test*='overview'], p, .clamped, .break"
      );
      snippet = textOf(desc).slice(0, 400);
      if (snippet.length < 40) {
        snippet = t.replace(name, "").replace(title, "").slice(0, 400);
      }

      profiles.push({
        name: name.slice(0, 80),
        title: title.slice(0, 120),
        hourly: rateM ? rateM[0] : "",
        job_success: jsM ? jsM[0] : "",
        skills: [...new Set(skills)].slice(0, 15),
        snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 350),
        url: abs.split("?")[0],
      });
    }

    // Fallback: any freelancer profile links on page (if cards thin)
    if (profiles.length < 5) {
      document.querySelectorAll('a[href*="/freelancers/"]').forEach((a) => {
        if (profiles.length >= max) return;
        let abs = "";
        try {
          const u = new URL(a.href || a.getAttribute("href") || "", location.origin);
          abs = u.origin + u.pathname.replace(/\/$/, "");
        } catch {
          return;
        }
        if (!/\/freelancers\/~/.test(abs) && !/\/freelancers\/[^/]+$/.test(abs)) return;
        if (/search|directory|signup/i.test(abs)) return;
        if (seen.has(abs)) return;
        seen.add(abs);
        const name = textOf(a).slice(0, 80);
        profiles.push({
          name,
          title: name,
          hourly: "",
          job_success: "",
          skills: [],
          snippet: "",
          url: abs,
        });
      });
    }

    const research_text = profiles
      .map(
        (p, i) =>
          `#${i + 1} ${p.name} | ${p.title} | ${p.hourly} | ${p.job_success}\n` +
          `Skills: ${(p.skills || []).join(", ")}\n` +
          `Preview: ${p.snippet || ""}\n` +
          `URL: ${p.url || ""}`
      )
      .join("\n\n");

    log("talent scrape", profiles.length);
    return {
      ok: true,
      count: profiles.length,
      url: location.href,
      profiles,
      research_text,
      scraped_at: new Date().toISOString(),
    };
  }

  function findEditControl(keywords) {
    const nodes = document.querySelectorAll("button, a, [role='button'], [aria-label]");
    const kws = keywords.map((k) => k.toLowerCase());
    let best = null;
    let bestScore = 0;

    for (const n of nodes) {
      if (!visible(n)) continue;
      const aria = (n.getAttribute("aria-label") || "").toLowerCase();
      const txt = textOf(n).toLowerCase();
      const blob = aria + " " + txt;
      let score = 0;
      for (const k of kws) {
        if (aria.includes(k)) score += 3;
        if (txt === k || txt.includes(k)) score += 2;
        if (blob.includes(k)) score += 1;
      }
      if (/edit/.test(blob)) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function findOpenDialogField(prefer) {
    const root = dialogRoot() || document.body;

    if (prefer === "title") {
      return (
        root.querySelector(
          'input[aria-label*="title" i], input[name*="title" i], input[id*="title" i], textarea[aria-label*="title" i], input[placeholder*="title" i]'
        ) || root.querySelector("input[type='text']:not([type='search']):not([type='hidden'])")
      );
    }

    return (
      root.querySelector(
        [
          "textarea[aria-label*='overview' i]",
          "textarea[aria-label*='description' i]",
          "textarea[name*='overview' i]",
          "textarea[name*='description' i]",
          "textarea[placeholder*='overview' i]",
          "textarea[placeholder*='description' i]",
          "div[contenteditable='true']",
          "textarea",
        ].join(",")
      ) || null
    );
  }

  async function clickSave(root) {
    const scope = root || dialogRoot() || document;
    const buttons = [...scope.querySelectorAll("button, [role='button']")].filter(visible);
    const save = buttons.find((b) => {
      const t = textOf(b).toLowerCase();
      const a = (b.getAttribute("aria-label") || "").toLowerCase();
      return (
        t === "save" ||
        t === "save changes" ||
        t === "update" ||
        a.includes("save") ||
        t === "done"
      );
    });
    if (save) {
      // avoid Save if disabled
      if (save.disabled || save.getAttribute("aria-disabled") === "true") {
        return { ok: false, error: "Save button disabled" };
      }
      save.click();
      await sleep(1400);
      return { ok: true };
    }
    return { ok: false, error: "Save not found" };
  }

  async function applyTitle(title) {
    const clean = String(title || "").slice(0, 70);
    if (!clean) return { ok: false, error: "Empty title" };

    let field = findOpenDialogField("title");
    if (!field || !visible(field)) {
      const btn = findEditControl([
        "edit title",
        "edit your title",
        "edit profile title",
        "title",
      ]);
      if (btn) {
        btn.click();
        await sleep(1400);
      }
      field = findOpenDialogField("title");
    }

    if (!field || !visible(field)) {
      return {
        ok: false,
        error: "Title field not found. Open Edit Title pencil, then Apply again.",
      };
    }

    typeIn(field, clean);
    await sleep(500);
    const saved = await clickSave();
    return { ok: true, saved: !!(saved && saved.ok), value: clean };
  }

  async function applyOverview(overview) {
    const clean = normalizeOverviewText(overview || "");
    if (!clean) return { ok: false, error: "Empty overview" };

    let field = findOpenDialogField("overview");
    if (field && field.tagName === "INPUT") field = null;

    if (!field || !visible(field)) {
      const btn = findEditControl([
        "edit overview",
        "edit description",
        "edit your overview",
        "edit profile overview",
        "overview",
        "description",
      ]);
      if (btn) {
        btn.click();
        await sleep(1400);
      }
      field = findOpenDialogField("overview");
    }

    if (!field || !visible(field)) {
      return {
        ok: false,
        error: "Overview field not found. Open Edit Overview, then Apply again.",
      };
    }

    typeIn(field, clean);
    await sleep(600);
    const saved = await clickSave();
    return { ok: true, saved: !!(saved && saved.ok), length: clean.length };
  }

  // ---------- SKILLS: remove all → search → add one by one → save ----------

  function getSkillRemoveButtons(root) {
    const scope = root || dialogRoot() || document;
    const buttons = [];

    // Common Upwork patterns for remove on skill chips
    scope
      .querySelectorAll(
        [
          "button[aria-label*='Remove' i]",
          "button[aria-label*='remove' i]",
          "button[aria-label*='Delete' i]",
          "button[data-test*='remove' i]",
          "button[data-test*='token' i]",
          ".air3-token button",
          ".air3-token [role='button']",
          "[class*='token'] button",
          "button.air3-token-close",
          "[data-test='token'] button",
        ].join(",")
      )
      .forEach((b) => {
        if (visible(b)) buttons.push(b);
      });

    // Chips that are themselves removable buttons with X
    scope.querySelectorAll(".air3-token, [data-test='token'], span.air3-badge").forEach((chip) => {
      const close =
        chip.querySelector("button, [role='button'], svg") &&
        (chip.querySelector("button") || chip.querySelector("[role='button']"));
      if (close && visible(close) && !buttons.includes(close)) buttons.push(close);
    });

    return buttons;
  }

  function getSelectedSkillLabels(root) {
    const scope = root || dialogRoot() || document;
    const labels = [];
    scope
      .querySelectorAll(
        ".air3-token, [data-test='token'], [data-test*='skill'], span.air3-badge, [class*='skill-token']"
      )
      .forEach((el) => {
        const t = textOf(el).replace(/×|x$/i, "").trim();
        if (t && t.length > 1 && t.length < 50 && !/add|search|save/i.test(t)) {
          labels.push(t);
        }
      });
    return [...new Set(labels)];
  }

  async function removeAllSkillsInModal() {
    const root = dialogRoot() || document.body;
    let removed = 0;
    // loop until no more remove buttons (max 40)
    for (let i = 0; i < 40; i++) {
      const btns = getSkillRemoveButtons(root);
      if (!btns.length) break;
      // always click last or first — DOM re-renders
      const btn = btns[btns.length - 1];
      try {
        btn.click();
        removed++;
        await sleep(220);
      } catch {
        break;
      }
    }
    // Also try keyboard Backspace on focused chips if any remain
    const remaining = getSelectedSkillLabels(root);
    log("skills removed", removed, "remaining labels", remaining.length);
    return { removed, remaining };
  }

  function findSkillSearchInput(root) {
    const scope = root || dialogRoot() || document.body;
    const candidates = [
      ...scope.querySelectorAll(
        [
          'input[aria-label*="skill" i]',
          'input[placeholder*="skill" i]',
          'input[placeholder*="Search" i]',
          'input[placeholder*="Add" i]',
          'input[type="search"]',
          'input[role="combobox"]',
          'input[aria-autocomplete]',
          'input.air3-typeahead-input',
          'input[class*="typeahead"]',
          'input[class*="dropdown"]',
        ].join(",")
      ),
    ].filter(visible);

    // Prefer skill-related
    const ranked = candidates.sort((a, b) => {
      const sa =
        ((a.getAttribute("placeholder") || "") + (a.getAttribute("aria-label") || "")).toLowerCase();
      const sb =
        ((b.getAttribute("placeholder") || "") + (b.getAttribute("aria-label") || "")).toLowerCase();
      const score = (s) =>
        (s.includes("skill") ? 5 : 0) + (s.includes("search") ? 2 : 0) + (s.includes("add") ? 2 : 0);
      return score(sb) - score(sa);
    });
    return ranked[0] || null;
  }

  async function pickSkillSuggestion(skill, root) {
    const scope = root || dialogRoot() || document;
    await sleep(450);

    const needle = skill.toLowerCase().trim();
    const options = [
      ...scope.querySelectorAll(
        [
          '[role="option"]',
          '[role="listbox"] [role="option"]',
          "li[role='option']",
          ".air3-menu-item",
          "[data-test*='menu-item']",
          "ul[role='listbox'] li",
          ".up-dropdown-menu-item",
          "[class*='dropdown'] li",
          "[class*='menu-item']",
        ].join(",")
      ),
    ].filter(visible);

    if (!options.length) {
      // global dropdown may render outside dialog
      const globalOpts = [
        ...document.querySelectorAll(
          '[role="option"], .air3-menu-item, [class*="menu-item"], ul[role="listbox"] li'
        ),
      ].filter(visible);
      options.push(...globalOpts);
    }

    // exact / starts with / includes
    let best = null;
    let bestScore = -1;
    for (const opt of options) {
      const t = textOf(opt).toLowerCase();
      if (!t || t.length > 60) continue;
      let score = 0;
      if (t === needle) score = 100;
      else if (t.startsWith(needle)) score = 80;
      else if (needle.startsWith(t) && t.length > 3) score = 70;
      else if (t.includes(needle)) score = 50;
      else if (needle.includes(t) && t.length > 4) score = 40;
      // boost Shopify-related
      if (score > 0 && /shopify|liquid|theme|css|html|javascript/i.test(t)) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }

    if (best && bestScore >= 40) {
      best.click();
      await sleep(350);
      return { ok: true, picked: textOf(best) };
    }

    // fallback: ArrowDown + Enter
    return { ok: false, error: "no suggestion for " + skill, options: options.length };
  }

  async function tryApplySkills(skills) {
    const list = (skills || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
    if (!list.length) return { ok: false, error: "no skills", recommended: [] };

    // Open skills modal
    let root = dialogRoot();
    if (!root) {
      const btn = findEditControl([
        "edit skills",
        "add skills",
        "skills",
        "edit specialties",
        "add skill",
      ]);
      if (btn) {
        btn.click();
        await sleep(1500);
      }
      root = dialogRoot();
    }

    if (!root) {
      return {
        ok: false,
        recommended: list,
        note:
          "Skills modal nahi khula. Profile pe Skills ke side Edit pencil kholo, phir Apply skills only dabao.\n" +
          list.join(", "),
      };
    }

    // 1) REMOVE all existing skills first
    const rem = await removeAllSkillsInModal();
    await sleep(400);

    // 2) Search + add one by one
    const input = findSkillSearchInput(root);
    if (!input) {
      return {
        ok: false,
        removed: rem.removed,
        recommended: list,
        note:
          "Skill search box nahi mila. Modal open hai — manually select:\n" + list.join(", "),
      };
    }

    const added = [];
    const failed = [];

    for (const skill of list) {
      try {
        // re-find input (React re-render)
        const inp = findSkillSearchInput(dialogRoot() || root) || input;
        await typeSearch(inp, skill);
        await sleep(600);

        let pick = await pickSkillSuggestion(skill, dialogRoot() || root);
        if (!pick.ok) {
          // try shorter query
          const short = skill.split(/\s+/)[0];
          if (short && short !== skill) {
            await typeSearch(inp, short);
            await sleep(600);
            pick = await pickSkillSuggestion(skill, dialogRoot() || root);
          }
        }

        if (pick.ok) {
          added.push(pick.picked || skill);
        } else {
          // last resort Enter
          inp.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "Enter", keyCode: 13 })
          );
          await sleep(300);
          const labels = getSelectedSkillLabels(dialogRoot() || root);
          if (labels.some((l) => l.toLowerCase().includes(skill.toLowerCase().slice(0, 6)))) {
            added.push(skill);
          } else {
            failed.push(skill);
          }
        }

        // clear for next
        await typeSearch(findSkillSearchInput(dialogRoot() || root) || inp, "");
        await sleep(200);
      } catch (e) {
        failed.push(skill + " (" + (e.message || e) + ")");
      }
    }

    await sleep(400);
    const saveRes = await clickSave(dialogRoot() || root);
    const finalLabels = getSelectedSkillLabels(dialogRoot() || document);

    const note = [
      "Skills removed: " + rem.removed,
      "Added: " + (added.length ? added.join(", ") : "(none)"),
      failed.length ? "Failed: " + failed.join(", ") : "",
      saveRes.ok ? "Saved" : "Save: " + (saveRes.error || "check modal"),
      finalLabels.length ? "Now in modal: " + finalLabels.slice(0, 15).join(", ") : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ok: added.length > 0,
      added,
      failed,
      removed: rem.removed,
      recommended: list,
      saved: !!(saveRes && saveRes.ok),
      note,
    };
  }

  async function applyOptimized(data) {
    const apply = (data && data.apply) || data || {};
    const results = { title: null, overview: null, skills: null, skills_note: null };
    const only = data && data.only; // 'title' | 'overview' | 'skills' | null

    if ((!only || only === "title") && apply.title) {
      results.title = await applyTitle(apply.title);
      await sleep(800);
    }
    if ((!only || only === "overview") && apply.overview) {
      results.overview = await applyOverview(apply.overview);
      await sleep(800);
    }
    if (!only || only === "skills") {
      const skills = apply.skills_priority || data.skills || [];
      if (skills.length) {
        results.skills = await tryApplySkills(skills);
        results.skills_note = (results.skills && results.skills.note) || "";
      }
    }

    return { ok: true, results };
  }

  function ensureBadge() {
    if (document.getElementById("upo-badge")) return;
    if (!document.body) return;
    const el = document.createElement("div");
    el.id = "upo-badge";
    el.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483646;background:#14a800;color:#fff;" +
      "padding:8px 12px;border-radius:8px;font:12px Segoe UI,Arial,sans-serif;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.25);max-width:260px;";
    el.textContent = "Upwork Profile Optimisation ready";
    document.body.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 4000);
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true, pong: true, url: location.href });
      return false;
    }
    if (msg.action === "scrapeProfile") {
      try {
        sendResponse({ ok: true, data: scrapeProfile() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      return false;
    }
    if (msg.action === "scrapeTalentSearch") {
      try {
        sendResponse(scrapeTalentSearch(msg.limit || 10));
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      return false;
    }
    if (msg.action === "applyOptimized") {
      applyOptimized(msg.data || {})
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
      return true;
    }
    if (msg.action === "applyTitleOnly") {
      applyTitle(msg.title || "")
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.action === "applyOverviewOnly") {
      applyOverview(msg.overview || "")
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.action === "applySkillsOnly") {
      tryApplySkills(msg.skills || [])
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    return false;
  });

  if (document.body) ensureBadge();
  else document.addEventListener("DOMContentLoaded", ensureBadge);
  log("content ready", location.href);
})();
