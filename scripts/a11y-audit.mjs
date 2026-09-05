/**
 * Automated WCAG 2.2 AA pass with axe-core over every route.
 *
 * Not wired into `npm test`: it needs a running dev server and a real Chrome,
 * neither of which CI has. Run it by hand:
 *
 *   npm run dev -- --mode staging          # in one shell
 *   node scripts/a11y-audit.mjs            # in another
 *   node scripts/a11y-audit.mjs --admin    # also the staff routes (needs login)
 *
 * axe-core and puppeteer are deliberately NOT dependencies — a headless
 * Chromium download in every install, for a check nothing in CI runs, is not
 * worth it. Install them for the run and drop them again:
 *
 *   npm install --no-save axe-core puppeteer
 *
 * Writes a JSON blob so a before/after diff is possible; set A11Y_OUT to keep
 * a baseline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.A11Y_BASE || 'http://localhost:8080';
// puppeteer's own Chromium download is blocked by npm's script policy here, so
// point it at the Chrome that is already installed.
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const OUT = process.env.A11Y_OUT || 'a11y-results.json';

const PUBLIC_ROUTES = [
  '/', '/calendar', '/film-passes', '/donate', '/about', '/history',
  '/press', '/silent-film-festival', '/rentals', '/rental-request',
  '/sponsors', '/volunteer', '/accessibility', '/privacy', '/terms',
  '/backstage', '/auth', '/this-route-does-not-exist',
  // Added after the first audit: the concessions menu got its own page, the
  // Backstage enquiry got its own form, and a film pass got a detail route.
  '/concessions', '/backstage-enquiry',
];
// /admin/pos and /admin/scanner are redirects to /staff/* now.
const ADMIN_ROUTES = ['/admin', '/staff', '/staff/pos', '/staff/scanner', '/admin/audit-log'];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const routes = process.argv.includes('--admin')
  ? [...PUBLIC_ROUTES, ...ADMIN_ROUTES]
  : PUBLIC_ROUTES;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox'],
  defaultViewport: { width: 1280, height: 900 },
});

const results = [];
for (const route of routes) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 });
    // Route chunks can resolve after networkidle; give the Suspense fallback a
    // beat to swap for the real page, or every route audits as "Loading...".
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(AXE);
    const res = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations', 'incomplete'],
      });
      const trim = (arr) => arr.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodes.length,
        nodes: v.nodes.slice(0, 6).map((n) => ({
          target: n.target.join(' '),
          html: (n.html || '').slice(0, 200),
          summary: (n.failureSummary || '').slice(0, 300),
        })),
      }));
      return {
        title: document.title,
        h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 80)),
        headingOrder: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName),
        landmarks: {
          main: document.querySelectorAll('main').length,
          nav: document.querySelectorAll('nav').length,
          header: document.querySelectorAll('header').length,
          footer: document.querySelectorAll('footer').length,
        },
        violations: trim(r.violations),
        incomplete: trim(r.incomplete),
      };
    }, TAGS);
    results.push({ route, ...res, pageErrors });
    const bad = res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    console.log(
      `${route.padEnd(30)} ${String(res.violations.length).padStart(3)} violations ` +
      `(${bad.length} critical/serious), ${res.incomplete.length} incomplete`,
    );
    for (const v of res.violations) console.log(`    ${v.impact}  ${v.id} x${v.count}`);
  } catch (err) {
    console.log(`${route.padEnd(30)} ERROR ${err.message}`);
    results.push({ route, error: err.message });
  }
  await page.close();
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}`);

const tally = {};
for (const r of results) for (const v of r.violations || []) {
  tally[v.id] = tally[v.id] || { impact: v.impact, pages: 0, nodes: 0 };
  tally[v.id].pages++;
  tally[v.id].nodes += v.count;
}
console.log('\nBy rule:');
for (const [id, t] of Object.entries(tally).sort((a, b) => b[1].nodes - a[1].nodes)) {
  console.log(`  ${String(t.impact).padEnd(9)} ${id.padEnd(34)} ${t.nodes} nodes on ${t.pages} pages`);
}

await browser.close();
