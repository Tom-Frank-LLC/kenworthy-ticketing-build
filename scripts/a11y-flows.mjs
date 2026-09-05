/**
 * The half of the audit `a11y-audit.mjs` cannot see.
 *
 * axe only ever scans what is on screen. The three money paths — ticket
 * checkout, film pass, donation — put their forms behind a click, so a
 * first-paint scan of /showing/:id or /donate reports a clean page while the
 * form that actually takes a card is never looked at. This script clicks into
 * each flow, scans there, and also dumps the accessible name of every control
 * and every image, which is the part axe reports as "passed" whenever an
 * attribute merely exists.
 *
 * Same prerequisites as a11y-audit.mjs:
 *   npm install --no-save axe-core puppeteer
 *   npm run dev -- --mode staging
 *   node scripts/a11y-flows.mjs
 *
 * SHOWING_ID must be a future, ticketed showing on whichever environment the
 * dev server is pointed at, or the ticket flow scans an "unavailable" page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.A11Y_BASE || 'http://localhost:8080';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOWING_ID = process.env.SHOWING_ID || 'd9929697-29bd-4056-ae5e-ef655417f5e0';
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const OUT = process.env.A11Y_OUT || 'a11y-flows.json';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click the first element whose visible text matches, without needing a selector. */
async function clickText(page, re, tag = '*') {
  return page.evaluate((reSrc, reFlags, tag) => {
    const rx = new RegExp(reSrc, reFlags);
    const els = [...document.querySelectorAll(tag)].filter(
      (e) => rx.test((e.innerText || e.value || '').trim()) && e.offsetParent !== null,
    );
    // Innermost match — outer containers also contain the text.
    const el = els[els.length - 1];
    if (!el) return false;
    el.click();
    return true;
  }, re.source, re.flags, tag);
}

async function scan(page, label) {
  await page.evaluate(AXE);
  const res = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations'],
    });
    const trim = (arr) => arr.map((v) => ({
      id: v.id, impact: v.impact, count: v.nodes.length,
      nodes: v.nodes.slice(0, 8).map((n) => ({
        target: n.target.join(' '),
        html: (n.html || '').slice(0, 180),
        summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220),
      })),
    }));

    // Accessible-name spot check. axe passes a control that has *some* name;
    // this shows what that name actually is, which is where placeholder-only
    // and icon-only controls give themselves away.
    const nameOf = (el) => {
      if (el.getAttribute('aria-label')) return 'aria-label:' + el.getAttribute('aria-label');
      const lb = el.getAttribute('aria-labelledby');
      if (lb) return 'labelledby:' + lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || '?').join(' ');
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return 'label:' + l.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap) return 'wrapping-label:' + wrap.textContent.trim().slice(0, 60);
      const txt = (el.innerText || '').trim();
      if (txt) return 'text:' + txt.slice(0, 60);
      if (el.title) return 'title:' + el.title;
      if (el.placeholder) return 'PLACEHOLDER-ONLY:' + el.placeholder;
      return '*** NO ACCESSIBLE NAME ***';
    };

    const controls = [...document.querySelectorAll(
      'input:not([type=hidden]), select, textarea, button, [role=button], [role=switch], [role=checkbox], a[href]',
    )]
      .filter((e) => e.offsetParent !== null)
      // Radix mirrors each of its form controls into a hidden native input
      // once the control sits inside a real <form>, so the checkout grew two
      // "unnamed checkboxes" the moment GuestCheckoutForm became one. They are
      // aria-hidden and unfocusable — invisible to AT, and correctly ignored
      // by axe — so reporting them here was the script crying wolf.
      .filter((e) => e.getAttribute('aria-hidden') !== 'true' && e.tabIndex !== -1)
      .map((e) => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''} :: ${nameOf(e)}`);

    const images = [...document.querySelectorAll('img')].map((i) => ({
      src: (i.currentSrc || i.src || '').split('/').pop().slice(0, 60),
      alt: i.getAttribute('alt'),
      hidden: i.getAttribute('aria-hidden'),
      w: i.naturalWidth,
    }));

    // Anything animated that a reduced-motion user would still see.
    const animated = [...document.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e);
      return (s.animationName && s.animationName !== 'none') ||
        (s.transitionDuration && parseFloat(s.transitionDuration) > 0.05);
    }).length;

    return { violations: trim(r.violations), controls, images, animated };
  }, TAGS);
  console.log(`\n--- ${label} ---`);
  for (const v of res.violations) console.log(`  ${v.impact}  ${v.id} x${v.count}`);
  if (!res.violations.length) console.log('  (no axe violations)');
  const unnamed = res.controls.filter((c) => /NO ACCESSIBLE NAME|PLACEHOLDER-ONLY/.test(c));
  for (const u of unnamed) console.log(`  NAME  ${u}`);
  return { label, ...res };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox'],
  defaultViewport: { width: 1280, height: 900 },
});
const results = [];
const page = await browser.newPage();
page.on('dialog', (d) => d.dismiss());

// ---- 1. Ticket checkout -----------------------------------------------------
await page.goto(`${BASE}/showing/${SHOWING_ID}`, { waitUntil: 'networkidle2' });
await sleep(2000);
// The page renders a bare "Loading..." until the showing row arrives, and a
// scan that lands there reports `page-has-heading-one` against a state no
// patron sits in. Wait for the real page.
await page.waitForFunction(() => !!document.querySelector('h1'), { timeout: 15000 })
  .catch(() => console.log('  (warning: no <h1> appeared — scanning the loading state)'));
results.push(await scan(page, 'showing page (first paint)'));
// Add a ticket. The stepper is icon-only, so there is no text to match on —
// which is itself the finding; take the last button in the ticket card.
await page.evaluate(() => {
  const card = [...document.querySelectorAll('div')].find((d) => /^Tickets$/m.test(d.innerText || '') && d.querySelectorAll('button').length === 2);
  const btns = card ? [...card.querySelectorAll('button')] : [];
  if (btns.length) btns[btns.length - 1].click();
});
await sleep(1500);
results.push(await scan(page, 'showing page — checkout open'));
// Submit empty so the validation errors render, and look at how they are wired.
await clickText(page, /^Pay \$|Reserve /i, 'button');
await sleep(1200);
results.push(await scan(page, 'showing page — checkout with errors'));

// ---- 2. Film pass -----------------------------------------------------------
await page.goto(`${BASE}/film-passes`, { waitUntil: 'networkidle2' });
await sleep(2000);
await clickText(page, /Buy|Purchase|Get (this|a) pass/i, 'button');
await sleep(1500);
results.push(await scan(page, 'film pass — purchase open'));

// ---- 3. Donate --------------------------------------------------------------
await page.goto(`${BASE}/donate`, { waitUntil: 'networkidle2' });
await sleep(2000);
await clickText(page, /^\$\d/, 'button');
await sleep(800);
await clickText(page, /Continue|Donate|Give/i, 'button');
await sleep(1500);
results.push(await scan(page, 'donate — form open'));

// ---- 4. Calendar drawer -----------------------------------------------------
await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle2' });
await sleep(2500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('li button')].find((e) => e.offsetParent !== null);
  if (b) b.click();
});
await sleep(1200);
results.push(await scan(page, 'calendar — detail drawer open'));

// ---- 5. Mobile nav drawer ---------------------------------------------------
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
await sleep(2000);
await page.evaluate(() => {
  const b = document.querySelector('header button');
  if (b) b.click();
});
await sleep(900);
results.push(await scan(page, 'mobile nav drawer open (390px)'));

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}`);
await browser.close();
