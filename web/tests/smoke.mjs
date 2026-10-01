#!/usr/bin/env node
/* Browser smoke test. Drives headless Chrome over the DevTools protocol (Node's built-in
   WebSocket; no packages) and saves screenshots.
   Two servers (python3 -m http.server):
   - SITE: a copy of web/ assembled in a temp directory, without web/data/ if it exists, with the
     cube files from --data-dir (default warehouse/cubes/) placed at data/.
   - BARE: a second temp copy of web/ without data/, to check the "data not available" state.
   Neither run depends on whether web/data/ exists (the gate's promoted_matches_staged owns that).
   With --base-path OPM-Project the copies are served under /OPM-Project/, as GitHub Pages serves the site.
   Usage: node web/tests/smoke.mjs [--data-dir <dir>] [--lookup-dir <dir>] [--screens <dir>] [--base-path <name>] */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, cpSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : dflt; };
const SCREENS = arg('--screens', path.join(WEB, '_screens'));
const DATA_DIR = arg('--data-dir', path.join(REPO, 'warehouse', 'cubes'));
const CUBE_FILES = ['doj_core.json', 'doj_core.meta.json'];
const audit = createRequire(import.meta.url)('../tools/copy-audit.js');
const DATA_PAGES = { 'index.html': 'workforce-size', 'hiring-and-departures.html': 'hiring-and-departures', 'who-is-leaving.html': 'who-is-leaving', 'components-compared.html': 'components-compared', 'workforce-lookup.html': 'workforce-lookup' };
const runtimeUsed = { 'workforce-size': new Set(), 'hiring-and-departures': new Set(), 'who-is-leaving': new Set(), 'components-compared': new Set(), 'reading-the-data': new Set(), 'workforce-lookup': new Set() };
const LOOKUP_DIR = arg('--lookup-dir', path.join(REPO, 'warehouse', 'lookup')); // served as data/lookup/ (not yet promoted into web/data)
const SIGNED_PAGES = new Set([...Object.keys(DATA_PAGES), 'reading-the-data.html']); // pages whose strings are all signed
const rnd = n => Math.floor(Math.random() * n);
const PORT = 8765 + rnd(200), PORT_BARE = 9065 + rnd(200), DBG = 9322 + rnd(200);
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const PAGES = ['index.html', 'hiring-and-departures.html', 'who-is-leaving.html', 'components-compared.html', 'workforce-lookup.html', 'reading-the-data.html'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const infos = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); }

// ---- expected values, computed here in Node straight from the cube file (independent of the page code)
for (const f of CUBE_FILES) if (!existsSync(path.join(DATA_DIR, f))) { console.error('missing ' + path.join(DATA_DIR, f)); process.exit(2); }
const cube = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_core.json'), 'utf8'));
const meta = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_core.meta.json'), 'utf8'));
const col = n => cube.columns.indexOf(n);
const rowsOf = (e, g) => cube.rows.filter(r => r[col('entity')] === e && r[col('grain')] === g).sort((a, b) => a[col('period_first_month')] < b[col('period_first_month')] ? -1 : 1);
const hc = r => r[col('headcount')];
const NUM = new Intl.NumberFormat('en-US');
const signed = v => (v > 0 ? '+' : '') + NUM.format(v);
const pctText = v => (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
function expectFor(e) {
  const m = rowsOf(e, 'month'), fy = rowsOf(e, 'fy');
  const last = m.at(-1), yearAgo = m.at(-13);
  return { headcount: NUM.format(hc(last)), change12: signed(hc(last) - hc(yearAgo)), pct12: ((hc(last) - hc(yearAgo)) / hc(yearAgo) * 100).toFixed(1),
    rangeFull: signed(hc(fy.at(-1)) - hc(fy[0])), pctFull: pctText((hc(fy.at(-1)) - hc(fy[0])) / hc(fy[0])),
    rangeFullMonth: signed(hc(last) - hc(m[0])), pctFullMonth: pctText((hc(last) - hc(m[0])) / hc(m[0])), rangeFrom2013: signed(hc(fy.at(-1)) - hc(fy[0])), pctFrom2013: ((hc(fy.at(-1)) - hc(fy[0])) / hc(fy[0]) * 100).toFixed(1), fyCount: fy.length, monthCount: m.length };
}
const EXP = { DOJ: expectFor('DOJ'), DJ02: expectFor('DJ02') };
const rate = v => (v * 100).toFixed(1) + '%';
/* Hiring and departures tiles: latest 12 month rows and the 12 before; method A rate of the latest month and a year earlier. */
function expectHD(e) {
  const m = rowsOf(e, 'month'), sum = (l, n) => l.reduce((a, r) => a + r[col(n)], 0);
  const l12 = m.slice(-12), p12 = m.slice(-24, -12), last = m.at(-1), ago = m.at(-13);
  const rt = r => r[col('attrition_a_num')] / r[col('rate_a_den')];
  return { hires: NUM.format(sum(l12, 'hires')), hiresPrior: 'Year before: ' + NUM.format(sum(p12, 'hires')),
    departures: NUM.format(sum(l12, 'departures')), departuresPrior: 'Year before: ' + NUM.format(sum(p12, 'departures')),
    rate: rate(rt(last)), ratePrior: 'Year before: ' + rate(rt(ago)), smallBase: last[col('rate_a_small_base')] === true };
}
const EXP_HD = { DOJ: expectHD('DOJ'), DJ10: expectHD('DJ10'), DJ14: expectHD('DJ14') };
const fy25 = rowsOf('DOJ', 'fy').find(r => r[col('period')] === 'FY2025');
const EXP_RATE_FY25 = Object.fromEntries(['a', 'b', 'c'].map(m => [m, fy25[col('attrition_' + m + '_num')] / fy25[col('rate_' + m + '_den')]]));
// FY2026 is partial, so the three methods differ: A trailing 12 months, B year to date, C annualized
const fy26 = rowsOf('DOJ', 'fy').find(r => r[col('period')] === 'FY2026');
const EXP_RATE_FY26 = Object.fromEntries(['a', 'b', 'c'].map(m => [m, fy26[col('attrition_' + m + '_num')] / fy26[col('rate_' + m + '_den')]]));
/* Components compared: expected table cells straight from doj_core. */
function expectCC(e, g, p, m) {
  const list = rowsOf(e, g), i = list.findIndex(r => r[col('period')] === p), r = list[i], prev = list[i - 1];
  const chg = r[col('headcount_change')];
  return { employees: NUM.format(r[col('headcount')]), change: chg === null ? '\u2013' : signed(chg) + (prev ? ' (' + pctText(chg / prev[col('headcount')]) + ')' : ''),
    hires: NUM.format(r[col('hires')]), departures: NUM.format(r[col('departures')]),
    rate: r[col('attrition_' + m + '_num')] === null ? '\u2013' : rate1(r[col('attrition_' + m + '_num')] / r[col('rate_' + m + '_den')]),
    quit: r[col('quit_' + m + '_num')] === null ? '\u2013' : rate1(r[col('quit_' + m + '_num')] / r[col('rate_' + m + '_den')]),
    retirement: r[col('retirement_' + m + '_num')] === null ? '\u2013' : rate1(r[col('retirement_' + m + '_num')] / r[col('rate_' + m + '_den')]),
    rawRate: r[col('attrition_' + m + '_num')] / r[col('rate_' + m + '_den')] };
}

/* Workforce Look-Up: expected values from the staged Parquet files (read here with the vendored reader), the cubes and the meta. */
const PQ = new Function(readFileSync(path.join(WEB, 'assets', 'vendor', 'hyparquet-bundle.js'), 'utf8') + ';return OPMParquet;')();
const LMETA = JSON.parse(readFileSync(path.join(LOOKUP_DIR, 'lookup.meta.json'), 'utf8'));
const SEP_FIELDS = readFileSync(path.join(REPO, 'pipeline', 'crosswalks', 'lookup_fields.csv'), 'utf8').trim().split('\n').slice(1).map(l => l.split(',')).filter(c => c[0] === 'separations').map(c => c[2]);
async function readLookup(name) { const b = readFileSync(path.join(LOOKUP_DIR, name + '.parquet')); return PQ.parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), compressors: PQ.compressors }); }

/* Who is leaving: expected values straight from the staged doj_leaving rows and doj_core. */
const LVC = (() => {
  const dir = path.join(DATA_DIR, 'doj_leaving');
  if (existsSync(dir)) { const f = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(path.join(dir, n), 'utf8'))); return { columns: f[0].columns, rows: f.flatMap(x => x.rows) }; }
  return JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving.json'), 'utf8'));
})();
const lc = n => LVC.columns.indexOf(n);
const lrows = (e, g, p, d) => LVC.rows.filter(r => r[lc('entity')] === e && r[lc('grain')] === g && r[lc('period')] === p && r[lc('dimension')] === d).sort((a, b) => a[lc('value_order')] - b[lc('value_order')]);
const rate1 = v => (v * 100).toFixed(1) + '%';
function expectWL(e, g, p) {
  const los = lrows(e, g, p, 'los'), prevP = g === 'fy' ? 'FY' + (+p.slice(2) - 1) : (() => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y - 1, m - 1, 1)); return d.toISOString().slice(0, 7); })();
  const deps = los.reduce((a, r) => a + r[lc('departures')], 0), prior = lrows(e, g, prevP, 'los').reduce((a, r) => a + r[lc('departures')], 0);
  let core;
  if (g === 'fy') core = [rowsOf(e, 'fy').find(r => r[col('period')] === p)];
  else { const m = rowsOf(e, 'month'); const i = m.findIndex(r => r[col('period')] === p); core = m.slice(i - 11, i + 1); }
  const s = n => core.reduce((a, r) => a + r[col(n)], 0);
  const lost = s('years_of_service_lost'), known = s('yos_known'), cd = s('departures');
  const bars = d => lrows(e, g, p, d).filter(r => !r[lc('is_unknown')]).map(r => r[lc('rate_not_applicable')] ? 'not applicable: no employees in this group' :
    r[lc('rate_num')] === null ? '' : rate1(r[lc('rate_num')] / r[lc('rate_den')]) + ' \u00b7 ' + NUM.format(r[lc('departures')]) + ' left');
  return { departures: NUM.format(deps), prior: 'Year before: ' + NUM.format(prior), lost: NUM.format(Math.round(lost)), avg: (lost / known).toFixed(1),
    coverage: known / cd, unknownLos: lrows(e, g, p, 'los').find(r => r[lc('is_unknown')])[lc('departures')], bars: { los: bars('los'), occupation: bars('occupation') } };
}

// ---- served trees and processes
const skipCopy = src => src.includes(path.sep + '_screens') || src === path.join(WEB, 'data') || src.startsWith(path.join(WEB, 'data') + path.sep);
const BASE_PATH = (() => { const i = process.argv.indexOf('--base-path'); return i > 0 ? process.argv[i + 1].replace(/^\/+|\/+$/g, '') : ''; })();
const PREFIX = BASE_PATH ? '/' + BASE_PATH + '/' : '/';
const siteRoot = path.join(mkdtempSync(path.join(tmpdir(), 'opm-site-')), 'root');
const site = BASE_PATH ? path.join(siteRoot, BASE_PATH) : siteRoot;
mkdirSync(siteRoot, { recursive: true });
cpSync(WEB, site, { recursive: true, filter: src => !skipCopy(src) });
const bareRoot = path.join(mkdtempSync(path.join(tmpdir(), 'opm-bare-')), 'root');
const bareSite = BASE_PATH ? path.join(bareRoot, BASE_PATH) : bareRoot;
mkdirSync(bareRoot, { recursive: true });
cpSync(WEB, bareSite, { recursive: true, filter: src => !skipCopy(src) });
mkdirSync(path.join(site, 'data'));
for (const f of CUBE_FILES) cpSync(path.join(DATA_DIR, f), path.join(site, 'data', f));
/* the Look-Up files: data/lookup/<name>.parquet and data/lookup.meta.json (paths in the meta are relative to data/) */
mkdirSync(path.join(site, 'data', 'lookup'));
for (const f of readdirSync(LOOKUP_DIR)) cpSync(path.join(LOOKUP_DIR, f), f === 'lookup.meta.json' ? path.join(site, 'data', 'lookup.meta.json') : path.join(site, 'data', 'lookup', f));
/* the job series cubes (per entity, plus meta), served as they are staged */
for (const cube of ['doj_core_series', 'doj_leaving_series']) {
  if (existsSync(path.join(DATA_DIR, cube + '.meta.json'))) {
    cpSync(path.join(DATA_DIR, cube), path.join(site, 'data', cube), { recursive: true });
    cpSync(path.join(DATA_DIR, cube + '.meta.json'), path.join(site, 'data', cube + '.meta.json'));
  }
}
/* doj_leaving: one file per entity plus a shared meta with a files map (spec section 1). If DATA_DIR has
   the per-entity directory, it is served as is. Until the data-engineer delivers it, the single staged
   doj_leaving.json is split here, in the temp tree only, into the same layout. */
let LEAVING_LAYOUT;
{
  const lmeta = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving.meta.json'), 'utf8'));
  mkdirSync(path.join(site, 'data', 'doj_leaving'));
  if (existsSync(path.join(DATA_DIR, 'doj_leaving')) && lmeta.files) {
    cpSync(path.join(DATA_DIR, 'doj_leaving'), path.join(site, 'data', 'doj_leaving'), { recursive: true });
    cpSync(path.join(DATA_DIR, 'doj_leaving.meta.json'), path.join(site, 'data', 'doj_leaving.meta.json'));
    LEAVING_LAYOUT = 'per-entity files from ' + path.join(DATA_DIR, 'doj_leaving');
  } else {
    const whole = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving.json'), 'utf8'));
    const ei = whole.columns.indexOf('entity');
    lmeta.files = {};
    for (const e of lmeta.entities) {
      const rows = whole.rows.filter(r => r[ei] === e);
      const rel = 'doj_leaving/' + e + '.json';
      writeFileSync(path.join(site, 'data', rel), JSON.stringify({ cube: 'doj_leaving', entity: e, columns: whole.columns, rows, periods: whole.periods }));
      lmeta.files[e] = { path: rel, rows: rows.length };
    }
    writeFileSync(path.join(site, 'data', 'doj_leaving.meta.json'), JSON.stringify(lmeta));
    LEAVING_LAYOUT = 'split from the single staged doj_leaving.json (per-entity files not delivered yet)';
  }
}
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', siteRoot], { stdio: 'ignore' });
const bare = spawn('python3', ['-m', 'http.server', String(PORT_BARE), '--bind', '127.0.0.1', '--directory', bareRoot], { stdio: 'ignore' });
const chromePath = CHROMES.find(existsSync);
if (!chromePath) { console.error('no Chrome found'); server.kill(); bare.kill(); process.exit(2); }
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + mkdtempSync(path.join(tmpdir(), 'opm-chrome-')),
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
function cleanup() { for (const p of [chrome, server, bare]) { try { p.kill(); } catch {} } }
process.on('exit', cleanup);

