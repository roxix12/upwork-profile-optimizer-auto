'use strict';

/**
 * Shopify Theme Developer profile optimizer (bug fix / custom sections / custom themes).
 * NOT SEO. Mirrored into background.js for service worker.
 */
function buildOptimizerPrompt(profileText, extraNotes) {
  const notes = String(extraNotes || "None").trim().slice(0, 100);
  return `You optimize Upwork profiles for a SHOPIFY THEME DEVELOPER.
Niche ONLY: theme bug fixes, Liquid fixes, custom sections/blocks, custom theme development, OS 2.0, theme customization. NOT SEO. NOT marketing.

TITLE (max 70): Shopify first. e.g. Shopify Theme Developer | Bug Fix | Custom Sections

OVERVIEW: real line breaks (JSON \\n), bullets with •, sections WHAT I DO / HOW I WORK / STACK / CTA. No wall of text. No literal \\n as visible text. Max 1100 chars. Client voice. No fake %.

SKILLS: Shopify, Liquid, Theme Customization, HTML, CSS, JavaScript, Online Store 2.0, Bug Fixes, Shopify Sections, Responsive Design, Shopify Plus, JSON Templates, Web Development.

JSON only:
{"score":40,"new_score":90,"titles":["t1","t2","t3"],"title":"best","overview":"hook\\n\\nWHAT I DO\\n• ...","skills":["Shopify","Liquid",...]}

NOTES:${notes}
PROFILE:
${profileText || "(empty)"}
`;
}

if (typeof module !== "undefined") {
  module.exports = { buildOptimizerPrompt };
}
