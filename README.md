# Upwork Profile Optimisation

**Chrome extension** that helps freelancers (especially **Shopify theme developers**) research top Upwork profiles, rewrite their own profile with AI, and apply title / overview / skills on their profile page.

> Niche focus: **theme bug fixes · Liquid · custom sections · custom themes · OS 2.0**  
> Not an SEO spam tool — structured, client-focused profile copy.

---

## Features

| Feature | Description |
|--------|-------------|
| **Deep competitor research** | Opens top Shopify talent search, then **opens each of the top ~10 profiles** and scrapes title, overview, skills, rate |
| **AI rewrite** | Uses [Public GPT](https://publicgpt.lovable.app) to produce optimized title, structured overview, and skill list grounded in research + your profile |
| **Structured overview** | Hook → WHAT I DO (bullets) → HOW I WORK → STACK → CTA — not a wall of text |
| **Auto apply** | Fills **title** and **overview** on your Upwork profile edit UI |
| **Skills replace** | Removes old skills (when modal is open), searches and adds new ones one-by-one |
| **Progress badge** | Extension icon shows `1/10`…`OK` during deep research |

---

## Screenshots / Demo flow

1. **Deep Research** → talent search + open each competitor profile  
2. Open **your** `upwork.com/freelancers/~…` page  
3. **AI Optimize** with research data  
4. **Apply** title + overview  
5. Open Skills edit modal → **Apply Skills**

---

## Install (Load unpacked)

1. Clone this repo:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder
6. Pin the extension

---

## AI token setup (Public GPT)

This extension calls **Public GPT** (same pattern as many community tools). You need your own session token:

1. Log in at [https://publicgpt.lovable.app](https://publicgpt.lovable.app)
2. Open DevTools → **Application** → **Local Storage**
3. Copy the `sb-*-auth-token` value (full JSON) or the `access_token` JWT
4. Paste into the extension popup → **Save** → **Test AI**

Never commit your token. Never share it publicly.

---

## How to use

### 1) Deep research (competitors)

1. Stay logged into Upwork in Chrome  
2. Open the extension popup  
3. Click **Deep Research: open Top 10 profiles**  
4. Wait **2–4 minutes**  
   - Search page opens  
   - Each profile is opened, scraped, then closed  
   - Badge on the icon: `1/10` → `2/10` → … → `OK`  
5. Popup can be closed; reopen later to see results  

### 2) Optimize your profile

1. Open **your** profile: `https://www.upwork.com/freelancers/~…`  
2. Optional notes: e.g. `theme bug fixes, custom sections, Liquid, OS 2.0`  
3. Click **My profile → AI Optimize (with research)**  
4. Wait until status shows **Ready ✓**  

### 3) Apply changes

1. **Apply Title + Overview** (or title/overview only)  
2. Click the **Skills** edit pencil on Upwork so the skills modal is open  
3. Click **Apply Skills (remove old → search add new)**  
4. Review everything on Upwork before leaving the page  

If an edit field is not found: open the relevant **Edit** modal manually, leave it open, click Apply again.

---

## Project structure

```
Upwork Profile Optimisation/
├── manifest.json      # MV3 manifest
├── background.js      # Public GPT API, deep research orchestration, prompts
├── content.js         # DOM scrape, apply title/overview/skills, talent search scrape
├── popup.html         # Extension UI
├── popup.js           # UI logic, research status polling
├── lib/
│   ├── api.js         # API helpers (reference)
│   └── prompt.js      # Prompt mirror
└── README.md
```

---

## Requirements

- Google Chrome (or Chromium-based browser) with extension developer mode  
- Upwork account (logged in)  
- Public GPT account + valid access token  
- Internet access to `upwork.com` and `publicgpt.lovable.app`

---

## Permissions (why)

| Permission | Why |
|------------|-----|
| `storage` | Save token, last research, last optimize result |
| `scripting` | Inject content script when needed |
| `tabs` | Open talent search + competitor profiles during deep research |
| Host: `upwork.com` | Scrape / apply on profile and search pages |
| Host: Public GPT / Supabase | AI chat API |

---

## Safety & legal

- **Review all AI text** before saving on Upwork. Do not invent fake metrics.  
- Automating Upwork **may conflict with Upwork’s Terms of Service**. Use at your own risk.  
- This tool is for **your own profile** optimization and educational competitor analysis — not for spam, scraping abuse, or mass automation of client outreach.  
- Public GPT and Upwork UIs change often; selectors may break and need updates.  
- No warranty. Provided as-is.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `too_big` / 4000 chars | Fixed in recent builds; reload extension. Message is auto-truncated. |
| AI fail / unauthorized | Paste fresh Public GPT token (JSON with refresh_token preferred). |
| Research stops at search | Stay logged into Upwork; wait for talent list to load; try again. |
| Skills only open modal | Open Skills **Edit** yourself first; use **Apply Skills**; Upwork may block some skill names. |
| Content script not ready | Hard refresh (F5) the Upwork page after reloading the extension. |
| Apply field not found | Manually open Edit Title / Overview, then Apply again. |

---

## Development

1. Edit files in this folder  
2. Go to `chrome://extensions` → click **Reload** on the extension  
3. Refresh any open Upwork tabs  

No build step — plain MV3 JS.

---

## Roadmap ideas

- [ ] Optional OpenAI / other providers (user API key)  
- [ ] Niche presets (Shopify apps, WordPress, etc.)  
- [ ] Export optimized profile to Markdown  
- [ ] Better skills matching against Upwork’s exact skill taxonomy  

PRs welcome.

---

## Disclaimer

Not affiliated with Upwork, Shopify, or Public GPT.  
All trademarks belong to their owners.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Author

Built for freelancers who ship **Shopify themes, bug fixes, and custom sections** — and want a profile that reads like that.