async function getJson(url) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(250); }
  throw new Error('no response from ' + url);
}
let ws, nextId = 0; const waiting = new Map(); const events = [];
function send(method, params = {}) { const id = ++nextId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => waiting.set(id, { res, rej })); }
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr.slice(0, 200) + ' ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
async function waitFor(expr, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await evaluate(expr)) return true; } catch {} await sleep(100); } return false; }
async function viewport(width) { await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); }
async function go(url) { events.length = 0; await send('Page.navigate', { url }); await sleep(300); }
async function shot(file) {
  await sleep(250);
  const m = await send('Page.getLayoutMetrics');
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(m.cssContentSize.width), height: Math.ceil(m.cssContentSize.height), scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
}
const errorsNow = (allow) => events.filter(e => !(allow && allow.test(e.text))).map(e => e.text);
/* The page must never scroll sideways. Content inside a scroll container that itself fits (the
   Components compared table) is clipped there, so it does not count. */
const noScroll = `(() => {
  const clipped = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX;
    if ((o === 'auto' || o === 'scroll' || o === 'hidden') && a.getBoundingClientRect().right <= window.innerWidth + 0.5) return true; } return false; };
  return { sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !clipped(e)).map(e => e.tagName + '.' + e.className).slice(0, 5) }; })()`;
const READY = '!!(window.OPM && OPM.page && (OPM.page.unavailable || OPM.page.loaded || ((OPM.page.frames && (OPM.page.ready !== false)) && (document.body.dataset.page !== "who-is-leaving" || OPM.page.ready))))';
const setGrain = g => evaluate(`document.querySelector('.opm-field--grain [data-value="${g}"]').click()`);
const setEntity = e => evaluate(`(() => { const s = document.querySelector('.opm-field--component select'); s.value = '${e}'; s.dispatchEvent(new Event('change')); })()`);
const tiles = () => evaluate(`[...document.querySelectorAll('.opm-tile')].map(t => ({ name: t.querySelector('.opm-tile__name').textContent, value: t.querySelector('.opm-tile__value').textContent,
  subs: [...t.querySelectorAll('.opm-tile__sub')].map(s => s.textContent), badge: !!t.querySelector('.opm-tile__prov') }))`);
const labels = id => evaluate(`OPM.page.frames.${id}.chart.data.labels`);
const notes = id => evaluate(`[...OPM.page.frames.${id}.notes.querySelectorAll('p')].map(p => p.textContent + (p.querySelector('a') ? ' ->' + p.querySelector('a').getAttribute('href') : ''))`);

