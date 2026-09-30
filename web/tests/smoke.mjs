#!/usr/bin/env node
/* Browser smoke test. Serves web/ with python3 -m http.server, drives headless Chrome over the
   DevTools protocol (Node's built-in WebSocket; no packages), checks every page at 1280 and
   390 px, exercises the demo chart and the embed height reporter, and saves screenshots.
   Usage: node web/tests/smoke.mjs [--screens <dir>]   Stops the server and browser on exit. */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const si = process.argv.indexOf('--screens');
const SCREENS = si > 0 ? path.resolve(process.argv[si + 1]) : path.join(WEB, '_screens');
const PORT = 8765 + Math.floor(Math.random() * 200);
const DBG = 9322 + Math.floor(Math.random() * 200);
const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];
const PAGES = ['index.html', 'hiring-and-departures.html', 'who-is-leaving.html', 'components-compared.html', 'workforce-lookup.html', 'reading-the-data.html'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); }

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const chromePath = CHROMES.find(existsSync);
if (!chromePath) { console.error('no Chrome found'); server.kill(); process.exit(2); }
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + mkdtempSync(path.join(tmpdir(), 'opm-chrome-')),
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
function cleanup() { try { chrome.kill(); } catch {} try { server.kill(); } catch {} }
process.on('exit', cleanup);

async function getJson(url) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(250); }
  throw new Error('no response from ' + url);
}