try {
  await getJson(`http://127.0.0.1:${PORT}${PREFIX}copy.json`);
  await getJson(`http://127.0.0.1:${PORT_BARE}${PREFIX}copy.json`);
  const page = (await getJson(`http://127.0.0.1:${DBG}/json/list`)).find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') events.push({ text: d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || '') });
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn'].includes(d.params.type)) events.push({ text: 'console.' + d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' ') });
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(d.params.entry.url || '')) events.push({ text: 'log: ' + d.params.entry.text + ' ' + (d.params.entry.url || '') });
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  if (!existsSync(SCREENS)) mkdirSync(SCREENS, { recursive: true });
  const base = `http://127.0.0.1:${PORT}${PREFIX}`, bareBase = `http://127.0.0.1:${PORT_BARE}${PREFIX}`;
  if (BASE_PATH) {
    infos.push('serving under the subpath ' + PREFIX + ' (as on GitHub Pages)');
    // nothing is served at the root: a root-relative URL would 404 and fail the console-error checks
    check('subpath: the site root has no page of its own', (await fetch(`http://127.0.0.1:${PORT}/index.html`)).status === 404);
  }

  // ---- every page, both widths
  for (const width of [1280, 390]) {
    await viewport(width);
    for (const p of PAGES) {
      await go(base + p);
      const ready = await waitFor(DATA_PAGES[p] ? READY : p === 'reading-the-data.html' ? '!!(window.OPM && OPM.page && OPM.page.ready)' : '!!document.querySelector(".opm-nav__link")');
      const info = await evaluate(`({ title: document.title, h1: document.querySelector('h1').textContent, navLinks: document.querySelectorAll('.opm-nav__link').length,
        current: [...document.querySelectorAll('.opm-nav__link[aria-current="page"]')].map(a => a.getAttribute('href')), footer: document.querySelector('.opm-footer').textContent,
        draft: !document.querySelector('.opm-brand__draft').hidden })`);
      const sc = await evaluate(noScroll);
      const tag = `${p} @${width}`;
      check(`${tag}: shell rendered`, ready && info.navLinks === 6 && info.h1 && info.title.includes(info.h1), JSON.stringify(info) + ' ' + errorsNow().join(' | '));
      check(`${tag}: current page marked`, info.current.length === 1 && info.current[0] === p, info.current.join(','));
      check(`${tag}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
      if (SIGNED_PAGES.has(p)) check(`${tag}: draft badge off (every string the page uses is signed)`, !info.draft);
      else check(`${tag}: draft badge shown (stub text is unsigned)`, info.draft);
      if (p === 'index.html') {
        check(`${tag}: footer carries the signed source line`, info.footer.includes('October 2011 to Jul 2026. DOJ counts include all components.') && /Build \d{8}-\d{6}/.test(info.footer), info.footer);
      } else {
        check(`${tag}: footer shows build stamp`, /Build \d{8}-\d{6}/.test(info.footer), info.footer);
      }
      const errs = errorsNow();
      check(`${tag}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
    }
  }

  // ---- Workforce size, default FY / DOJ
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(base + 'index.html'); await waitFor(READY);
    const st = await evaluate('({ grain: OPM.page.state.grain, entity: OPM.page.state.entity, on: document.querySelector(".opm-field--grain [aria-checked=true]").dataset.value, rate: !!document.querySelector(".opm-field--rate") })');
    check(`FY/DOJ @${width}: defaults fiscal year and DOJ; no rate selector`, st.grain === 'fy' && st.on === 'fy' && st.entity === 'DOJ' && !st.rate, JSON.stringify(st));
    const gc = await evaluate(`(() => { const f = document.querySelector('.opm-field--grain'); const g = f.querySelector('[role=radiogroup]'); const n = f.querySelector('.opm-field__note');
      return { label: f.querySelector('.opm-field__name').textContent, buttons: [...g.querySelectorAll('.opm-choice')].map(b => b.textContent + '=' + b.dataset.value),
        lefts: [...g.querySelectorAll('.opm-choice')].map(b => Math.round(b.getBoundingClientRect().left)), on: g.querySelector('[aria-checked=true]').textContent,
        note: n && n.textContent, described: g.getAttribute('aria-describedby') === (n && n.id), noteBelow: n && n.getBoundingClientRect().top >= g.getBoundingClientRect().bottom - 1,
        muted: n && getComputedStyle(n).color === getComputedStyle(document.documentElement).getPropertyValue('--color-muted').trim().replace(/^#(..)(..)(..)$/, (m, r, g2, b) => 'rgb(' + [r, g2, b].map(x => parseInt(x, 16)).join(', ') + ')') }; })()`);
    check(`FY/DOJ @${width}: grain control reads View: Yearly, Quarterly, Monthly (D-033), Yearly on, note under it`,
      gc.label === 'View' && gc.buttons.join() === 'Yearly=fy,Quarterly=quarter,Monthly=month' && gc.lefts[0] < gc.lefts[1] && gc.lefts[1] < gc.lefts[2] && gc.on === 'Yearly' &&
      gc.note === 'Years run October to September, the federal fiscal year.' && gc.described && gc.noteBelow && gc.muted, JSON.stringify(gc));
    const t = await tiles();
    check(`FY/DOJ @${width}: Employees tile = latest month, as of Jul 2026, provisional badge`, t[0].name === 'Employees' && t[0].value === EXP.DOJ.headcount && t[0].subs[0] === 'As of Jul 2026' && t[0].badge, JSON.stringify(t[0]));
    check(`FY/DOJ @${width}: 12-month change = Jul 2026 minus Jul 2025, with percent`, t[1].value === EXP.DOJ.change12 && t[1].subs[0].replace('+', '') === EXP.DOJ.pct12.replace('+', '') + '%', JSON.stringify(t[1]) + ' expect ' + EXP.DOJ.change12 + ' ' + EXP.DOJ.pct12);
    check(`FY/DOJ @${width}: range tile from the end of FY2012, percent over FY2012's headcount`, t[2].name === 'Change, FY2012 to FY2026 (partial)' && t[2].value === EXP.DOJ.rangeFull && t[2].subs.length === 2 && t[2].subs[0] === EXP.DOJ.pctFull && t[2].subs[1] === 'Measured from the end of FY2012.', JSON.stringify(t[2]) + ' expect ' + EXP.DOJ.rangeFull + ' ' + EXP.DOJ.pctFull);
    infos.push(`tiles @${width} Yearly/DOJ range: ${t[2].value} (${t[2].subs[0]})`);
    const l2 = await labels('headcount');
    check(`FY/DOJ @${width}: panel 2 has ${EXP.DOJ.fyCount} fiscal years, the last marked partial`, l2.length === EXP.DOJ.fyCount && l2[0] === 'FY2012' && l2.at(-1) === 'FY2026 (partial)', l2.slice(-2).join(','));
    const n2 = await notes('headcount');
    check(`FY/DOJ @${width}: panel 2 provisional and partial notes`, n2.some(x => x.startsWith('Provisional:')) && n2.includes('Partial: FY2026 so far runs through Jul 2026.'), n2.join(' | '));
    const br = await evaluate('OPM.page.frames.flow.chart.options.plugins.opmMarkers.flags.map((f, i) => f ? OPM.page.frames.flow.chart.data.labels[i] : null).filter(Boolean)');
    check(`FY/DOJ @${width}: panel 3 break markers on FY2025 and FY2026`, br.join() === 'FY2025,FY2026 (partial)', br.join());
    const n3 = await notes('flow');
    check(`FY/DOJ @${width}: panel 3 note and break link to the known-gaps section`, n3[0].startsWith('These are counted from different OPM files') && n3.some(x => x === 'Known gap; see Reading the data. ->reading-the-data.html#known-gaps'), n3.join(' | '));
    const rk = await evaluate('({ labels: OPM.page.frames.ranking.chart.data.labels, notes: [...OPM.page.frames.ranking.notes.querySelectorAll("p")].map(p => p.textContent), minis: document.querySelectorAll(".opm-multiple").length, lefts: [...new Set([...document.querySelectorAll(".opm-multiple")].map(e => Math.round(e.getBoundingClientRect().left)))].length })');
    check(`FY/DOJ @${width}: 4a ranks 11 current components, FBI first; Community Relations Service listed as ended`, rk.labels.length === 11 && rk.labels[0] === 'FBI' && !rk.labels.includes('Community Relations Service') && rk.notes.includes('Community Relations Service: last reported Apr 2026 (9 employees)'), JSON.stringify(rk));
    check(`FY/DOJ @${width}: 4b has 12 small multiples, ${width < 600 ? 'one column' : 'several columns'}`, rk.minis === 12 && (width < 600 ? rk.lefts === 1 : rk.lefts > 1), JSON.stringify({ minis: rk.minis, columns: rk.lefts }));
    const axes = await evaluate('OPM.page.minis.map(m => Math.round(m.chart.scales.y.max))');
    check(`FY/DOJ @${width}: 4b y-axes are independent`, new Set(axes).size > 6, axes.join(','));
    const sc = await evaluate(noScroll);
    check(`FY/DOJ @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
    await shot(path.join(SCREENS, `workforce-size-fy-doj-${width}.png`));

    // month / DOJ
    await setGrain('month');
    const lm = await labels('headcount');
    const brm = await evaluate('OPM.page.frames.flow.chart.options.plugins.opmMarkers.flags.map((f, i) => f ? OPM.page.frames.flow.chart.data.labels[i] : null).filter(Boolean)');
    const dash = await evaluate('(() => { const d = OPM.page.frames.headcount.chart.data.datasets[0]; return d._dashIn.filter(Boolean).length; })()');
    check(`month/DOJ @${width}: ${EXP.DOJ.monthCount} months, breaks on Sep and Oct 2025, last 3 dashed`, lm.length === EXP.DOJ.monthCount && lm[0] === 'Oct 2011' && brm.join() === 'Sep 2025,Oct 2025' && dash === 3, `${lm.length} ${brm.join()} dashed ${dash}`);
    const tm = await tiles();
    check(`month/DOJ @${width}: range tile measured from the end of Oct 2011, percent over Oct 2011's headcount`, tm[2].name === 'Change, Oct 2011 to Jul 2026' && tm[2].value === EXP.DOJ.rangeFullMonth && tm[2].subs[0] === EXP.DOJ.pctFullMonth && tm[2].subs[1] === 'Measured from the end of Oct 2011.', JSON.stringify(tm[2]) + ' expect ' + EXP.DOJ.rangeFullMonth + ' ' + EXP.DOJ.pctFullMonth);
    infos.push(`tiles @${width} Monthly/DOJ range: ${tm[2].value} (${tm[2].subs[0]})`);
    await shot(path.join(SCREENS, `workforce-size-month-doj-${width}.png`));

    // FY / FBI
    await setGrain('fy'); await setEntity('DJ02');
    const tf = await tiles();
    infos.push(`tiles @${width} Yearly/FBI range: ${tf[2].value} (${tf[2].subs[0]})`);
    check(`FY/FBI @${width}: tiles follow the component, range percent over FBI's FY2012 headcount`, tf[0].value === EXP.DJ02.headcount && tf[1].value === EXP.DJ02.change12 && tf[2].value === EXP.DJ02.rangeFull && tf[2].subs[0] === EXP.DJ02.pctFull, JSON.stringify(tf.map(x => x.value)) + ' expect ' + JSON.stringify(EXP.DJ02));
    const rkf = await evaluate('OPM.page.frames.ranking.chart.data.labels[0]');
    check(`FY/FBI @${width}: panel 4 ignores the component selector`, rkf === 'FBI' && (await evaluate('OPM.page.frames.ranking.chart.data.labels.length')) === 11);
    await shot(path.join(SCREENS, `workforce-size-fy-fbi-${width}.png`));
    const errs = errorsNow();
    check(`Workforce size @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }

  // ---- interactions at 1280
  await viewport(1280);
  await go(base + 'index.html'); await waitFor(READY);
  const wsT = await evaluate(`OPM.page.frames.headcount.chart.data.datasets.map(d => d.tension).concat(OPM.page.minis.map(m => m.chart.data.datasets[0].tension))`);
  check('Workforce size: every line, small multiples included, has tension 0', wsT.length === 13 && wsT.every(t => t === 0), wsT.join(','));
  const opts = await evaluate('[...document.querySelectorAll(".opm-field--component option")].map(o => o.textContent)');
  check('component selector: DOJ first, then 12 by display name, CRS with its end month', opts.length === 13 && opts[0] === 'Justice Department (all components)' && opts[1] === 'ATF' && opts.includes('Community Relations Service (last reported Apr 2026)') &&
    JSON.stringify(opts.slice(1).map(o => o.replace(' (last reported Apr 2026)', ''))) === JSON.stringify(opts.slice(1).map(o => o.replace(' (last reported Apr 2026)', '')).sort((a, b) => a.localeCompare(b, 'en'))), opts.join(' | '));
  await setEntity('DJ14'); await setGrain('month');
  const l14 = await labels('headcount');
  check('Community Relations Service stops at Apr 2026', l14.at(-1) === 'Apr 2026', l14.at(-1));
  await setGrain('fy');
  check('Community Relations Service FY2026 is partial', (await labels('headcount')).at(-1) === 'FY2026 (partial)');
  const t14 = await tiles();
  check('Community Relations Service: Employees 9 as of Apr 2026, not provisional', t14[0].value === '9' && t14[0].subs[0] === 'As of Apr 2026' && !t14[0].badge, JSON.stringify(t14[0]));
  await setEntity('DOJ');
  await evaluate(`(() => { const s = document.querySelectorAll('.opm-range select'); s[0].value = '2012-10'; s[0].dispatchEvent(new Event('change')); })()`);
  const t13 = await tiles();
  const exp13 = (() => { const fy = rowsOf('DOJ', 'fy'); const v = hc(fy.at(-1)) - hc(fy[0]); return { v: signed(v), p: (v > 0 ? '+' : '') + (v / hc(fy[0]) * 100).toFixed(1) + '%' }; })();
  check('range from FY2013: change with percent over FY2012 end headcount, no first-period note', t13[2].name === 'Change, FY2013 to FY2026 (partial)' && t13[2].value === exp13.v && t13[2].subs.length === 1 && t13[2].subs[0] === exp13.p, JSON.stringify(t13[2]) + ' expect ' + JSON.stringify(exp13));
  const quarterBreaks = await (async () => { await setGrain('quarter'); return evaluate('OPM.page.frames.flow.chart.options.plugins.opmMarkers.flags.map((f, i) => f ? OPM.page.frames.flow.chart.data.labels[i] : null).filter(Boolean)'); })();
  check('quarter grain: breaks on FY2025 Q4 and FY2026 Q1', quarterBreaks.join() === 'FY2025 Q4,FY2026 Q1', quarterBreaks.join());
  await setGrain('fy');
  const svgs = await evaluate(`(() => { const out = {}; for (const [k, f] of Object.entries(OPM.page.frames)) { const s = f.svg(); const d = new DOMParser().parseFromString(s, 'image/svg+xml');
      out[k] = { ok: !d.querySelector('parsererror'), rects: d.querySelectorAll('rect').length, paths: d.querySelectorAll('path').length, markers: d.querySelectorAll('.opm-svg-marker').length, labels: d.querySelectorAll('.opm-svg-label').length,
        dashed: d.querySelectorAll('path[stroke-dasharray]').length, partial: d.querySelectorAll('.opm-svg-partial').length, name: f.fileName() }; } return out; })()`);
  check('SVG export: headcount chart parses, with dashed provisional segment and partial marker', svgs.headcount.ok && svgs.headcount.dashed >= 1 && svgs.headcount.partial === 1 && svgs.headcount.name === 'opm-headcount-DOJ-fy.svg', JSON.stringify(svgs.headcount));
  check('SVG export: flow chart parses, with 2 break markers', svgs.flow.ok && svgs.flow.markers === 2 && svgs.flow.rects > 20, JSON.stringify(svgs.flow));
  check('SVG export: ranking parses, 11 bars with value labels', svgs.ranking.ok && svgs.ranking.labels === 11, JSON.stringify(svgs.ranking));
  const grid = await evaluate(`(() => { let svg = null, name = null; const orig = OPM.svgExport.download; OPM.svgExport.download = (s, n) => { svg = s; name = n; };
    document.querySelector('[data-export="components-trend"]').click(); OPM.svgExport.download = orig;
    const d = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { ok: !d.querySelector('parsererror'), cells: d.querySelectorAll('svg > svg').length, name }; })()`);
  check('SVG export: small multiples grid parses with 12 cells', grid.ok && grid.cells === 12 && grid.name === 'opm-components-trend-fy.svg', JSON.stringify(grid));
  const dl = await evaluate(`(() => { let n = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { n = this.download; };
    document.querySelector('[data-chart="change-vs-net-flow"] .opm-mini-btn').click(); HTMLAnchorElement.prototype.click = orig; return n; })()`);
  check('Download SVG button on panel 3 saves opm-change-vs-net-flow-DOJ-fy.svg', dl === 'opm-change-vs-net-flow-DOJ-fy.svg', String(dl));
  const leg = await evaluate(`(() => { const b = document.querySelectorAll('[data-chart="change-vs-net-flow"] .opm-key__item')[1]; b.click(); return { p: b.getAttribute('aria-pressed'), v: OPM.page.frames.flow.chart.isDatasetVisible(1) }; })()`);
  check('panel 3 legend toggles a series', leg.p === 'false' && leg.v === false, JSON.stringify(leg));
  const draft = await evaluate('OPM.shell.refreshDraft()');
  infos.push('unsigned keys used on Workforce size after the interactions: ' + (draft.join(', ') || 'none'));
  check('draft badge off after the interactions: no unsigned key used', draft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, draft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-size'].add(k));
  check('interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Hiring and departures
  const HD_URL = base + 'hiring-and-departures.html';
  const hdTiles = () => evaluate(`[...document.querySelectorAll('.opm-tile')].map(t => ({ name: t.querySelector('.opm-tile__name').textContent, value: t.querySelector('.opm-tile__value').textContent,
    subs: [...t.querySelectorAll('.opm-tile__sub')].map(s => s.textContent), badge: !!t.querySelector('.opm-tile__prov') }))`);
  const hdNotes = id => evaluate(`[...OPM.page.frames.${id}.notes.querySelectorAll('p')].map(p => p.textContent)`);
  const setMethod = m => evaluate(`(() => { const s = document.querySelector('.opm-field--rate select'); s.value = '${m}'; s.dispatchEvent(new Event('change')); })()`);
  const tilesMatch = (t, x) => t[0].value === x.hires && t[0].subs[0] === x.hiresPrior && t[1].value === x.departures && t[1].subs[0] === x.departuresPrior &&
    t[2].value === x.rate && t[2].subs[0] === x.ratePrior;
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(HD_URL); await waitFor(READY);
    const st = await evaluate(`({ grain: OPM.page.state.grain, entity: OPM.page.state.entity, method: OPM.page.state.method, inPanel: !!document.querySelector('[data-chart="rates"] .opm-field--rate'),
      inBar: !!document.querySelector('.opm-settings .opm-field--rate'), help: document.querySelector('.opm-field--rate .opm-field__note').textContent,
      rateLabel: document.querySelector('.opm-field--rate .opm-field__name').textContent, options: [...document.querySelectorAll('.opm-field--rate option')].map(o => o.textContent) })`);
    check(`HD FY/DOJ @${width}: Yearly, DOJ, method A; the rate selector sits in panel 4 only, with signed names and help`,
      st.grain === 'fy' && st.entity === 'DOJ' && st.method === 'a' && st.inPanel && !st.inBar && st.rateLabel === 'Rate based on' &&
      st.options.join('|') === 'Last 12 months|Fiscal year|Annual pace' && st.help.startsWith('Departures in the 12 months up to each point'), JSON.stringify(st));
    const t = await hdTiles();
    check(`HD FY/DOJ @${width}: tiles = latest 12 months with the year before; rate = latest month's A rate`, tilesMatch(t, EXP_HD.DOJ) && t.every(x => x.badge) &&
      t.map(x => x.name).join('|') === 'Hires, last 12 months|Departures, last 12 months|Departure rate, last 12 months', JSON.stringify(t) + ' expect ' + JSON.stringify(EXP_HD.DOJ));
    infos.push(`HD tiles @${width} DOJ: ` + t.map(x => x.value + ' (' + x.subs[0] + ')').join('; '));
    const pn = await evaluate(`({ flows: OPM.page.frames.flows.chart.data.labels.length, reasons: OPM.page.frames.reasons.chart.data.datasets.map(d => d.label + ':' + d.type),
      drpVisible: OPM.page.frames.reasons.chart.isDatasetVisible(6), types: OPM.page.frames.types.chart.data.datasets.map(d => d.label),
      rates: OPM.page.frames.rates.chart.data.datasets.map(d => d.label), legend: [...document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')].map(b => b.textContent) })`);
    check(`HD FY/DOJ @${width}: panels 2, 3, 5 and the rate lines; reasons in signed order with the DRP line on by default`, pn.flows === 15 &&
      pn.legend.join('|') === 'Transfer out|Quit|Retirement|RIF|Termination: expired appointment or other|Other|Deferred Resignation Program (DRP)' &&
      pn.reasons.at(-1) === 'Deferred Resignation Program (DRP):line' && pn.drpVisible && pn.types.join('|') === 'New hire|Transfer in' &&
      pn.rates.join('|') === 'Departure rate (all reasons)|Quit rate|Retirement rate', JSON.stringify(pn));
    const n3 = await hdNotes('reasons');
    check(`HD FY/DOJ @${width}: DRP note under panel 3`, n3[0] === 'DRP departures are already counted in the reasons above; the line shows how many of them there were.', n3.join(' | '));
    const sc = await evaluate(noScroll);
    check(`HD FY/DOJ @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
    await shot(path.join(SCREENS, `hiring-and-departures-fy-doj-${width}.png`));

    // Monthly / DOJ
    await setGrain('month');
    const lm = await evaluate('OPM.page.frames.flows.chart.data.labels');
    check(`HD month/DOJ @${width}: 178 months`, lm.length === 178 && lm[0] === 'Oct 2011' && lm.at(-1) === 'Jul 2026', lm.length + ' ' + lm.at(-1));
    await setMethod('b');
    const mb = await evaluate(`({ empty: OPM.page.frames.rates.chart.data.datasets.every(d => d.data.every(v => v === null)), notes: [...OPM.page.frames.rates.notes.querySelectorAll('p')].map(p => p.textContent),
      help: document.querySelector('.opm-field--rate .opm-field__note').textContent })`);
    check(`HD month/DOJ @${width}: method B shows the no-value message and no lines`, mb.empty && mb.notes.includes('This rate is only available in the Yearly view.') && mb.help.endsWith('Yearly view only.'), JSON.stringify(mb));
    await setMethod('a');
    await shot(path.join(SCREENS, `hiring-and-departures-month-doj-${width}.png`));

    // Yearly / OIG
    await setGrain('fy'); await setEntity('DJ10');
    const to = await hdTiles();
    check(`HD FY/OIG @${width}: tiles follow the component; no small-base flag (OIG averages about 480)`, tilesMatch(to, EXP_HD.DJ10) && !to[2].subs.some(x => x.startsWith('Based on fewer')) &&
      !(await hdNotes('rates')).some(x => x.startsWith('Based on fewer')), JSON.stringify(to) + ' expect ' + JSON.stringify(EXP_HD.DJ10));
    infos.push(`HD tiles @${width} OIG: ` + to.map(x => x.value + ' (' + x.subs[0] + ')').join('; '));
    await shot(path.join(SCREENS, `hiring-and-departures-fy-oig-${width}.png`));

    // Yearly / Community Relations Service: the component with small-base rates
    await setEntity('DJ14');
    const tc = await hdTiles();
    const sb = await evaluate(`({ notes: [...OPM.page.frames.rates.notes.querySelectorAll('p')].map(p => p.textContent),
      hollow: OPM.page.frames.rates.chart.data.datasets[0]._markers.filter(m => m === 'smallBase').length })`);
    check(`HD FY/CRS @${width}: small-base hollow markers and note in panel 4; tiles match`, tilesMatch(tc, EXP_HD.DJ14) && sb.hollow > 0 && sb.notes.includes('Based on fewer than 30 employees on average: read with care.') &&
      (tc[2].subs.includes('Based on fewer than 30 employees on average: read with care.') === EXP_HD.DJ14.smallBase), JSON.stringify({ tc, sb }) + ' expect ' + JSON.stringify(EXP_HD.DJ14));
    infos.push(`HD tiles @${width} Community Relations Service: ` + tc.map(x => x.value + ' (' + x.subs.join(', ') + ')').join('; '));
    await shot(path.join(SCREENS, `hiring-and-departures-fy-crs-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['hiring-and-departures'].add(k));
    const errs = errorsNow();
    check(`HD @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }
  // interactions at 1280
  await viewport(1280);
  await go(HD_URL); await waitFor(READY);
  const perMethod = {}, perMethod26 = {};
  for (const m of ['a', 'b', 'c']) {
    await setMethod(m);
    perMethod[m] = await evaluate(`(() => { const c = OPM.page.frames.rates.chart; return c.data.datasets[0].data[c.data.labels.indexOf('FY2025')]; })()`);
    perMethod26[m] = await evaluate(`(() => { const c = OPM.page.frames.rates.chart; return c.data.datasets[0].data[c.data.labels.indexOf('FY2026 (partial)')]; })()`);
  }
  check('HD Yearly/DOJ FY2026 (partial) departure rate per method = cube numerator / denominator, and the three differ', ['a', 'b', 'c'].every(m => perMethod26[m] === EXP_RATE_FY26[m]) &&
    new Set(Object.values(perMethod26)).size === 3, JSON.stringify({ perMethod26, EXP_RATE_FY26 }));
  infos.push('HD FY2026 (partial) departure rate by method: ' + ['a', 'b', 'c'].map(m => m.toUpperCase() + ' ' + rate(perMethod26[m])).join(', '));
  check('HD Yearly/DOJ FY2025 departure rate per method = cube numerator / denominator (A, B, C)', ['a', 'b', 'c'].every(m => perMethod[m] === EXP_RATE_FY25[m]), JSON.stringify({ perMethod, EXP_RATE_FY25 }));
  infos.push('HD FY2025 departure rate by method: ' + ['a', 'b', 'c'].map(m => m.toUpperCase() + ' ' + rate(perMethod[m])).join(', '));
  await setMethod('b');
  const ytd = await evaluate(`[...OPM.page.frames.rates.notes.querySelectorAll('p')].map(p => p.textContent)`);
  check('HD method B at Yearly: FY2026 labeled year to date', ytd.includes('FY2026: year so far, not a full year.'), ytd.join(' | '));
  await setMethod('a');
  const drp = await evaluate(`(() => { const b = document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')[6]; b.click(); return { p: b.getAttribute('aria-pressed'), v: OPM.page.frames.reasons.chart.isDatasetVisible(6) }; })()`);
  check('HD DRP overlay toggles off from the legend', drp.p === 'false' && drp.v === false, JSON.stringify(drp));
  await evaluate(`document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')[6].click()`); // back on
  for (const g of ['month', 'fy']) {
    await setGrain(g);
    const exp = rowsOf('DOJ', g).map(r => r[col('sep_drp')]); const first = exp.findIndex(v => v > 0);
    const got = await evaluate(`(() => { const c = OPM.page.frames.reasons.chart, d = c.data.datasets[6];
      const spec = OPM.svgExport.fromChart(c, {}); const s = spec.series.find(x => x.label === d.label);
      c.tooltip.setActiveElements([{ datasetIndex: 6, index: 0 }, { datasetIndex: 0, index: 0 }], { x: 0, y: 0 }); c.update();
      const tip = (c.tooltip.dataPoints || []).map(p => p.datasetIndex);
      c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update(); // close it again before the screenshot
      return { data: d.data, svgPoints: s.points.map(p => p !== null), tipHasDrp: tip.includes(6) }; })()`);
    const okData = got.data.every((v, i) => i < first ? v === null : v === exp[i]);
    const okSvg = got.svgPoints.every((p, i) => p === (i >= first));
    check(`HD DRP line (${g}) starts at its first nonzero period (${rowsOf('DOJ', g)[first][col('period')]}); earlier periods are gaps in the chart, SVG and tooltip`,
      okData && okSvg && !got.tipHasDrp, JSON.stringify({ first, head: got.data.slice(0, 3), okData, okSvg, tipHasDrp: got.tipHasDrp }));
  }
  await setGrain('fy');
  const tensions = await evaluate(`(() => { const out = []; for (const f of Object.values(OPM.page.frames)) f.chart.data.datasets.filter(d => d.type === 'line' || f.chart.config.type === 'line').forEach(d => out.push(d.tension)); return out; })()`);
  check('HD every line has tension 0 (straight segments)', tensions.length >= 4 && tensions.every(t => t === 0), tensions.join(','));
  await shot(path.join(SCREENS, 'hiring-and-departures-fy-doj-1280.png'));
  const hsv = await evaluate(`(() => { const out = {}; for (const [k, f] of Object.entries(OPM.page.frames)) { const d = new DOMParser().parseFromString(f.svg(), 'image/svg+xml');
      out[k] = { ok: !d.querySelector('parsererror'), rects: d.querySelectorAll('rect').length, paths: d.querySelectorAll('path').length, name: f.fileName() }; } return out; })()`);
  check('HD SVG export: all four charts parse; reasons carry bars and the DRP line', Object.values(hsv).every(x => x.ok) && hsv.reasons.rects > 60 && hsv.reasons.paths >= 1 &&
    hsv.rates.paths >= 3 && hsv.flows.name === 'opm-hires-vs-departures-DOJ-fy.svg' && hsv.rates.name === 'opm-rates-DOJ-fy-a.svg', JSON.stringify(hsv));
  const hdDraft = await evaluate('OPM.shell.refreshDraft()');
  check('HD draft badge off after the interactions', hdDraft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, hdDraft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['hiring-and-departures'].add(k));
  check('HD interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Who is leaving
  const WL_URL = base + 'who-is-leaving.html';
  const WL_READY = '!!(window.OPM && OPM.page && (OPM.page.unavailable || OPM.page.ready))';
  const wlTiles = () => evaluate(`[...document.querySelectorAll('.opm-tile')].map(t => ({ name: t.querySelector('.opm-tile__name').textContent, value: t.querySelector('.opm-tile__value').textContent,
    subs: [...t.querySelectorAll('.opm-tile__sub')].map(s => s.textContent), badge: !!t.querySelector('.opm-tile__prov') }))`);
  const snapLabels = key => evaluate(`(() => { const f = OPM.page.frames.${key}; const p = OPM.page.panels.find(x => x.dim.key === '${key}');
    return { groups: f.chart.data.labels, data: f.chart.data.datasets[0].data, prior: f.chart.data.datasets[1].data, faded: f.chart.data.datasets[0]._faded,
      text: p.labels(), ticks: f.chart.scales.y.ticks.map(t => f.chart.scales.y.getLabelForValue(t.value)), drawn: (f.chart._opmDrawnLabels || []).slice(),
      notes: [...f.notes.querySelectorAll('p')].map(x => x.textContent) }; })()`);
  const setPeriod = p => evaluate(`(() => { const s = document.querySelector('.opm-field--period select'); s.value = '${p}'; s.dispatchEvent(new Event('change')); })()`);
  const setView = v => evaluate(`document.querySelector('.opm-field--grain [data-value="${v}"]').click()`);
  const waitEntity = e => waitFor(`OPM.page.shown === '${e}:all'`);
  const tileCheck = (t, x) => t[0].value === x.departures && t[0].subs[0] === x.prior && t[1].value === x.lost && t[2].value === x.avg && t[2].subs.length === 0 &&
    (x.coverage < 1 ? t[1].subs[0] === 'Based on ' + (Math.floor(x.coverage * 1000) / 10).toFixed(1) + '% of departures with a known length of service.' : t[1].subs.length === 0);
  infos.push('Who is leaving data layout: ' + LEAVING_LAYOUT);
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(WL_URL); await waitFor(WL_READY);
    const st = await evaluate(`({ grain: OPM.page.state.grain, entity: OPM.page.state.entity, period: OPM.page.state.period,
      view: [...document.querySelectorAll('.opm-field--grain .opm-choice')].map(b => b.textContent), on: document.querySelector('.opm-field--grain [aria-checked=true]').textContent,
      note: (document.querySelector('.opm-field--grain .opm-field__note') || {}).textContent,
      periodText: document.querySelector('.opm-field--period select').selectedOptions[0].textContent, range: !!document.querySelector('.opm-range'), rate: !!document.querySelector('.opm-field--rate') })`);
    check(`WL t12/DOJ @${width}: View offers Yearly and Last 12 months, Last 12 months on; latest period; no range or rate control`,
      st.grain === 't12' && st.entity === 'DOJ' && st.period === '2026-07' && st.view.join('|') === 'Yearly|Last 12 months' && st.on === 'Last 12 months' &&
      st.periodText === '12 months ending Jul 2026' && !st.range && !st.rate && st.note === 'Years run October to September, the federal fiscal year.', JSON.stringify(st));
    const x = expectWL('DOJ', 't12', '2026-07'), t = await wlTiles();
    check(`WL t12/DOJ @${width}: tiles equal the cube (departures and year before; years lost and average from doj_core)`, tileCheck(t, x) && t.every(v => v.badge), JSON.stringify(t) + ' expect ' + JSON.stringify(x));
    infos.push(`WL tiles @${width} t12/DOJ: ` + t.map(v => v.name + ' ' + v.value + (v.subs.length ? ' (' + v.subs.join('; ') + ')' : '')).join(' | '));
    const los = await snapLabels('los'), occ = await snapLabels('occ');
    check(`WL t12/DOJ @${width}: bars and labels equal the cube; Unknown is a count line, never a bar`, JSON.stringify(los.text) === JSON.stringify(x.bars.los) && JSON.stringify(occ.text) === JSON.stringify(x.bars.occupation) &&
      los.groups.length === 7 && los.notes.includes(NUM.format(x.unknownLos) + ' departures with unknown years of service are counted in the total but not shown as a group.'), JSON.stringify({ los: los.text, occ: occ.text, notes: los.notes }));
    check(`WL t12/DOJ @${width}: occupation order attorneys, criminal investigators, correctional officers, all other (D-043)`,
      occ.groups.join('|') === 'Attorneys|Criminal investigators|Correctional officers|All other occupations', occ.groups.join('|'));
    check(`WL t12/DOJ @${width}: the drawn chart names the groups on its axis and paints every bar label`,
      los.ticks.join('|') === los.groups.join('|') && occ.ticks.join('|') === occ.groups.join('|') &&
      JSON.stringify(los.drawn) === JSON.stringify(x.bars.los.filter(Boolean)) && JSON.stringify(occ.drawn) === JSON.stringify(x.bars.occupation.filter(Boolean)),
      JSON.stringify({ ticks: los.ticks, drawn: los.drawn, occTicks: occ.ticks, occDrawn: occ.drawn }));
    const tr = await evaluate(`({ lines: ['los', 'age', 'sup', 'occ'].map(k => OPM.page.frames[k + 'Trend'].chart.data.datasets.length),
      tension: ['los', 'age', 'sup', 'occ'].every(k => OPM.page.frames[k + 'Trend'].chart.data.datasets.every(d => d.tension === 0)),
      rule: OPM.page.frames.losTrend.chart.options.plugins.opmMarkers.flags.lastIndexOf(true), n: OPM.page.frames.losTrend.chart.data.labels.length })`);
    check(`WL t12/DOJ @${width}: trend lines per group (7, 10, 2, 4), straight, the chosen period marked`, tr.lines.join() === '7,10,2,4' && tr.tension && tr.rule === tr.n - 1 && tr.n === 167, JSON.stringify(tr));
    const sc = await evaluate(noScroll);
    check(`WL t12/DOJ @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
    await shot(path.join(SCREENS, `who-is-leaving-t12-doj-${width}.png`));

    // Yearly / DOJ FY2025
    await setView('fy'); await setPeriod('FY2025');
    const xf = expectWL('DOJ', 'fy', 'FY2025'), tf = await wlTiles();
    const losF = await snapLabels('los'), occF = await snapLabels('occ');
    const i30 = losF.groups.indexOf('30 years or more'), i05 = occF.groups.indexOf('Attorneys');
    check(`WL FY2025/DOJ @${width}: 30 years or more 40.5% with 2,615 left; attorneys 25.3% with 3,106 left (40.51% and 25.26%)`,
      losF.text[i30] === '40.5% \u00b7 2,615 left' && occF.text[i05] === '25.3% \u00b7 3,106 left' && losF.drawn.includes('40.5% \u00b7 2,615 left') && occF.drawn.includes('25.3% \u00b7 3,106 left') && Math.abs(losF.data[i30] - 0.4051) < 0.00005 && Math.abs(occF.data[i05] - 0.2526) < 0.00005,
      JSON.stringify({ los: losF.text[i30], losRate: losF.data[i30], occ: occF.text[i05], occRate: occF.data[i05] }));
    check(`WL FY2025/DOJ @${width}: tiles and all bars equal the cube; a year-before bar per group`, tileCheck(tf, xf) && JSON.stringify(losF.text) === JSON.stringify(xf.bars.los) &&
      JSON.stringify(occF.text) === JSON.stringify(xf.bars.occupation) && losF.prior.every(v => typeof v === 'number'), JSON.stringify(tf) + ' expect ' + JSON.stringify(xf));
    infos.push(`WL tiles @${width} FY2025/DOJ: ` + tf.map(v => v.name + ' ' + v.value + (v.subs.length ? ' (' + v.subs.join('; ') + ')' : '')).join(' | '));
    await shot(path.join(SCREENS, `who-is-leaving-fy2025-doj-${width}.png`));
    await setPeriod('FY2026');
    const ytd = await evaluate(`[...document.querySelectorAll('.opm-tiles__notes p')].map(p => p.textContent)`);
    check(`WL FY2026/DOJ @${width}: the partial year is labeled year to date`, ytd.includes('FY2026: year so far, not a full year.') &&
      (await evaluate(`document.querySelector('.opm-field--period select').selectedOptions[0].textContent`)) === 'FY2026 (partial)', ytd.join(' | '));

    // Last 12 months / Community Relations Service: small base and not applicable
    await setView('t12'); await setEntity('DJ14'); await waitEntity('DJ14');
    const xc = expectWL('DJ14', 't12', '2026-04'), tc = await wlTiles();
    const occC = await snapLabels('occ'), supC = await snapLabels('sup');
    const naIdx = occC.text.map((s, j) => s === 'not applicable: no employees in this group' ? j : -1).filter(j => j >= 0);
    check(`WL t12/CRS @${width}: latest period Apr 2026; criminal investigators and correctional officers not applicable (no bar); small bases hatched with the note`,
      (await evaluate('OPM.page.state.period')) === '2026-04' && naIdx.join() === '1,2' && naIdx.every(j => occC.data[j] === null) &&
      occC.faded[0] && occC.faded[3] && occC.drawn.filter(t => t === 'not applicable: no employees in this group').length === 2 && occC.notes.includes('Based on fewer than 30 employees on average: read with care.') && supC.faded.every(Boolean) &&
      JSON.stringify(occC.text) === JSON.stringify(xc.bars.occupation) && tileCheck(tc, xc), JSON.stringify({ occC, tc, xc }));
    infos.push(`WL tiles @${width} t12/CRS: ` + tc.map(v => v.name + ' ' + v.value + (v.subs.length ? ' (' + v.subs.join('; ') + ')' : '')).join(' | '));
    await shot(path.join(SCREENS, `who-is-leaving-t12-crs-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['who-is-leaving'].add(k));
    const errs = errorsNow();
    check(`WL @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }
  // interactions at 1280
  await viewport(1280);
  await go(WL_URL); await waitFor(WL_READY);
  await setEntity('DJ02'); await waitEntity('DJ02');
  const res = await evaluate(`performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('doj_leaving'))`);
  const files = res.filter(n => /doj_leaving\/[^/]+\.json/.test(n)).map(n => n.split('/').pop().split('?')[0]);
  check('WL loads only the selected component\'s file (DOJ, then FBI), never the whole cube', files.join() === 'DOJ.json,DJ02.json' && !res.some(n => /doj_leaving\.json/.test(n)), res.join(' | '));
  const tog = await evaluate(`(() => { const b = document.querySelectorAll('[data-chart="leaving-age-trend"] .opm-key__item')[3]; b.click(); return { p: b.getAttribute('aria-pressed'), v: OPM.page.frames.ageTrend.chart.isDatasetVisible(3) }; })()`);
  check('WL age trend: a legend toggle hides one group', tog.p === 'false' && tog.v === false, JSON.stringify(tog));
  const wsv = await evaluate(`(() => { const out = {}; for (const [k, f] of Object.entries(OPM.page.frames)) { const d = new DOMParser().parseFromString(f.svg(), 'image/svg+xml');
      out[k] = { ok: !d.querySelector('parsererror'), labels: d.querySelectorAll('.opm-svg-label').length, rules: d.querySelectorAll('.opm-svg-marker--rule').length, paths: d.querySelectorAll('path').length, name: f.fileName() }; } return out; })()`);
  check('WL SVG export: all eight charts parse; snapshots carry their bar labels, trends the chosen-period rule', Object.values(wsv).every(v => v.ok) &&
    wsv.los.labels === 7 && wsv.occ.labels === 4 && wsv.losTrend.rules === 1 && wsv.ageTrend.paths >= 9 && wsv.los.name === 'opm-leaving-los-DJ02-t12-2026-07.svg', JSON.stringify(wsv));
  const wlDraft = await evaluate('OPM.shell.refreshDraft()');
  check('WL draft badge off after the interactions', wlDraft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, wlDraft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['who-is-leaving'].add(k));
  check('WL interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Components compared
  const CC_URL = base + 'components-compared.html';
  const ccTable = () => evaluate(`[...document.querySelectorAll('.opm-compare__table tbody tr')].map(tr => [...tr.children].map(c => c.textContent))`);
  const ccHead = () => evaluate(`[...document.querySelectorAll('.opm-compare__table thead th')].map(th => th.textContent + ':' + th.getAttribute('aria-sort'))`);
  const ccRow = (x) => [x.employees, x.change, x.hires, x.departures, x.rate, x.quit, x.retirement];
  const ccSetPeriod = p => evaluate(`(() => { const s = document.querySelector('.opm-field--period select'); s.value = '${p}'; s.dispatchEvent(new Event('change')); })()`);
  const ccMethod = m => evaluate(`(() => { const s = document.querySelector('.opm-field--rate select'); s.value = '${m}'; s.dispatchEvent(new Event('change')); })()`);
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(CC_URL); await waitFor(READY);
    const st = await evaluate(`({ grain: OPM.page.state.grain, period: OPM.page.state.period, method: OPM.page.state.method, start: OPM.page.state.startFy,
      periodText: document.querySelector('.opm-field--period select').selectedOptions[0].textContent, note: (document.querySelector('.opm-field--grain .opm-field__note') || {}).textContent,
      caption: document.querySelector('.opm-compare__caption').textContent, badge: !!document.querySelector('.opm-compare__caption .opm-tile__prov'),
      component: !!document.querySelector('.opm-field--component'), growthTitle: document.querySelector('[data-chart="growth"] h2').textContent })`);
    check(`CC defaults @${width}: Yearly with the D-033 note, FY2026 (partial), Last 12 months, start FY2012; no component selector; caption with the provisional marker`,
      st.grain === 'fy' && st.period === 'FY2026' && st.method === 'a' && st.start === 'FY2012' && st.periodText === 'FY2026 (partial)' && !st.component &&
      st.note === 'Years run October to September, the federal fiscal year.' && st.caption === 'FY2026 (partial). Rates: Last 12 months.' && st.badge &&
      st.growthTitle === 'Growth in employees since FY2012', JSON.stringify(st));
    const t = await ccTable();
    const x26 = expectCC('DOJ', 'fy', 'FY2026', 'a');
    check(`CC defaults @${width}: DOJ pinned first with cells equal to the cube; 12 component rows (CRS ended, FY2026 covers Oct 2025 to Apr 2026)`,
      t[0][0] === 'Justice Department (all components)' && JSON.stringify(t[0].slice(1)) === JSON.stringify(ccRow(x26)) && t.length === 13 &&
      t.some(r => r[0] === 'Community Relations Service (last reported Apr 2026)') && t[1][0] === 'FBI', JSON.stringify(t.slice(0, 2)) + ' expect ' + JSON.stringify(ccRow(x26)));
    const sc = await evaluate(noScroll);
    const inner = await evaluate(`(() => { const s = document.querySelector('.opm-compare__scroll'); const name = document.querySelector('.opm-compare__table tbody th');
      return { scrolls: s.scrollWidth > s.clientWidth, sticky: getComputedStyle(name).position, panelFits: s.getBoundingClientRect().right <= window.innerWidth }; })()`);
    check(`CC @${width}: the page never scrolls sideways${width < 600 ? '; the table scrolls inside its panel with the component column fixed' : ''}`,
      sc.sw <= sc.iw && sc.wide.length === 0 && inner.sticky === 'sticky' && inner.panelFits && (width < 600 ? inner.scrolls : true), JSON.stringify({ sc, inner }));
    const rk26 = await evaluate(`({ labels: OPM.page.frames.ranking.chart.data.labels, small: OPM.page.frames.ranking.chart.data.datasets[0]._faded,
      notes: [...OPM.page.frames.ranking.notes.querySelectorAll('p')].map(p => p.textContent), tableNotes: [...document.querySelectorAll('[data-chart="table"] .opm-chart__notes p')].map(p => p.textContent),
      marks: [...document.querySelectorAll('.opm-compare__table tbody tr')].filter(tr => tr.querySelector('.opm-compare__small')).map(tr => tr.firstChild.textContent) })`);
    const crsName = 'Community Relations Service (last reported Apr 2026)';
    check(`CC defaults @${width}: CRS (small base in FY2026) hatched in the ranking, marked in the table, with the note in both`,
      rk26.small[rk26.labels.indexOf(crsName)] === true && rk26.small.filter(Boolean).length === 1 && rk26.notes.includes('Based on fewer than 30 employees on average: read with care.') &&
      rk26.tableNotes.includes('Based on fewer than 30 employees on average: read with care.') && rk26.marks.join() === crsName, JSON.stringify(rk26));
    await shot(path.join(SCREENS, `components-compared-fy2026-${width}.png`));
    if (width < 600) {
      await evaluate(`document.querySelector('.opm-compare__scroll').scrollLeft = 360`);
      const stuck = await evaluate(`(() => { const s = document.querySelector('.opm-compare__scroll'); const n = document.querySelector('.opm-compare__table tbody th');
        return { left: s.scrollLeft, nameLeft: Math.round(n.getBoundingClientRect().left - s.getBoundingClientRect().left) }; })()`);
      check('CC @390: scrolled sideways, the component column stays in place', stuck.left > 0 && stuck.nameLeft <= 1, JSON.stringify(stuck));
      await shot(path.join(SCREENS, 'components-compared-table-scrolled-390.png'));
      await evaluate(`document.querySelector('.opm-compare__scroll').scrollLeft = 0`);
    }

    // Yearly FY2025
    await ccSetPeriod('FY2025');
    const t25 = await ccTable(), d25 = expectCC('DOJ', 'fy', 'FY2025', 'a'), f25 = expectCC('DJ02', 'fy', 'FY2025', 'a');
    const dojRate = await evaluate('OPM.page.last.dojCells.attrition');
    const fbiRow = t25.find(r => r[0] === 'FBI');
    check(`CC FY2025 @${width}: DOJ departure rate 12.83% (shown 12.8%); DOJ and FBI rows equal the cube; CRS present, labeled ended`,
      (dojRate * 100).toFixed(2) === '12.83' && dojRate === d25.rawRate && JSON.stringify(t25[0].slice(1)) === JSON.stringify(ccRow(d25)) && JSON.stringify(fbiRow.slice(1)) === JSON.stringify(ccRow(f25)) &&
      t25.some(r => r[0] === 'Community Relations Service (last reported Apr 2026)'), JSON.stringify({ doj: t25[0], fbi: fbiRow, expect: ccRow(f25) }));
    infos.push(`CC FY2025 @${width} DOJ: ` + t25[0].slice(1).join(' | ') + '  FBI: ' + fbiRow.slice(1).join(' | '));
    const rk = await evaluate(`({ labels: OPM.page.frames.ranking.chart.data.labels, data: OPM.page.frames.ranking.chart.data.datasets[0].data, ref: OPM.page.frames.ranking.chart.options.plugins.opmRefLine.value,
      notes: [...OPM.page.frames.ranking.notes.querySelectorAll('p')].map(p => p.textContent), small: OPM.page.frames.ranking.chart.data.datasets[0]._faded })`);
    const sortedDesc = rk.data.every((v, i) => i === 0 || rk.data[i - 1] >= v);
    check(`CC FY2025 @${width}: ranking highest first, DOJ reference line and note; CRS not a small base in FY2025 (average 55.5)`, sortedDesc && rk.ref === dojRate &&
      rk.notes.includes('Justice Department overall: 12.8%') && rk.small.every(f => !f) && !rk.notes.some(n => n.startsWith('Based on fewer')), JSON.stringify(rk));
    const rs = await evaluate(`OPM.page.last.reasons.map(r => ({ name: r.name, sum: r.shares.reduce((a, v) => a + (v || 0), 0), none: r.none }))`);
    check(`CC FY2025 @${width}: reason shares sum to 100% for every component with departures, DOJ first`, rs[0].name === 'Justice Department (all components)' &&
      rs.every(r => r.none || Math.abs(r.sum - 1) < 1e-9), JSON.stringify(rs));
    await shot(path.join(SCREENS, `components-compared-fy2025-${width}.png`));

    // Monthly with "Fiscal year": the no-value message; CRS absent after Apr 2026
    await setGrain('month'); await ccMethod('b');
    const mb = await evaluate(`({ period: OPM.page.state.period, rates: [...document.querySelectorAll('.opm-compare__table tbody tr')].map(tr => [...tr.children].slice(5).map(c => c.textContent).join('|')),
      notes: [...document.querySelectorAll('[data-chart="table"] .opm-chart__notes p')].map(p => p.textContent), bars: OPM.page.frames.ranking.chart.data.datasets[0].data.length,
      rankNotes: [...OPM.page.frames.ranking.notes.querySelectorAll('p')].map(p => p.textContent), names: [...document.querySelectorAll('.opm-compare__table tbody th')].map(th => th.textContent) })`);
    check(`CC Monthly + Fiscal year @${width}: rates empty with the no-value message in the table and the ranking; latest month Jul 2026 without CRS`,
      mb.period === '2026-07' && mb.rates.every(r => r === '\u2013|\u2013|\u2013') && mb.notes.includes('This rate is only available in the Yearly view.') && mb.bars === 0 &&
      mb.rankNotes.includes('This rate is only available in the Yearly view.') && !mb.names.some(n => n.startsWith('Community Relations Service')) && mb.names.length === 12, JSON.stringify(mb));
    await shot(path.join(SCREENS, `components-compared-month-fiscal-year-${width}.png`));
    await ccMethod('a');
    // a month in which Community Relations Service had no departures: "no departures", never a 0% bar
    const zeroMonth = rowsOf('DJ14', 'month').filter(r => r[col('departures')] === 0).at(-1)[col('period')];
    await ccSetPeriod(zeroMonth);
    const nd = await evaluate(`(() => { const r = OPM.page.last.reasons.find(x => x.name.startsWith('Community Relations Service')); const c = OPM.page.frames.reasons.chart;
      return { none: r && r.none, drawn: (c._opmDrawnLabels || []).slice(), data: c.data.datasets.map(d => d.data[OPM.page.last.reasons.indexOf(r)]) }; })()`);
    check(`CC ${zeroMonth} @${width}: Community Relations Service had no departures: labeled "no departures", no bar`, nd.none === true && nd.drawn.includes('no departures') && nd.data.every(v => v === null), JSON.stringify(nd));
    await setGrain('fy');
    // "Fiscal year" on the partial FY2026: year to date, and said so
    await ccMethod('b');
    const ytdN = await evaluate(`[...document.querySelectorAll('[data-chart="table"] .opm-chart__notes p')].map(p => p.textContent)`);
    const x26b = expectCC('DOJ', 'fy', 'FY2026', 'b'), t26b = await ccTable();
    check(`CC FY2026 + Fiscal year @${width}: year to date, labeled; DOJ rate equals the cube's method B`, ytdN.includes('FY2026: year so far, not a full year.') && t26b[0][5] === x26b.rate &&
      (await evaluate(`document.querySelector('.opm-compare__caption').textContent`)) === 'FY2026 (partial). Rates: Fiscal year.', JSON.stringify({ ytdN, rate: t26b[0][5], expect: x26b.rate }));
    await ccMethod('a');

    // a column sort
    await evaluate(`document.querySelector('.opm-compare__sort[data-col="departures"]').click()`);
    const sd = await ccTable(), hd1 = await ccHead();
    const depNum = r => +r[4].replace(/,/g, '');
    check(`CC @${width}: sorting by departures, descending first, keeps DOJ on top`, sd[0][0] === 'Justice Department (all components)' &&
      sd.slice(1).every((r, i, a) => i === 0 || depNum(a[i - 1]) >= depNum(r)) && hd1[4] === 'Departures:descending', JSON.stringify(hd1));
    await evaluate(`document.querySelector('.opm-compare__sort[data-col="departures"]').click()`);
    const sa = await ccTable(), hd2 = await ccHead();
    check(`CC @${width}: a second click sorts ascending`, sa[0][0] === 'Justice Department (all components)' && sa.slice(1).every((r, i, a) => i === 0 || depNum(a[i - 1]) <= depNum(r)) &&
      hd2[4] === 'Departures:ascending', JSON.stringify(hd2));

    // the component column sorts A to Z first, then Z to A; DOJ stays on top
    await evaluate(`document.querySelector('.opm-compare__sort[data-col="component"]').click()`);
    const az = (await ccTable()).map(r => r[0]), hz1 = await ccHead();
    const byName = az.slice(1).slice().sort((a, b) => a.localeCompare(b, 'en'));
    check(`CC @${width}: the Component column sorts A to Z first`, az[0] === 'Justice Department (all components)' && JSON.stringify(az.slice(1)) === JSON.stringify(byName) && hz1[0] === 'Component:ascending', JSON.stringify({ az, h: hz1[0] }));
    await evaluate(`document.querySelector('.opm-compare__sort[data-col="component"]').click()`);
    const za = (await ccTable()).map(r => r[0]), hz2 = await ccHead();
    check(`CC @${width}: a second click sorts Z to A`, za[0] === 'Justice Department (all components)' && JSON.stringify(za.slice(1)) === JSON.stringify(byName.slice().reverse()) && hz2[0] === 'Component:descending', JSON.stringify({ za, h: hz2[0] }));

    // the start year changed
    await evaluate(`(() => { const s = document.querySelector('.opm-field--start select'); s.value = 'FY2020'; s.dispatchEvent(new Event('change')); })()`);
    const gr = await evaluate(`(() => { const c = OPM.page.frames.growth.chart; return { title: document.querySelector('[data-chart="growth"] h2').textContent, first: c.data.labels[0], n: c.data.datasets.length,
      doj0: c.data.datasets[0].data[0], dojW: c.data.datasets[0].borderWidth, tension: c.data.datasets.every(d => d.tension === 0),
      crsLast: (() => { const d = c.data.datasets.find(x => x.label.startsWith('Community Relations Service')); return d.data.at(-1); })(),
      note: [...OPM.page.frames.growth.notes.querySelectorAll('p')].map(p => p.textContent)[0], starts: [...document.querySelectorAll('.opm-field--start option')].map(o => o.value) }; })()`);
    check(`CC @${width}: start year FY2020: index 100 at FY2020, 13 straight lines, DOJ thicker; start years FY2012 to FY2025`, gr.title === 'Growth in employees since FY2020' &&
      gr.first === 'FY2020' && gr.n === 13 && gr.doj0 === 1 && gr.dojW > 2 && gr.tension && gr.starts[0] === 'FY2012' && gr.starts.at(-1) === 'FY2025' &&
      gr.note === 'Each line shows employees as a share of that component\'s count at the end of FY2020 (= 100).', JSON.stringify(gr));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-compared'].add(k));
    const errs = errorsNow();
    check(`CC @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }
  await viewport(1280);
  await go(CC_URL); await waitFor(READY);
  await setGrain('month');
  const crsMonths = await evaluate(`(() => { const c = OPM.page.frames.growth.chart; const d = c.data.datasets.find(x => x.label.startsWith('Community Relations Service')); let i = d.data.length - 1; while (i >= 0 && d.data[i] === null) i--; return c.data.labels[i]; })()`);
  check('CC growth (Monthly): Community Relations Service stops at Apr 2026', crsMonths === 'Apr 2026', String(crsMonths));
  await setGrain('fy');
  const csv = await evaluate(`(() => { const out = {}; for (const [k, f] of Object.entries(OPM.page.frames)) { const d = new DOMParser().parseFromString(f.svg(), 'image/svg+xml');
      out[k] = { ok: !d.querySelector('parsererror'), rules: d.querySelectorAll('.opm-svg-marker--rule').length, labels: d.querySelectorAll('.opm-svg-label').length, name: f.fileName() }; } return out; })()`);
  check('CC SVG export: all three charts parse; the ranking carries its DOJ reference rule and bar labels', Object.values(csv).every(v => v.ok) && csv.ranking.rules === 1 && csv.ranking.labels >= 11, JSON.stringify(csv));
  const ccDraft = await evaluate('OPM.shell.refreshDraft()');
  check('CC draft badge off after the interactions', ccDraft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, ccDraft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-compared'].add(k));
  check('CC interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Reading the data
  const RD_URL = base + 'reading-the-data.html';
  const RD_READY = '!!(window.OPM && OPM.page && OPM.page.ready)';
  const rdCopy = JSON.parse(readFileSync(path.join(WEB, 'copy.json'), 'utf8'));
  const rdp = rdCopy.pages['reading-the-data'];
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(RD_URL); await waitFor(RD_READY);
    const rd = await evaluate(`({ toc: [...document.querySelectorAll('.opm-doc__toc a')].map(a => a.getAttribute('href') + '=' + a.textContent), tocLabel: document.querySelector('.opm-doc__toc .opm-field__name').textContent,
      h2: [...document.querySelectorAll('.opm-doc__h2')].map(h => h.id + '=' + h.textContent), h3: [...document.querySelectorAll('.opm-doc__h3')].map(h => h.textContent),
      paras: [...document.querySelectorAll('.opm-doc__p, .opm-doc__list li')].map(p => p.textContent), reasons: [...document.querySelectorAll('.opm-doc__table tr')].map(tr => [...tr.children].map(c => c.textContent)),
      intro: document.querySelector('.opm-intro').textContent, charts: document.querySelectorAll('canvas').length, data: performance.getEntriesByType('resource').some(e => e.name.includes('/data/')) })`);
    const expectParas = ['source.p1', 'source.p2', 'source.p3', 'source.p4', 'source.p5', 'counting.p1', 'counting.p2', 'counting.p3', 'counting.p4', 'counting.p5',
      'rates.p1', 'rates.p2', 'rates.list.a', 'rates.list.b', 'rates.list.c', 'rates.p3', 'rates.p4', 'rates.p5', 'rates.p6', 'rates.p7',
      'gaps.drp.p1', 'gaps.los.p1', 'gaps.occ.p1', 'gaps.redact.p1', 'gaps.revisions.p1'].map(k => rdp[k]);
    check(`RD @${width}: contents list and four anchored sections; every paragraph is the signed text in order`,
      rd.toc.join('|') === '#source=Source and coverage|#counting=How we count|#rates=Rates and categories|#known-gaps=Known gaps and data issues' && rd.tocLabel === 'On this page' &&
      rd.h2.join('|') === 'source=Source and coverage|counting=How we count|rates=Rates and categories|known-gaps=Known gaps and data issues' &&
      rd.h3.length === 5 && rd.h3[0] === rdp['gaps.drp.title'] && JSON.stringify(rd.paras) === JSON.stringify(expectParas) && rd.intro === rdp['page.intro'], JSON.stringify({ toc: rd.toc, h2: rd.h2, n: rd.paras.length }));
    check(`RD @${width}: reasons table from the signed labels and the split descriptions; no charts, no data read`,
      JSON.stringify(rd.reasons) === JSON.stringify([['Transfer out', 'individual and mass transfers to another agency'], ['Quit', ''], ['Retirement', 'voluntary, early and other retirements'],
        ['RIF', 'reduction in force'], ['Termination: expired appointment or other', ''], ['Other', '']]) && rd.charts === 0 && !rd.data, JSON.stringify(rd.reasons));
    const sc = await evaluate(noScroll);
    check(`RD @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
    await shot(path.join(SCREENS, `reading-the-data-${width}.png`));
    // the Workforce size link lands on the known-gaps heading
    await go(base + 'index.html'); await waitFor(READY);
    const href = await evaluate(`[...document.querySelectorAll('[data-chart="change-vs-net-flow"] .opm-chart__notes a')].map(a => a.getAttribute('href'))[0]`);
    await go(base + href); await waitFor(RD_READY); await sleep(300);
    const land = await evaluate(`(() => { const h = document.getElementById('known-gaps'); const r = h.getBoundingClientRect();
      return { hash: location.hash, top: Math.round(r.top), scrollY: Math.round(window.scrollY), maxY: Math.round(document.documentElement.scrollHeight - window.innerHeight), vh: window.innerHeight }; })()`);
    check(`RD @${width}: Workforce size's known-gap link lands on the Known gaps heading`, href === 'reading-the-data.html#known-gaps' && land.hash === '#known-gaps' &&
      land.top >= 0 && (land.top <= 40 || land.scrollY >= land.maxY - 1) && land.top < land.vh, JSON.stringify({ href, land }));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['reading-the-data'].add(k));
    const errs = errorsNow();
    check(`RD @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }

  // ---- Components compared growth palette: 13 lines, all distinguishable
  await viewport(1280);
  await go(CC_URL); await waitFor(READY);
  const pal = await evaluate(`OPM.page.frames.growth.chart.data.datasets.map(d => ({ label: d.label, color: d.borderColor, w: d.borderWidth }))`);
  /* perceptual difference: CIE Lab (D65), Delta E 1976 */
  const lab = hx => {
    const v = hx.replace('#', ''), f = c => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
    const [r, g, b] = [0, 2, 4].map(i => f(parseInt(v.slice(i, i + 2), 16) / 255));
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const t = u => (u > 0.008856 ? Math.cbrt(u) : 7.787 * u + 16 / 116);
    return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
  };
  let minD = Infinity, pair = '';
  for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) {
    const a = lab(pal[i].color), b = lab(pal[j].color), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d < minD) { minD = d; pair = pal[i].label + ' / ' + pal[j].label; }
  }
  const fbi = pal.find(x => x.label === 'FBI'), crs = pal.find(x => x.label.startsWith('Community Relations Service'));
  check('CC growth: 13 lines with 13 different colors, every pair clearly apart (CIE Lab Delta E >= 20); DOJ the thick reference; CRS no longer FBI blue',
    pal.length === 13 && new Set(pal.map(x => x.color)).size === 13 && minD >= 20 && pal[0].w > 2 && pal.slice(1).every(x => x.w < pal[0].w) && fbi.color !== crs.color,
    JSON.stringify({ minD: Math.round(minD), pair, fbi: fbi.color, crs: crs.color }));
  infos.push('CC growth palette: minimum pairwise Delta E ' + Math.round(minD) + ' (' + pair + '); FBI ' + fbi.color + ', Community Relations Service ' + crs.color);
  // a clip of the growth chart panel alone
  const box = await evaluate(`(() => { const r = document.querySelector('[data-chart="growth"]').getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; })()`);
  const clip = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 } });
  writeFileSync(path.join(SCREENS, 'components-compared-growth-1280.png'), Buffer.from(clip.data, 'base64'));

  // ---- Workforce Look-Up
  const LU_URL = base + 'workforce-lookup.html';
  const sepRows = await readLookup('separations');
  const expAttorneys = (() => { const r = lrows('DOJ', 'fy', 'FY2025', 'occupation').find(x => x[lc('value')] === '0905'); return r[lc('departures')]; })();
  const expParalegal = sepRows.filter(r => (r.occupational_series || '').toLowerCase().includes('paralegal')).length;
  const fy25core = Object.fromEntries(meta.entities.map(e => [e, (rowsOf(e, 'month').find(r => r[col('period')] === '2025-09') || [])[col('headcount')]]));
  const luCount = () => evaluate(`document.querySelector('.opm-lookup__count').textContent`);
  const luSet = (sel, v) => evaluate(`(() => { const s = document.querySelector('${sel}'); s.value = '${v}'; s.dispatchEvent(new Event('change')); })()`);
  const luWait = key => waitFor(`OPM.page.loaded === '${key}'`, 20000);
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(LU_URL); await waitFor(READY, 20000); await luWait('separations');
    const d = await evaluate(`({ dataset: document.querySelector('.opm-field--dataset select').value, snapHidden: document.querySelector('.opm-field--snapshot').hidden,
      heads: [...document.querySelectorAll('.opm-lookup__table thead th')].map(th => th.textContent), rows: document.querySelectorAll('.opm-lookup__table tbody tr').length,
      page: document.querySelector('.opm-lookup__page').textContent, groupBy: document.querySelector('.opm-field--group select').value,
      groups: [...document.querySelectorAll('.opm-lookup__group-table tr')].map(tr => +tr.lastChild.textContent.replace(/,/g, '')), privacy: document.querySelector('.opm-intro--privacy').textContent,
      filters: [...document.querySelectorAll('.opm-lookup__filters select')].map(s => s.dataset.filter), occ: [...document.querySelectorAll('[data-filter="occupation"] option')].slice(1, 4).map(o => o.value),
      fetched: performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/data/lookup/')).map(n => n.split('/').pop().split('?')[0]) })`);
    check(`LU default @${width}: Departures, all ${NUM.format(LMETA.files.separations.rows)} records, 50 rows a page, count by component; only separations.parquet loaded`,
      d.dataset === 'separations' && d.snapHidden && (await luCount()) === NUM.format(LMETA.files.separations.rows) + ' matching records' && d.rows === 50 &&
      d.page === 'Page 1 of ' + NUM.format(Math.ceil(LMETA.files.separations.rows / 50)) && d.groupBy === 'component' && d.groups.reduce((a, v) => a + v, 0) === LMETA.files.separations.rows &&
      d.heads.join('|') === 'Component|Took effect|Processed|Reason|DRP|Occupation|Pay plan|Grade|Age|Years of service|Supervisory status|Appointment type|Tenure|Education|Veteran|Work schedule|Annual pay|Duty state' &&
      d.filters.join() === 'component,fy,reason,occupation,grade,age,supervisory' && d.occ.slice(0, 2).join() === '0905,1811' && d.fetched.join() === 'separations.parquet' &&
      d.privacy.startsWith('OPM publishes these records without names'), JSON.stringify(d).slice(0, 900));
    const sc = await evaluate(noScroll);
    const inner = await evaluate(`(() => { const s = document.querySelector('.opm-lookup__scroll'); return { scrolls: s.scrollWidth > s.clientWidth, sticky: getComputedStyle(document.querySelector('.opm-lookup__table tbody th')).position }; })()`);
    check(`LU @${width}: the page never scrolls sideways; the table scrolls inside its panel with the first column fixed`, sc.sw <= sc.iw && sc.wide.length === 0 && inner.sticky === 'sticky' && inner.scrolls, JSON.stringify({ sc, inner }));
    await shot(path.join(SCREENS, `workforce-lookup-departures-${width}.png`));

    // Attorneys in FY2025 (by the month the action took effect)
    await luSet('[data-filter="occupation"]', '0905'); await luSet('[data-filter="fy"]', 'FY2025');
    check(`LU @${width}: Attorneys + FY2025 = ${NUM.format(expAttorneys)} matching records, equal to the doj_leaving cube`, (await luCount()) === NUM.format(expAttorneys) + ' matching records' && expAttorneys === 3106, await luCount());
    await shot(path.join(SCREENS, `workforce-lookup-attorneys-fy2025-${width}.png`));

    // CSV of the filtered rows
    const csv = await evaluate(`(async () => { let blob = null, name = null; const cu = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return 'blob:x'; };
      const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { name = this.download; };
      document.querySelector('.opm-lookup__download').click(); URL.createObjectURL = cu; HTMLAnchorElement.prototype.click = ck;
      const bytes = new Uint8Array(await blob.arrayBuffer()); const bom = [...bytes.slice(0, 3)].map(b => b.toString(16)).join('');
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      const lines = body.split(String.fromCharCode(13, 10)); return { name, bom, n: lines.length, header: lines[0], first: lines[1], type: blob.type }; })()`);
    const firstRow = await evaluate(`(() => { const c = OPM.page.current(); const r = c.rows[OPM.page.last.idx[0]]; return ${JSON.stringify(SEP_FIELDS)}.map(f => r[f] === null ? '' : r[f]); })()`);
    check(`LU @${width}: Download CSV saves the filtered rows with OPM's column names, values as published, behind a UTF-8 byte-order mark`, csv.bom === 'efbbbf' && csv.name === 'doj-separations-all-filtered.csv' && csv.n === expAttorneys + 2 &&
      csv.header === SEP_FIELDS.join(',') && csv.first === firstRow.map(v => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',') && csv.type.startsWith('text/csv'),
      JSON.stringify({ name: csv.name, n: csv.n, header: csv.header, first: csv.first }));

    // search, then Clear filters
    await evaluate(`document.querySelector('.opm-lookup__clear').click()`);
    await evaluate(`(() => { const i = document.querySelector('.opm-field--search input'); i.value = 'paralegal'; i.dispatchEvent(new Event('input')); })()`);
    await waitFor(`document.querySelector('.opm-lookup__count').textContent === '${NUM.format(expParalegal)} matching records'`, 5000);
    check(`LU @${width}: search "paralegal" (any case) finds ${NUM.format(expParalegal)} records`, (await luCount()) === NUM.format(expParalegal) + ' matching records', await luCount());
    await evaluate(`document.querySelector('.opm-lookup__clear').click()`);
    check(`LU @${width}: Clear filters resets search and filters`, (await luCount()) === NUM.format(LMETA.files.separations.rows) + ' matching records' &&
      (await evaluate(`document.querySelector('.opm-field--search input').value`)) === '', await luCount());

    // a KDI-001 row shows its marker
    await evaluate(`(() => { const i = document.querySelector('.opm-field--search input'); i.value = '124.8'; i.dispatchEvent(new Event('input')); })()`);
    await waitFor(`!!document.querySelector('.opm-lookup__kdi')`, 5000);
    const kdi = await evaluate(`(() => { const a = document.querySelector('.opm-lookup__kdi'); const td = a.parentElement; return { href: a.getAttribute('href'), label: a.getAttribute('aria-label'), cell: td.firstChild.textContent,
      n: document.querySelectorAll('.opm-lookup__kdi').length }; })()`);
    check(`LU @${width}: a KDI-001 row keeps its value and shows the marker linking to #known-gaps`, kdi.href === 'reading-the-data.html#known-gaps' &&
      kdi.label === 'OPM recorded this length of service from 1900; see Reading the data.' && /^12[4-6]\.\d$/.test(kdi.cell), JSON.stringify(kdi));
    await shot(path.join(SCREENS, `workforce-lookup-kdi-${width}.png`));
    await evaluate(`(() => { const i = document.querySelector('.opm-field--search input'); i.value = 'zz no such record zz'; i.dispatchEvent(new Event('input')); })()`);
    await waitFor(`document.querySelector('.opm-lookup__count').textContent === 'No records match these filters.'`, 5000);
    check(`LU @${width}: no match says so, and shows no table`, (await luCount()) === 'No records match these filters.' && (await evaluate(`document.querySelector('.opm-lookup__scroll').hidden`)) === true, await luCount());
    await evaluate(`document.querySelector('.opm-lookup__clear').click()`);

    // Employees, September 2025, counted by component
    await luSet('.opm-field--dataset select', 'employment'); await luWait('employment_FY2025').then(async ok => { if (!ok) { await luSet('.opm-field--snapshot select', 'employment_FY2025'); await luWait('employment_FY2025'); } });
    if ((await evaluate('OPM.page.loaded')) !== 'employment_FY2025') { await luSet('.opm-field--snapshot select', 'employment_FY2025'); await luWait('employment_FY2025'); }
    const emp = await evaluate(`({ count: document.querySelector('.opm-lookup__count').textContent, snap: document.querySelector('.opm-field--snapshot select').selectedOptions[0].textContent,
      groups: [...document.querySelectorAll('.opm-lookup__group-table tr')].map(tr => [tr.firstChild.textContent, +tr.lastChild.textContent.replace(/,/g, '')]),
      heads: [...document.querySelectorAll('.opm-lookup__table thead th')].map(th => th.textContent)[0], snapVisible: !document.querySelector('.opm-field--snapshot').hidden })`);
    const names = JSON.parse(readFileSync(path.join(WEB, 'copy.json'), 'utf8')).components;
    const byName = Object.fromEntries(emp.groups);
    const compOk = meta.entities.filter(e => e !== 'DOJ').every(e => (fy25core[e] || 0) === (byName[names[e]] || 0));
    check(`LU @${width}: Employees as of September 2025, counted by component: total 112,540 = doj_core FY2025, and every component equals the cube`,
      emp.count === '112,540 matching records' && fy25core.DOJ === 112540 && emp.snapVisible && emp.snap === 'September 2025 (end of FY2025)' && emp.heads === 'As of' && compOk &&
      emp.groups.reduce((a, g) => a + g[1], 0) === 112540, JSON.stringify({ emp, fy25core }).slice(0, 900));
    const fetched = await evaluate(`performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/data/lookup/')).map(n => n.split('/').pop().split('?')[0])`);
    check(`LU @${width}: one file per choice: separations, then employment_FY2025 (the latest snapshot file was the default)`, fetched[0] === 'separations.parquet' && fetched.includes('employment_FY2025.parquet') &&
      fetched.every(n => /^(separations|employment_(FY\d{4}|latest))\.parquet$/.test(n)), fetched.join(','));
    await shot(path.join(SCREENS, `workforce-lookup-employees-sep2025-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-lookup'].add(k));
    const errs = errorsNow();
    check(`LU @${width}: no console errors or warnings`, errs.length === 0, errs.join(' | '));
  }
  // sorting and paging at 1280
  await viewport(1280);
  await go(LU_URL); await waitFor(READY, 20000); await luWait('separations');
  await evaluate(`document.querySelector('.opm-compare__sort[data-col="pay"]').click()`);
  const s1 = await evaluate(`[...document.querySelectorAll('.opm-lookup__table tbody tr')].map(tr => tr.children[16].textContent)`);
  const nums = s1.map(v => +v);
  check('LU sort by annual pay: ascending numbers first', nums.every((v, i) => i === 0 || nums[i - 1] <= v) && (await evaluate(`document.querySelector('[data-col="pay"]').parentElement.getAttribute('aria-sort')`)) === 'ascending', s1.slice(0, 5).join(','));
  await evaluate(`document.querySelector('[data-pager="next"]').click()`);
  check('LU paging: next shows page 2', (await evaluate(`document.querySelector('.opm-lookup__page').textContent`)).startsWith('Page 2 of'));
  await evaluate(`document.querySelector('.opm-field--group select').value = 'reason'; document.querySelector('.opm-field--group select').dispatchEvent(new Event('change'))`);
  const byReason = await evaluate(`[...document.querySelectorAll('.opm-lookup__group-table tr')].map(tr => +tr.lastChild.textContent.replace(/,/g, ''))`);
  check('LU count by reason: groups largest first, summing to the total', byReason.every((v, i) => i === 0 || byReason[i - 1] >= v) && byReason.reduce((a, v) => a + v, 0) === LMETA.files.separations.rows, byReason.join(','));
  const luDraft = await evaluate('OPM.shell.refreshDraft()');
  check('LU draft badge off after the interactions', luDraft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, luDraft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-lookup'].add(k));
  check('LU interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Job series filter (D-061 to D-063). Expected values from the Look-Up files (independent of the cubes) and the series cubes.
  const accRows = await readLookup('accessions'), emp25 = await readLookup('employment_FY2025'), empLatest = await readLookup('employment_latest');
  const cnt = (rows, f) => rows.filter(f).length;
  const inMonths = (r, a, b) => r.personnel_action_effective_date_yyyymm >= a && r.personnel_action_effective_date_yyyymm <= b;
  const CS = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_core_series.meta.json'), 'utf8')), LS = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving_series.meta.json'), 'utf8'));
  const seriesRows = (meta, e, g) => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, meta.files[e].path), 'utf8')); return f.rows.map(r => Object.fromEntries(f.columns.map((c, i) => [c, r[i]]))).filter(r => r.series_group === g); };
  const X = {
    att25: cnt(emp25, r => r.occupational_series_code === '0905'), attNow: cnt(empLatest, r => r.occupational_series_code === '0905'),
    ciHires: cnt(accRows, r => r.agency_subelement_code === 'DJ02' && r.occupational_series_code === '1811' && inMonths(r, '202508', '202607')),
    ciHiresPrior: cnt(accRows, r => r.agency_subelement_code === 'DJ02' && r.occupational_series_code === '1811' && inMonths(r, '202408', '202507')),
    ciDeps: cnt(sepRows, r => r.agency_subelement_code === 'DJ02' && r.occupational_series_code === '1811' && inMonths(r, '202508', '202607')),
    ciDepsPrior: cnt(sepRows, r => r.agency_subelement_code === 'DJ02' && r.occupational_series_code === '1811' && inMonths(r, '202408', '202507')),
    coNow: cnt(empLatest, r => r.occupational_series_code === '0007'), coBop: cnt(empLatest, r => r.occupational_series_code === '0007' && r.agency_subelement_code === 'DJ03'),
    attDeps25: cnt(sepRows, r => r.occupational_series_code === '0905' && inMonths(r, '202410', '202509'))
  };
  const ciLast = seriesRows(CS, 'DJ02', '1811').filter(r => r.grain === 'month').sort((a, b) => (a.period < b.period ? -1 : 1)).at(-1);
  X.ciRate = rate1(ciLast.attrition_a_num / ciLast.rate_a_den);
  // components with no attorneys at their own last month (not ranked, listed as "no employees in this job series")
  X.attNone = CS.entities.filter(e => e !== 'DOJ').filter(e => { if (!CS.series_groups_present[e].includes('0905')) return true;
    const m = seriesRows(CS, e, '0905').filter(r => r.grain === 'month').sort((a, b) => (a.period < b.period ? -1 : 1)).at(-1); return !m || !m.headcount; });
  const wlLos = seriesRows(LS, 'DOJ', '0905').filter(r => r.period === 'FY2025' && r.dimension === 'los' && !r.is_unknown).sort((a, b) => a.value_order - b.value_order)
    .map(r => r.rate_not_applicable ? 'not applicable: no employees in this group' : rate1(r.rate_num / r.rate_den) + ' \u00b7 ' + NUM.format(r.departures) + ' left');
  const wlLost = NUM.format(Math.round(seriesRows(CS, 'DOJ', '0905').find(r => r.grain === 'fy' && r.period === 'FY2025').years_of_service_lost));
  infos.push('series expected: ' + JSON.stringify(X));
  const pickSeries = (code, shown) => evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '${code}'; s.dispatchEvent(new Event('change')); })()`).then(() => waitFor(`OPM.page.shown === '${shown}'`, 30000));
  for (const width of [1280, 390]) {
    await viewport(width);
    // Workforce size, Attorneys, Yearly: FY2025 = the Sep 2025 headcount of series 0905
    await go(base + 'index.html'); await waitFor(READY);
    const opts = await evaluate(`[...document.querySelectorAll('.opm-field--series option')].map(o => o.value + '=' + o.textContent)`);
    check(`JS @${width}: the Job series control: All job series, the 15 in D-062 order as "Name (code)", All other job series; next to Component`,
      opts[0] === 'all=All job series' && opts[1] === '0905=Attorneys (0905)' && opts[2] === '1811=Criminal investigators (1811)' && opts[15] === '7404=Cooks (7404)' && opts[16] === 'other=All other job series' && opts.length === 17 &&
      (await evaluate(`document.querySelector('.opm-field--component').nextElementSibling.classList.contains('opm-field--series')`)), opts.join(' | '));
    await pickSeries('0905', 'DOJ:0905');
    const ws = await evaluate(`(() => { const c = OPM.page.frames.headcount.chart; return { fy25: c.data.datasets[0].data[c.data.labels.indexOf('FY2025')], tile: document.querySelector('.opm-tile__value').textContent,
      bars: OPM.page.frames.ranking.chart.data.datasets[0].data, labels: OPM.page.frames.ranking.chart.data.labels, none: OPM.page.data().noneEntities }; })()`);
    check(`JS WS @${width}: Attorneys: FY2025 = ${NUM.format(X.att25)} (Sep 2025 attorneys in the Look-Up); Employees tile = ${NUM.format(X.attNow)}; components' bars sum to it`,
      ws.fy25 === X.att25 && ws.tile === NUM.format(X.attNow) && ws.bars.reduce((a, v) => a + v, 0) === X.attNow && JSON.stringify(ws.none) === JSON.stringify(X.attNone), JSON.stringify({ ws, attNone: X.attNone }));
    await pickSeries('0007', 'DOJ:0007');
    const wsCo = await evaluate(`({ labels: OPM.page.frames.ranking.chart.data.labels, none: [...document.querySelectorAll('.opm-series-list li')].map(li => li.textContent) })`);
    check(`JS WS @${width}: Correctional officers: only BOP ranked; the other components listed as "no employees in this job series"`,
      wsCo.labels.join() === 'BOP' && wsCo.none.length === 11 && wsCo.none.every(t => t.endsWith('no employees in this job series')), JSON.stringify(wsCo));
    await pickSeries('0905', 'DOJ:0905');
    await shot(path.join(SCREENS, `job-series-workforce-size-attorneys-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-size'].add(k));
    const e1 = errorsNow(); check(`JS WS @${width}: no console errors`, e1.length === 0, e1.join(' | '));

    // Hiring and departures, Criminal investigators at FBI
    await go(base + 'hiring-and-departures.html'); await waitFor(READY);
    await setEntity('DJ02'); await waitFor(`OPM.page.shown === 'DJ02:all'`);
    await pickSeries('1811', 'DJ02:1811');
    const hd = await hdTiles();
    check(`JS HD @${width}: FBI criminal investigators: hires ${NUM.format(X.ciHires)} (${NUM.format(X.ciHiresPrior)}), departures ${NUM.format(X.ciDeps)} (${NUM.format(X.ciDepsPrior)}) as in the Look-Up; rate ${X.ciRate}`,
      hd[0].value === NUM.format(X.ciHires) && hd[0].subs[0] === 'Year before: ' + NUM.format(X.ciHiresPrior) && hd[1].value === NUM.format(X.ciDeps) &&
      hd[1].subs[0] === 'Year before: ' + NUM.format(X.ciDepsPrior) && hd[2].value === X.ciRate, JSON.stringify(hd));
    infos.push(`JS HD @${width} FBI 1811: ` + hd.map(x => x.value + ' (' + x.subs[0] + ')').join('; '));
    await shot(path.join(SCREENS, `job-series-hiring-fbi-criminal-investigators-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['hiring-and-departures'].add(k));
    const e2 = errorsNow(); check(`JS HD @${width}: no console errors`, e2.length === 0, e2.join(' | '));

    // Components compared, Correctional officers: only BOP has staff
    await go(base + 'components-compared.html'); await waitFor(READY);
    check(`JS CC @${width}: the Job series control sits with the View control`, await evaluate(`document.querySelector('.opm-field--grain').nextElementSibling.classList.contains('opm-field--series')`));
    await pickSeries('0007', '0007');
    const cc = await evaluate(`({ rows: [...document.querySelectorAll('.opm-compare__table tbody tr')].map(tr => [...tr.children].map(c => c.textContent)),
      rank: OPM.page.frames.ranking.chart.data.labels, reasons: (OPM.page.frames.reasons.chart._opmDrawnLabels || []).filter(t => t === 'no employees in this job series').length,
      nobase: OPM.page.last.growthNoBase, notes: [...OPM.page.frames.growth.notes.querySelectorAll('p')].map(p => p.textContent),
      lines: OPM.page.frames.growth.chart.data.datasets.map(d => d.label) })`);
    const bop = cc.rows.find(r => r[0] === 'BOP'), others = cc.rows.filter(r => r[0] !== 'BOP' && r[0] !== 'Justice Department (all components)');
    check(`JS CC @${width}: Correctional officers: DOJ and BOP ${NUM.format(X.coNow)} employees (Jul 2026, as in the Look-Up); every other component "no employees in this job series", no rates; only BOP ranked`,
      cc.rows[0][1] === NUM.format(X.coNow) && bop[1] === NUM.format(X.coBop) && X.coBop === X.coNow && others.length >= 11 && others.every(r => r[1] === 'no employees in this job series' && r.length === 2) &&
      cc.rank.join() === 'BOP' && cc.reasons === others.length, JSON.stringify({ doj: cc.rows[0], bop, n: others.length, rank: cc.rank, reasons: cc.reasons }));
    check(`JS CC @${width}: growth: no line for components with no base, listed with the signed note`, cc.lines.join() === 'Justice Department overall,BOP' && cc.nobase.length === 11 &&
      cc.notes.includes('No line: no employees in this job series at the end of FY2012.'), JSON.stringify({ lines: cc.lines, nobase: cc.nobase, notes: cc.notes }));
    await shot(path.join(SCREENS, `job-series-components-correctional-officers-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-compared'].add(k));
    const e3 = errorsNow(); check(`JS CC @${width}: no console errors`, e3.length === 0, e3.join(' | '));

    // Who is leaving, Attorneys, FY2025
    await go(base + 'who-is-leaving.html'); await waitFor(WL_READY);
    await pickSeries('0905', 'DOJ:0905');
    await setPeriod('FY2025');
    const wl = await evaluate(`({ grain: OPM.page.state.grain, t12: document.querySelector('.opm-field--grain [data-value="t12"]').disabled, note: (document.querySelector('.opm-series-ytd') || {}).textContent,
      noteHidden: document.querySelector('.opm-series-ytd').hidden, occHidden: document.querySelector('[data-chart="leaving-occ"]').hidden,
      los: OPM.page.panels.find(p => p.dim.key === 'los').labels(), tiles: [...document.querySelectorAll('.opm-tile')].map(t => t.querySelector('.opm-tile__value').textContent) })`);
    check(`JS WL @${width}: Attorneys FY2025: Yearly only (Last 12 months disabled, with the note); occupation panel hidden; length-of-service bars equal doj_leaving_series`,
      wl.grain === 'fy' && wl.t12 === true && !wl.noteHidden && wl.note === 'Breakdowns by job series are available by fiscal year only.' && wl.occHidden === true && JSON.stringify(wl.los) === JSON.stringify(wlLos), JSON.stringify({ wl, wlLos }));
    check(`JS WL @${width}: Attorneys FY2025 tiles: ${NUM.format(X.attDeps25)} departures (the Look-Up count), years lost ${wlLost} from doj_core_series`, wl.tiles[0] === NUM.format(X.attDeps25) && wl.tiles[1] === wlLost, JSON.stringify(wl.tiles));
    await shot(path.join(SCREENS, `job-series-who-is-leaving-attorneys-fy2025-${width}.png`));
    await pickSeries('all', 'DOJ:all');
    check(`JS WL @${width}: back to All job series: Last 12 months enabled again, occupation panel back`, (await evaluate(`!document.querySelector('.opm-field--grain [data-value="t12"]').disabled && !document.querySelector('[data-chart="leaving-occ"]').hidden`)));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['who-is-leaving'].add(k));
    const e4 = errorsNow(); check(`JS WL @${width}: no console errors`, e4.length === 0, e4.join(' | '));
  }

  // ---- data not available
  for (const width of [1280, 390]) for (const [file, pageId] of Object.entries(DATA_PAGES)) {
    await viewport(width);
    await go(bareBase + file); await waitFor(READY);
    const u = await evaluate('({ un: !!(OPM.page && OPM.page.unavailable), text: (document.querySelector(".opm-unavailable") || {}).textContent, charts: document.querySelectorAll("canvas").length })');
    check(`no data ${file} @${width}: page shows "Data not available." and no charts`, u.un && u.text === 'Data not available.' && u.charts === 0, JSON.stringify(u));
    const errs = errorsNow(/404.*\/data\/(doj_(core|leaving)|lookup)/);
    check(`no data ${file} @${width}: no errors besides the 404s for the data files`, errs.length === 0, errs.join(' | '));
    if (width === 1280 && file === 'index.html') await shot(path.join(SCREENS, 'workforce-size-no-data-1280.png'));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed[pageId].add(k));
  }

  // ---- Framer height reporter (the LIONS reporter, ported under D-060), framed in a stand-in for the LIONS embed
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(base + 'tests/embed-harness.html');
    await waitFor('window.__lions.length > 0', 10000);
    await sleep(1200);
    const hr = await evaluate(`(() => { const f = document.getElementById('f'); const inner = f.contentDocument.getElementById('page');
      return { lions: window.__lions.length, last: window.__lions.at(-1), opm: window.__opm.at(-1), content: Math.ceil(inner.getBoundingClientRect().bottom), frame: Math.round(f.getBoundingClientRect().height) }; })()`);
    check(`height reporter @${width}: the LIONS embed message (lions-dashboard-height) sizes the frame to the content; opm:height carries the same height`,
      hr.lions > 0 && Math.abs(hr.last - hr.content) <= 1 && Math.abs(hr.frame - hr.last) <= 1 && hr.opm && hr.opm.height === hr.last && hr.opm.page === 'workforce-size', JSON.stringify(hr));

    // it SHRINKS: the Look-Up with all departures, then a search with no results
    await go(base + 'tests/embed-harness.html?page=workforce-lookup.html');
    await waitFor(`(() => { const w = document.getElementById('f').contentWindow; return w.OPM && w.OPM.page && w.OPM.page.loaded === 'separations'; })()`, 20000);
    await sleep(1500);
    const before = await evaluate(`({ h: window.__lions.at(-1), frame: Math.round(document.getElementById('f').getBoundingClientRect().height) })`);
    await evaluate(`(() => { const d = document.getElementById('f').contentDocument; const i = d.querySelector('.opm-field--search input'); i.value = 'zz no such record zz'; i.dispatchEvent(new Event('input')); })()`);
    await waitFor(`window.__lions.at(-1) < ${before.h}`, 6000);
    await sleep(1200);
    const after = await evaluate(`(() => { const f = document.getElementById('f'); const inner = f.contentDocument.getElementById('page');
      return { h: window.__lions.at(-1), frame: Math.round(f.getBoundingClientRect().height), content: Math.ceil(inner.getBoundingClientRect().bottom),
        count: f.contentDocument.querySelector('.opm-lookup__count').textContent, opm: window.__opm.at(-1) }; })()`);
    check(`height reporter @${width}: the reported height shrinks when the content does (Look-Up, no results: ${before.h} -> ${after.h}), and the frame follows`,
      after.count === 'No records match these filters.' && after.h < before.h - 500 && Math.abs(after.h - after.content) <= 1 && Math.abs(after.frame - after.h) <= 1 &&
      after.opm.height === after.h && after.opm.page === 'workforce-lookup', JSON.stringify({ before, after }));
    infos.push(`height reporter @${width}: Look-Up ${before.h} px with all departures, ${after.h} px with no results`);
  }
  await viewport(1280);
  await go(base + 'index.html'); await waitFor('!!(window.OPM && OPM.shell.reporter)'); await sleep(500);
  check('height reporter unframed: posts to itself, as LIONS does, without error', (await evaluate('OPM.shell.reporter.isFramed()')) === false && errorsNow().length === 0, errorsNow().join(' | '));
  // the runtime copy lists (data and no-data runs together), for tests/copy-audit.test.js
  for (const [file, pageId] of Object.entries(DATA_PAGES).concat([['reading-the-data.html', 'reading-the-data']])) {
    const out = path.join(WEB, 'tests', 'runtime-copy-' + pageId + '.json');
    writeFileSync(out, JSON.stringify({ _note: 'Written by web/tests/smoke.mjs. Keys the page used at runtime, data and no-data runs together.',
      page: pageId, file, sourcesHash: audit.sourcesHash(file), used: [...runtimeUsed[pageId]].sort() }, null, 2) + '\n');
    infos.push('runtime copy list written: ' + runtimeUsed[pageId].size + ' keys -> ' + path.relative(REPO, out));
  }
} catch (e) {
  check('smoke run completed', false, e.stack || String(e));
} finally {
  try { ws && ws.close(); } catch {}
  cleanup();
}

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + r.detail)); }
for (const i of infos) console.log('INFO ' + i);
console.log(`\n${results.length - fail} of ${results.length} smoke checks pass${BASE_PATH ? ' under ' + PREFIX : ''}. Data: ${DATA_DIR} (served from a temp copy). Screenshots: ${SCREENS}`);
process.exit(fail ? 1 : 0);