let ws, nextId = 0; const waiting = new Map(); const events = [];
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiting.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr + ' ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function waitFor(expr, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await evaluate(expr)) return true; } catch {} await sleep(100); }
  return false;
}
async function viewport(width) { await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); }
async function go(url) { events.length = 0; await send('Page.navigate', { url }); await sleep(300); }
async function shot(file) {
  const m = await send('Page.getLayoutMetrics');
  const w = Math.ceil(m.cssContentSize.width), h = Math.ceil(m.cssContentSize.height);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
const errorsNow = () => events.filter(e => e.kind === 'error').map(e => e.text);

try {
  await getJson(`http://127.0.0.1:${PORT}/copy.json`);
  const targets = await getJson(`http://127.0.0.1:${DBG}/json/list`);
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') events.push({ kind: 'error', text: d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || '') });
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning' || d.params.type === 'warn')) events.push({ kind: 'error', text: 'console.' + d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' ') });
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(d.params.entry.url || '')) events.push({ kind: 'error', text: 'log: ' + d.params.entry.text + ' ' + (d.params.entry.url || '') });
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  if (!existsSync(SCREENS)) mkdirSync(SCREENS, { recursive: true });
  const base = `http://127.0.0.1:${PORT}/`;

  for (const width of [1280, 390]) {
    await viewport(width);
    for (const p of PAGES) {
      await go(base + p);
      const isDemo = p === 'index.html';
      const ready = await waitFor(isDemo ? '!!(window.OPM && OPM.demo && document.querySelector("#site-header .opm-nav__link"))' : '!!document.querySelector("#site-header .opm-nav__link")');
      const info = await evaluate(`({
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        title: document.title, h1: document.querySelector('h1').textContent,
        navLinks: document.querySelectorAll('#site-header .opm-nav__link').length,
        current: [...document.querySelectorAll('#site-header .opm-nav__link[aria-current="page"]')].map(a => a.getAttribute('href')),
        footer: document.querySelector('.opm-footer').textContent,
        wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).map(e => e.tagName + '.' + e.className).slice(0, 5)
      })`);
      const tag = `${p} @${width}`;
      check(`${tag}: shell rendered`, ready && info.navLinks === 6 && info.h1 && info.title.includes(info.h1), `h1="${info.h1}" title="${info.title}" errors: ${errorsNow().join(" | ")}`);
      check(`${tag}: current page marked`, info.current.length === 1 && info.current[0] === p, info.current.join(','));
      check(`${tag}: no horizontal scroll`, info.sw <= info.iw && info.wide.length === 0, `scrollWidth ${info.sw} vs ${info.iw}; overflowing: ${info.wide.join(' ') || 'none'}`);
      check(`${tag}: footer shows build stamp`, /Build \d{8}-\d{6}/.test(info.footer), info.footer);
      if (isDemo) {
        const d = await evaluate(`({
          points: OPM.demo.frame.chart.data.labels.length, first: OPM.demo.frame.chart.data.labels[0],
          last: OPM.demo.frame.chart.data.labels.at(-1),
          badge: !document.querySelector('.opm-note--fixture').hidden,
          legend: document.querySelectorAll('.opm-key__item').length,
          presets: document.querySelectorAll('.opm-field--presets').length,
          grainOn: document.querySelector('.opm-field--grain [aria-checked="true"]').dataset.value,
          method: document.querySelector('.opm-field--rate select').value
        })`);
        check(`${tag}: demo defaults (month grain, full range, trailing 12 months)`, d.points === 178 && d.first === 'Oct 2011' && d.last === 'Jul 2026' && d.grainOn === 'month' && d.method === 'a', JSON.stringify(d));
        check(`${tag}: FIXTURE badge visible, 2 legend items, no preset row`, d.badge && d.legend === 2 && d.presets === 0);
        await shot(path.join(SCREENS, `workforce-size-${width}.png`));
      }
      if (p === 'who-is-leaving.html') await shot(path.join(SCREENS, `stub-who-is-leaving-${width}.png`));
      const errs = errorsNow();
      check(`${tag}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
    }
  }

  // interactions on the demo, at 1280
  await viewport(1280);
  await go(base + 'index.html');
  await waitFor('!!(window.OPM && OPM.demo)');
  const fy = await evaluate(`(() => { document.querySelector('.opm-field--grain [data-value="fy"]').click();
    const c = OPM.demo.frame.chart; return { n: c.data.labels.length, first: c.data.labels[0], last: c.data.labels.at(-1) }; })()`);
  check('grain -> fiscal year: 15 rows FY2012..FY2026', fy.n === 15 && fy.first === 'FY2012' && fy.last === 'FY2026', JSON.stringify(fy));
  const fq = await evaluate(`(() => { const b = document.querySelector('.opm-field--grain [data-value="fy"]');
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return OPM.demo.frame.chart.data.labels.length; })()`);
  check('arrow key -> fiscal quarter: 60 rows', fq === 60, String(fq));
  const rng = await evaluate(`(() => { const s = document.querySelectorAll('.opm-range select');
    s[0].value = '2020-01'; s[0].dispatchEvent(new Event('change')); s[1].value = '2019-02'; s[1].dispatchEvent(new Event('change'));
    return { a: s[0].value, b: s[1].value, labels: OPM.demo.frame.chart.data.labels }; })()`);
  check('reversed range is swapped; quarter rows overlapping it are shown', rng.a === '2019-02' && rng.b === '2020-01' && rng.labels.join() === 'FY2019 Q2,FY2019 Q3,FY2019 Q4,FY2020 Q1,FY2020 Q2', JSON.stringify(rng));
  const mb = await evaluate(`(() => { const s = document.querySelector('.opm-field--rate select'); s.value = 'b'; s.dispatchEvent(new Event('change'));
    const m = document.querySelector('.opm-chart__msg'); return { msg: m.hidden ? '' : m.textContent, allNull: OPM.demo.frame.chart.data.datasets.every(d => d.data.every(v => v === null)) }; })()`);
  check('method B at quarter grain: no values, message shown', mb.allNull && mb.msg.length > 0, JSON.stringify(mb));
  const ratio = await evaluate(`fetch(OPM.shell.asset('data-fixture/FIXTURE_rates_demo.json')).then(r => r.json()).then(f => {
    document.querySelector('.opm-field--grain [data-value="fy"]').click();
    const row = OPM.data.fromCube(f).find(r => r.period === 'FY2020');
    const i = OPM.demo.frame.chart.data.labels.indexOf('FY2020');
    return { shown: OPM.demo.frame.chart.data.datasets[0].data[i], expect: row.attrition_b_num / row.rate_b_den }; })`);
  check('plotted rate = cube numerator / cube denominator', ratio.shown === ratio.expect, JSON.stringify(ratio));
  const leg = await evaluate(`(() => { const b = document.querySelectorAll('.opm-key__item')[1]; b.click();
    return { pressed: b.getAttribute('aria-pressed'), visible: OPM.demo.frame.chart.isDatasetVisible(1) }; })()`);
  check('legend toggles a series', leg.pressed === 'false' && leg.visible === false, JSON.stringify(leg));
  const svg = await evaluate(`(() => { const c = OPM.demo.frame.chart; const s = OPM.svgExport.buildSvg(OPM.svgExport.fromChart(c, { title: 'x', note: 'FIXTURE' }));
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    return { len: s.length, parseError: !!doc.querySelector('parsererror'), paths: doc.querySelectorAll('path').length, legend: doc.querySelectorAll('.opm-svg-key text').length }; })()`);
  check('SVG export parses as SVG, hidden series left out', !svg.parseError && svg.paths >= 1 && svg.legend === 1, JSON.stringify(svg));
  const dl = await evaluate(`(() => { let name = null; const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { name = this.download; }; document.querySelector('.opm-chart .opm-mini-btn').click();
    HTMLAnchorElement.prototype.click = orig; return name; })()`);
  check('Download SVG button produces a file name marked FIXTURE', dl === 'opm-demo-rates-fy-FIXTURE.svg', String(dl));
  check('interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // Framer height reporter, framed
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(base + 'tests/embed-harness.html');
    await waitFor('window.__heights.length > 0', 8000);
    await sleep(800);
    const hr = await evaluate(`(() => { const f = document.getElementById('f'); const inner = f.contentDocument.getElementById('page');
      return { msgs: window.__heights.length, last: window.__heights.at(-1), content: Math.ceil(inner.getBoundingClientRect().bottom), frame: f.getBoundingClientRect().height }; })()`);
    check(`height reporter @${width}: parent receives opm:height matching the content`, hr.msgs > 0 && Math.abs(hr.last.height - hr.content) <= 1 && hr.last.page === 'workforce-size' && Math.abs(hr.frame - hr.content) <= 1, JSON.stringify(hr));
  }
  await viewport(1280);
  await go(base + 'index.html');
  await waitFor('!!(window.OPM && OPM.shell.reporter)');
  check('height reporter unframed: posts nothing', (await evaluate('OPM.shell.reporter.isFramed()')) === false);
} catch (e) {
  check('smoke run completed', false, e.stack || String(e));
} finally {
  try { ws && ws.close(); } catch {}
  cleanup();
}

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + r.detail)); }
console.log(`\n${results.length - fail} of ${results.length} smoke checks pass. Screenshots: ${SCREENS}`);
process.exit(fail ? 1 : 0);
