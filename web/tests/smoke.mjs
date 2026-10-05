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
// the three main pages (docs/pages/redesign.md, D-072), the old pages kept unchanged as history-*.html (shown inside
// "Explore full history"), and the Look-Up
const DATA_PAGES = { 'index.html': 'overview', 'departures.html': 'departures', 'components.html': 'components-view',
  'history-workforce-size.html': 'workforce-size', 'history-hiring-and-departures.html': 'hiring-and-departures', 'history-who-is-leaving.html': 'who-is-leaving',
  'history-components-compared.html': 'components-compared', 'workforce-lookup.html': 'workforce-lookup' };
const NAV_PAGES = { 'index.html': 1, 'departures.html': 1, 'components.html': 1, 'workforce-lookup.html': 1, 'reading-the-data.html': 1 }; // in the navigation
const MOVED = { 'hiring-and-departures.html': 'departures.html', 'who-is-leaving.html': 'departures.html', 'components-compared.html': 'components.html' }; // old addresses
const runtimeUsed = { 'overview': new Set(), 'departures': new Set(), 'components-view': new Set(), 'workforce-size': new Set(), 'hiring-and-departures': new Set(), 'who-is-leaving': new Set(), 'components-compared': new Set(), 'reading-the-data': new Set(), 'workforce-lookup': new Set() };
const LOOKUP_DIR = arg('--lookup-dir', path.join(REPO, 'warehouse', 'lookup')); // served as data/lookup/ (not yet promoted into web/data)
const SIGNED_PAGES = new Set([...Object.keys(DATA_PAGES), 'reading-the-data.html']); // pages whose strings are all signed
const rnd = n => Math.floor(Math.random() * n);
const PORT = 8765 + rnd(200), PORT_BARE = 9065 + rnd(200), DBG = 9322 + rnd(200);
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const PAGES = [...Object.keys(DATA_PAGES), 'reading-the-data.html'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// D-080: the seven reasons of every "Why people left" chart, DRP first, and the signed note under each
const DRP_SEVEN = ['sep_drp', 'sep_transfer_out_nondrp', 'sep_quit_nondrp', 'sep_retirement_nondrp', 'sep_rif_nondrp', 'sep_termination_nondrp', 'sep_other_nondrp'];
const DRP_LEGEND = 'DRP|Transfer out|Quit|Retirement|RIF|Termination: expired appointment or other|Other';
const DRP_NOTE = 'DRP departures are shown as their own reason and are not counted again under Quit, Retirement or the other reasons.';

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
const pctText = v => { const t = (v * 100).toFixed(1); return +t === 0 ? '0.0%' : (v > 0 ? '+' : '') + t + '%'; }; // never "-0.0%" (L-103)
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
/* the job series cubes and doj_admin (per entity, plus meta), served as they are staged */
for (const cube of ['doj_core_series', 'doj_leaving_series', 'doj_admin']) {
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
      check(`${tag}: shell rendered`, ready && info.navLinks === 5 && info.h1 && info.title.includes(info.h1), JSON.stringify(info) + ' ' + errorsNow().join(' | '));
      if (NAV_PAGES[p]) check(`${tag}: current page marked`, info.current.length === 1 && info.current[0] === p, info.current.join(','));
      else check(`${tag}: an old page opened directly marks the main page that holds it`, info.current.length === 1 && info.current[0] === { 'history-workforce-size.html': 'index.html', 'history-hiring-and-departures.html': 'departures.html',
        'history-who-is-leaving.html': 'departures.html', 'history-components-compared.html': 'components.html', 'workforce-lookup.html': 'workforce-lookup.html' }[p], info.current.join(','));
      check(`${tag}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
      if (SIGNED_PAGES.has(p)) check(`${tag}: draft badge off (every string the page uses is signed)`, !info.draft);
      else check(`${tag}: draft badge shown (stub text is unsigned)`, info.draft);
      if (p === 'index.html' || p === 'history-workforce-size.html') {
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
    await go(base + 'history-workforce-size.html'); await waitFor(READY);
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
  await go(base + 'history-workforce-size.html'); await waitFor(READY);
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
  const HD_URL = base + 'history-hiring-and-departures.html';
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
      drpVisible: OPM.page.frames.reasons.chart.isDatasetVisible(0), cols: OPM.page.frames.reasons.chart.data.datasets.map(d => d._col), types: OPM.page.frames.types.chart.data.datasets.map(d => d.label),
      rates: OPM.page.frames.rates.chart.data.datasets.map(d => d.label), legend: [...document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')].map(b => b.textContent) })`);
    check(`HD FY/DOJ @${width}: panels 2, 3, 5 and the rate lines; seven stacked reasons, DRP first, no DRP line (D-080)`, pn.flows === 15 &&
      pn.legend.join('|') === 'DRP|Transfer out|Quit|Retirement|RIF|Termination: expired appointment or other|Other' &&
      pn.reasons.every(x => x.endsWith(':bar')) && pn.reasons.length === 7 && pn.cols.join() === DRP_SEVEN.join() && pn.drpVisible && pn.types.join('|') === 'New hire|Transfer in' &&
      pn.rates.join('|') === 'Departure rate (all reasons)|Quit rate|Retirement rate', JSON.stringify(pn));
    const n3 = await hdNotes('reasons');
    check(`HD FY/DOJ @${width}: the D-080 DRP note under panel 3, replacing the old one`, n3[0] === DRP_NOTE && !n3.some(x => x.startsWith('DRP departures are already counted')), n3.join(' | '));
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
  const drp = await evaluate(`(() => { const b = document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')[0]; b.click(); return { p: b.getAttribute('aria-pressed'), v: OPM.page.frames.reasons.chart.isDatasetVisible(0) }; })()`);
  check('HD the DRP segment toggles off from the legend', drp.p === 'false' && drp.v === false, JSON.stringify(drp));
  await evaluate(`document.querySelectorAll('[data-chart="why-people-left"] .opm-key__item')[0].click()`); // back on
  for (const g of ['month', 'fy']) {
    await setGrain(g);
    // each stacked segment is the cube column; the seven stack to departures in every period (D-080)
    const exp = DRP_SEVEN.map(c => rowsOf('DOJ', g).map(r => r[col(c)])), deps = rowsOf('DOJ', g).map(r => r[col('departures')]);
    const iLast = await evaluate(`OPM.page.frames.reasons.chart.data.labels.length - 1`);
    const got = await evaluate(`(() => { const c = OPM.page.frames.reasons.chart, ds = c.data.datasets, i = c.data.labels.length - 1;
      const spec = OPM.svgExport.fromChart(c, {});
      c.tooltip.setActiveElements(ds.map((d, k) => ({ datasetIndex: k, index: i })), { x: 0, y: 0 }); c.update();
      const tip = (c.tooltip.dataPoints || []).map(p => p.dataset.label);
      c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update(); // close it again before the screenshot
      return { data: ds.map(d => d.data), svg: spec.series.map(x => x.label + ':' + x.kind + ':' + x.bars.filter(Boolean).length), tip }; })()`);
    const okData = got.data.every((d, k) => d.length === exp[k].length && d.every((v, i) => v === exp[k][i]));
    const okSum = deps.every((v, i) => got.data.reduce((a, d) => a + d[i], 0) === v);
    check(`HD reasons (${g}): seven stacked segments equal the cube columns and sum to departures in every period; DRP is in the SVG export and the tooltip`,
      okData && okSum && got.svg.length === 7 && got.svg[0].startsWith('DRP:bar:') && got.tip[0] === 'DRP' && got.tip.length === 7,
      JSON.stringify({ okData, okSum, svg: got.svg, tip: got.tip, iLast }));
  }
  await setGrain('fy');
  const tensions = await evaluate(`(() => { const out = []; for (const f of Object.values(OPM.page.frames)) f.chart.data.datasets.filter(d => d.type === 'line' || f.chart.config.type === 'line').forEach(d => out.push(d.tension)); return out; })()`);
  check('HD every line has tension 0 (straight segments); the three rate lines (no DRP line since D-080)', tensions.length >= 3 && tensions.every(t => t === 0), tensions.join(','));
  await shot(path.join(SCREENS, 'hiring-and-departures-fy-doj-1280.png'));
  const hsv = await evaluate(`(() => { const out = {}; for (const [k, f] of Object.entries(OPM.page.frames)) { const d = new DOMParser().parseFromString(f.svg(), 'image/svg+xml');
      out[k] = { ok: !d.querySelector('parsererror'), rects: d.querySelectorAll('rect').length, paths: d.querySelectorAll('path').length, name: f.fileName() }; } return out; })()`);
  const hdReasonsSvg = await evaluate(`OPM.page.frames.reasons.svg()`);
  check('HD SVG export of the reasons: DRP in the legend and the D-080 note under the chart', hdReasonsSvg.includes('>DRP<') && hdReasonsSvg.includes('>' + DRP_NOTE + '<'),
    hdReasonsSvg.length + ' chars');
  check('HD SVG export: all four charts parse; reasons carry the seven stacked reasons', Object.values(hsv).every(x => x.ok) && hsv.reasons.rects > 60 &&
    hsv.rates.paths >= 3 && hsv.flows.name === 'opm-hires-vs-departures-DOJ-fy.svg' && hsv.rates.name === 'opm-rates-DOJ-fy-a.svg', JSON.stringify(hsv));
  const hdDraft = await evaluate('OPM.shell.refreshDraft()');
  check('HD draft badge off after the interactions', hdDraft.length === 0 && (await evaluate('document.querySelector(".opm-brand__draft").hidden')) === true, hdDraft.join(','));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['hiring-and-departures'].add(k));
  check('HD interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- Who is leaving
  const WL_URL = base + 'history-who-is-leaving.html';
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
    check(`WL t12/DOJ @${width}: View offers Yearly, Last 12 months and By administration, Last 12 months on; latest period; no range or rate control`,
      st.grain === 't12' && st.entity === 'DOJ' && st.period === '2026-07' && st.view.join('|') === 'Yearly|Last 12 months|By administration' && st.on === 'Last 12 months' &&
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
  const CC_URL = base + 'history-components-compared.html';
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
    const r25 = rowsOf('DOJ', 'fy').find(r => r[col('period')] === 'FY2025');
    const cr = await evaluate(`(() => { const c = OPM.page.frames.reasons.chart, d = c.data.datasets; const svg = OPM.page.frames.reasons.svg();
      return { legend: d.map(x => x.label).join('|'), cols: d.map(x => x._col), doj: d.map(x => x.data[0]), notes: [...OPM.page.frames.reasons.notes.querySelectorAll('p')].map(p => p.textContent),
        svgDrp: svg.includes('>DRP<'), svgNote: svg.includes(${JSON.stringify('>' + DRP_NOTE + '<')}) }; })()`);
    check(`CC FY2025 @${width}: seven reasons, DRP first; DOJ's shares are the cube's seven columns over departures; D-080 note on screen and in the SVG`,
      cr.legend === DRP_LEGEND && cr.cols.join() === DRP_SEVEN.join() && cr.doj.every((v, i) => v === r25[col(DRP_SEVEN[i])] / r25[col('departures')]) && cr.doj[0] > 0 &&
      cr.notes.includes(DRP_NOTE) && cr.svgDrp && cr.svgNote, JSON.stringify(cr));
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
    check(`RD @${width}: the DRP paragraph is the D-083 wording`, rd.paras.includes('Deferred Resignation Program (DRP): OPM flags departures under the program from March 2025. In the reasons charts they are shown as their own reason and are not counted again under Quit, Retirement or the other reasons; the tiles and rate lines still count them under their original reason.') &&
      !rd.paras.some(t => t.includes('extra line, not a separate reason')), rd.paras.filter(t => t.includes('DRP')).join(' | '));
    check(`RD @${width}: reasons table from the signed labels and the split descriptions; no charts, no data read`,
      JSON.stringify(rd.reasons) === JSON.stringify([['Transfer out', 'individual and mass transfers to another agency'], ['Quit', ''], ['Retirement', 'voluntary, early and other retirements'],
        ['RIF', 'reduction in force'], ['Termination: expired appointment or other', ''], ['Other', '']]) && rd.charts === 0 && !rd.data, JSON.stringify(rd.reasons));
    const sc = await evaluate(noScroll);
    check(`RD @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
    await shot(path.join(SCREENS, `reading-the-data-${width}.png`));
    // the Workforce size link lands on the known-gaps heading
    await go(base + 'history-workforce-size.html'); await waitFor(READY);
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
    await go(base + 'history-workforce-size.html'); await waitFor(READY);
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
    await go(base + 'history-hiring-and-departures.html'); await waitFor(READY);
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
    await go(base + 'history-components-compared.html'); await waitFor(READY);
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
    await go(base + 'history-who-is-leaving.html'); await waitFor(WL_READY);
    await pickSeries('0905', 'DOJ:0905');
    await setPeriod('FY2025');
    const wl = await evaluate(`({ grain: OPM.page.state.grain, t12: document.querySelector('.opm-field--grain [data-value="t12"]').disabled, note: (document.querySelector('.opm-series-ytd') || {}).textContent,
      noteHidden: document.querySelector('.opm-series-ytd').hidden, occHidden: document.querySelector('[data-chart="leaving-occ"]').hidden,
      los: OPM.page.panels.find(p => p.dim.key === 'los').labels(), tiles: [...document.querySelectorAll('.opm-tile')].map(t => t.querySelector('.opm-tile__value').textContent) })`);
    check(`JS WL @${width}: Attorneys FY2025: Yearly only (Last 12 months disabled, with the note); occupation panel hidden; length-of-service bars equal doj_leaving_series`,
      wl.grain === 'fy' && wl.t12 === true && !wl.noteHidden && wl.note === 'Breakdowns by job series are available by fiscal year or by administration.' && wl.occHidden === true && JSON.stringify(wl.los) === JSON.stringify(wlLos), JSON.stringify({ wl, wlLos }));
    check(`JS WL @${width}: Attorneys FY2025 tiles: ${NUM.format(X.attDeps25)} departures (the Look-Up count), years lost ${wlLost} from doj_core_series`, wl.tiles[0] === NUM.format(X.attDeps25) && wl.tiles[1] === wlLost, JSON.stringify(wl.tiles));
    await shot(path.join(SCREENS, `job-series-who-is-leaving-attorneys-fy2025-${width}.png`));
    await pickSeries('all', 'DOJ:all');
    const back = await evaluate(`({ grain: OPM.page.state.grain, on: document.querySelector('.opm-field--grain [aria-checked=true]').dataset.value, period: OPM.page.state.period,
      t12: !document.querySelector('.opm-field--grain [data-value="t12"]').disabled, occ: !document.querySelector('[data-chart="leaving-occ"]').hidden })`);
    check(`JS WL @${width}: back to All job series: the reader's View (Last 12 months) returns, enabled, with the latest period; occupation panel back`,
      back.grain === 't12' && back.on === 't12' && back.period === '2026-07' && back.t12 && back.occ, JSON.stringify(back));
    // the fallback path: the series files fail (404); the page returns to All job series AND to the reader's View
    await go(base + 'history-who-is-leaving.html'); await waitFor(WL_READY);
    await evaluate(`(() => { const f = window.fetch; window.fetch = (u, o) => /_series/.test(String(u)) ? Promise.resolve(new Response('', { status: 404 })) : f(u, o); })()`);
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0905'; s.dispatchEvent(new Event('change')); })()`);
    await waitFor(`OPM.page.shown === 'DOJ:all' && document.querySelector('.opm-field--series select').value === 'all' && !document.querySelector('.opm-series-none').hidden`, 10000);
    const fb = await evaluate(`({ series: document.querySelector('.opm-field--series select').value, grain: OPM.page.state.grain, on: document.querySelector('.opm-field--grain [aria-checked=true]').dataset.value,
      period: OPM.page.state.period, t12: !document.querySelector('.opm-field--grain [data-value="t12"]').disabled, note: document.querySelector('.opm-series-none').textContent,
      ytdHidden: document.querySelector('.opm-series-ytd').hidden })`);
    check(`JS WL @${width}: series files 404: back to All job series and to Last 12 months, with "Data not available."`,
      fb.series === 'all' && fb.grain === 't12' && fb.on === 't12' && fb.period === '2026-07' && fb.t12 && fb.note === 'Data not available.' && fb.ytdHidden, JSON.stringify(fb));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['who-is-leaving'].add(k));
    const e4 = errorsNow(); check(`JS WL @${width}: no console errors`, e4.length === 0, e4.join(' | '));
  }


  // ---- Administrations (docs/pages/administrations.md; D-065 to D-068). Expected values straight from the staged doj_admin and doj_leaving files.
  const AMETA = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_admin.meta.json'), 'utf8'));
  const admCache = {};
  const admRows = e => admCache[e] || (admCache[e] = (() => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, AMETA.files[e].path), 'utf8')); return f.rows.map(r => Object.fromEntries(f.columns.map((c, i) => [c, r[i]]))); })());
  const admAt = (e, g, a, n) => admRows(e).find(r => r.series_group === g && r.administration === a && r.months_in_office === n);
  const admMax = (e, g, a) => Math.max(0, ...admRows(e).filter(r => r.series_group === g && r.administration === a).map(r => r.months_in_office));
  const ANAME = { obama2: 'Obama II', trump1: 'Trump I', biden: 'Biden', trump2: 'Trump II' };
  const expAdmin = (e, g, ids, n) => ids.map(a => { const r = admAt(e, g, a, n); return { id: a, name: ANAME[a], change: signed(r.headcount_change), pct: pctText(r.headcount_change / r.headcount_0),
    hires: r.hires, departures: r.departures, rate: rate1(r.attrition_num / r.rate_den), quit: rate1(r.quit_num / r.rate_den), retirement: rate1(r.retirement_num / r.rate_den), raw: r.attrition_num / r.rate_den }; });
  const DEF = ['trump1', 'biden', 'trump2']; // the default set, in time order (Trump II with Biden and Trump I)
  const N0 = admMax('DOJ', 'all', 'trump2');
  const EXP_ADM = expAdmin('DOJ', 'all', DEF, N0);
  infos.push('Compare administrations, DOJ, first ' + N0 + ' months: ' + EXP_ADM.map(x => `${x.name} ${x.change} (${x.pct}), hires ${NUM.format(x.hires)}, departures ${NUM.format(x.departures)}, rate ${(x.raw * 100).toFixed(2)}%`).join('; '));
  // the figures the coordinator set for the data through Jul 2026 (L-089)
  const SET_L089 = { trump2: ['-10,048', '-8.6%', 11343, 20461, '11.67'], biden: ['-552', '-0.5%', 15817, 15191, '8.23'], trump1: ['-3,702', '-3.1%', 9861, 12950, '7.07'] };
  if (AMETA.range.last_month === '2026-07') check('administrations: the staged doj_admin gives the L-089 figures (DOJ, first 19 months)', N0 === 19 && EXP_ADM.every(x => { const w = SET_L089[x.id];
    return x.change === w[0] && x.pct === w[1] && x.hires === w[2] && x.departures === w[3] && (x.raw * 100).toFixed(2) === w[4]; }), JSON.stringify(EXP_ADM));
  const PANEL = '[data-chart="compare-administrations"]';
  const panelState = () => evaluate(`(() => { const p = document.querySelector('${PANEL}'); const A = OPM.page.admin;
    const tbl = cls => [...p.querySelectorAll('.' + cls + ' tbody tr')].map(tr => [...tr.children].map(c => c.textContent));
    const vis = e => !e.closest('[hidden]');
    return { hidden: p.hidden, title: p.querySelector('h2').textContent, checked: [...p.querySelectorAll('.opm-check__box')].filter(b => b.checked).map(b => b.value),
      names: [...p.querySelectorAll('.opm-check')].map(l => l.textContent), legend: p.querySelector('legend').textContent,
      label: p.querySelector('.opm-field--months label').textContent, months: p.querySelector('.opm-admin__months').textContent, max: +p.querySelector('input[type=range]').max, value: +p.querySelector('input[type=range]').value,
      note: p.querySelector('.opm-field--months .opm-field__note').textContent, capped: p.querySelector('.opm-admin__capped').hidden ? null : p.querySelector('.opm-admin__capped').textContent,
      heads: [...p.querySelectorAll('.opm-chart--sub h3')].filter(vis).map(h => h.textContent), change: tbl('opm-admin__table--change'), rate: tbl('opm-admin__table--rate'),
      small: p.querySelectorAll('.opm-admin__table--rate .opm-admin__small').length, changeSmall: p.querySelectorAll('.opm-admin__table--change .opm-admin__small').length, flows: A.last.flows || null, reasons: A.last.reasons || null, n: A.last.n, cap: A.last.cap,
      notes: [...p.querySelectorAll('.opm-chart__note')].filter(vis).map(n => n.textContent), none: p.querySelector('.opm-series-none').hidden ? null : p.querySelector('.opm-series-none').textContent,
      lines: A.frames.change ? A.frames.change.chart.data.datasets.map(d => d.label + ':' + d.data.length + ':' + d._dashIn.filter(Boolean).length) : null,
      reasonBars: A.frames.reasons.chart.data.labels, rateBars: A.frames.rate.chart.data.datasets[0].data, frames: Object.keys(A.frames) }; })()`);
  const panelWait = async prefix => { const ok = await waitFor(`!!(OPM.page && OPM.page.admin && OPM.page.admin.shown && OPM.page.admin.shown.startsWith('${prefix}'))`, 30000);
    if (!ok) throw new Error('the Compare administrations panel never showed ' + prefix + ' (' + (await evaluate('location.pathname + " " + (OPM.page && OPM.page.admin && OPM.page.admin.shown)')) + ')'); };
  const clickBox = id => evaluate(`document.querySelector('${PANEL} .opm-check__box[value="${id}"]').click()`);
  const setN = n => evaluate(`(() => { const r = document.querySelector('${PANEL} input[type=range]'); r.value = '${n}'; r.dispatchEvent(new Event('input')); })()`);
  const panelShot = async file => { await sleep(250); const b = await evaluate(`(() => { const r = document.querySelector('${PANEL}').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, w: document.documentElement.clientWidth, h: r.height }; })()`);
    const m = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: b.x, y: Math.max(0, b.y - 8), width: b.w, height: Math.ceil(b.h + 16), scale: 1 } }); writeFileSync(file, Buffer.from(m.data, 'base64')); };
  const changeRows = ex => ex.map(x => [x.name, x.change, x.pct]);
  const rateRows = ex => ex.map(x => [x.name, x.rate, x.quit, x.retirement]);
  const defaultsOk = (ps, ex, n, withFlows) => ps.checked.join() === DEF.join() && ps.changeSmall === 0 && ps.small === 0 && ps.n === n && ps.value === n && ps.max === n && ps.months === `First ${n} months in office` &&
    ps.capped === `Limited to ${n} months: the shortest administration chosen.` && JSON.stringify(ps.rate) === JSON.stringify(rateRows(ex)) &&
    (!withFlows || (JSON.stringify(ps.change) === JSON.stringify(changeRows(ex)) && JSON.stringify(ps.flows.map(f => [f.hires, f.departures])) === JSON.stringify(ex.map(x => [x.hires, x.departures])))) &&
    ps.notes.includes("Trump II's newest three months are provisional.") && ps.notes.includes('Rates over an administration are annualized: departures per year, as a share of the average number of employees.') &&
    ps.rateBars.map(v => v.toFixed(6)).join() === ex.map(x => x.raw.toFixed(6)).join() && reasonsOk(ps, n);
  // D-080: the panel's reasons are the seven, DRP first, each the doj_admin column over departures; only Trump II has DRP; the note shows
  const reasonsOk = (ps, n) => ps.notes.includes(DRP_NOTE) && ps.reasons.length === DEF.length && ps.reasons.every(x => { const r = admAt('DOJ', 'all', x.id, n);
    return x.shares.length === 7 && x.shares.every((v, i) => v === r[DRP_SEVEN[i]] / r.departures) && (x.id === 'trump2' ? x.shares[0] > 0 : x.shares[0] === 0); });
  {
    // the coordinator's figures for D-080 (data through Jul 2026): DOJ, Trump II, first 19 months
    const r = admAt('DOJ', 'all', 'trump2', 19), want = [3030, 1424, 6739, 7490, 81, 408, 1289];
    if (AMETA.range.last_month === '2026-07') check('D-080: DOJ Trump II first 19 months: DRP 3,030; transfer out 1,424; quit 6,739; retirement 7,490; RIF 81; termination 408; other 1,289; total 20,461',
      DRP_SEVEN.every((c, i) => r[c] === want[i]) && r.departures === 20461 && want.reduce((a, v) => a + v, 0) === 20461, JSON.stringify(DRP_SEVEN.map(c => r[c])));
  }
  for (const width of [1280, 390]) {
    await viewport(width);
    // Workforce size: presets, then the panel
    await go(base + 'history-workforce-size.html'); await waitFor(READY); await panelWait('DOJ:all:');
    const pr = await evaluate(`(() => { const f = document.querySelector('.opm-field--presets'); return { label: f.querySelector('.opm-field__name').textContent, buttons: [...f.querySelectorAll('.opm-choice')].map(b => b.textContent),
      under: f.getBoundingClientRect().top >= document.querySelector('.opm-range select').getBoundingClientRect().bottom - 1 }; })()`);
    check(`ADM WS @${width}: preset row "Administration": Obama II, Trump I, Biden, Trump II, All, under From and To`, pr.label === 'Administration' && pr.buttons.join('|') === 'Obama II|Trump I|Biden|Trump II|All' && pr.under, JSON.stringify(pr));
    const ranges = {};
    for (const [i, id] of ['obama2', 'trump1', 'biden', 'trump2', 'all'].entries()) {
      await evaluate(`document.querySelectorAll('.opm-field--presets .opm-choice')[${i}].click()`);
      ranges[id] = await evaluate(`(() => { const s = document.querySelectorAll('.opm-range select'); return [s[0].value, s[1].value, OPM.page.state.range.start, OPM.page.state.range.end,
        [...document.querySelectorAll('.opm-field--presets .opm-choice')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent).join()].join(' '); })()`);
    }
    check(`ADM WS @${width}: presets set From and To (Trump II and All end at the latest month) and mark the preset`, ranges.obama2 === '2013-01 2016-12 2013-01 2016-12 Obama II' && ranges.trump1 === '2017-01 2020-12 2017-01 2020-12 Trump I' &&
      ranges.biden === '2021-01 2024-12 2021-01 2024-12 Biden' && ranges.trump2 === '2025-01 2026-07 2025-01 2026-07 Trump II' && ranges.all === '2011-10 2026-07 2011-10 2026-07 All', JSON.stringify(ranges));
    await evaluate(`document.querySelectorAll('.opm-field--presets .opm-choice')[2].click()`);
    const tb = await tiles();
    check(`ADM WS @${width}: with Biden the reader can still adjust the range (From moves, the preset unmarks)`, await evaluate(`(() => { const s = document.querySelectorAll('.opm-range select')[0]; s.value = '2021-06'; s.dispatchEvent(new Event('change'));
      return OPM.page.state.range.start === '2021-06' && !document.querySelector('.opm-field--presets [aria-pressed="true"]'); })()`), JSON.stringify(tb[2]));
    await evaluate(`document.querySelectorAll('.opm-field--presets .opm-choice')[4].click()`);
    let ps = await panelState();
    check(`ADM WS @${width}: panel "Compare administrations" below the panels: the four to pick (default Trump II, Biden, Trump I), "Months in office" with the signed note`,
      !ps.hidden && ps.title === 'Compare administrations' && ps.legend === 'Administrations' && ps.names.join('|') === 'Obama II|Trump I|Biden|Trump II' && ps.label === 'Months in office' &&
      ps.note === 'Month 1 is January of the inauguration year. Change is measured from the end of the December before.' &&
      (await evaluate(`document.querySelector('${PANEL}').previousElementSibling.dataset.chart`)) === 'components-ranking', JSON.stringify(ps));
    check(`ADM WS @${width}: DOJ defaults, first ${N0} months: change, percent, hires, departures and annualized rates as in doj_admin`, defaultsOk(ps, EXP_ADM, N0, true), JSON.stringify(ps) + ' expect ' + JSON.stringify(EXP_ADM));
    check(`ADM WS @${width}: titles carry N; one line per administration over months 1 to ${N0}; Trump II's three provisional months dashed`,
      ps.heads.join('|') === `Change in employees since taking office|Hires and departures, first ${N0} months|Hires|Departures|Departure rate, first ${N0} months (annualized)|Why people left, first ${N0} months` &&
      ps.lines.join() === `Trump I:${N0}:0,Biden:${N0}:0,Trump II:${N0}:3` && ps.reasonBars.join() === 'Trump I,Biden,Trump II', JSON.stringify({ heads: ps.heads, lines: ps.lines, bars: ps.reasonBars }));
    infos.push(`ADM WS @${width} panel: change ${JSON.stringify(ps.change)}; rates ${JSON.stringify(ps.rate)}; flows ${JSON.stringify(ps.flows)}`);
    await panelShot(path.join(SCREENS, `administrations-compare-workforce-size-${width}.png`));
    await clickBox('trump2');
    ps = await panelState();
    check(`ADM WS @${width}: without Trump II the cap lifts to 48 (no capped note) and N stays ${N0}`, ps.max === 48 && ps.value === N0 && ps.capped === null && ps.checked.join() === 'trump1,biden', JSON.stringify(ps));
    await setN(48);
    ps = await panelState();
    const ex48 = expAdmin('DOJ', 'all', ['trump1', 'biden'], 48);
    check(`ADM WS @${width}: first 48 months = the whole terms of Trump I and Biden`, ps.n === 48 && JSON.stringify(ps.change) === JSON.stringify(changeRows(ex48)) && JSON.stringify(ps.rate) === JSON.stringify(rateRows(ex48)) &&
      ps.heads[1] === 'Hires and departures, first 48 months' && !ps.notes.includes("Trump II's newest three months are provisional."), JSON.stringify(ps) + ' expect ' + JSON.stringify(ex48));
    await clickBox('trump2');
    ps = await panelState();
    check(`ADM WS @${width}: Trump II again: N is capped back to ${N0}`, ps.n === N0 && ps.max === N0 && ps.capped !== null, JSON.stringify({ n: ps.n, max: ps.max, capped: ps.capped }));
    await shot(path.join(SCREENS, `administrations-workforce-size-${width}.png`));
    // the component and job series selectors apply
    await setEntity('DJ14'); await panelWait('DJ14:all:');
    const n14 = admMax('DJ14', 'all', 'trump2');
    ps = await panelState();
    check(`ADM WS @${width}: Community Relations Service: Trump II has ${n14} months, so N = ${n14}; figures from its doj_admin rows`, ps.n === n14 && ps.max === n14 && ps.capped === `Limited to ${n14} months: the shortest administration chosen.` &&
      JSON.stringify(ps.change) === JSON.stringify(changeRows(expAdmin('DJ14', 'all', DEF, n14))), JSON.stringify(ps));
    await pickSeries('0301', 'DJ14:0301'); await panelWait('DJ14:0301:');
    ps = await panelState();
    check(`ADM WS @${width}: CRS, series 0301: small-base rates flagged in the table and noted`, ps.small > 0 && ps.notes.includes('Based on fewer than 30 employees on average: read with care.') &&
      JSON.stringify(ps.rate.map(r => r.slice(1))) === JSON.stringify(rateRows(expAdmin('DJ14', '0301', DEF, ps.n)).map(r => r.slice(1))), JSON.stringify(ps));
    await pickSeries('1811', 'DJ14:1811'); await panelWait('DJ14:1811:');
    ps = await panelState();
    check(`ADM WS @${width}: CRS has no criminal investigators: the panel says "no employees in this job series" and draws nothing`, ps.none === 'no employees in this job series' && ps.heads.length === 0, JSON.stringify(ps));
    await pickSeries('all', 'DJ14:all'); await setEntity('DOJ'); await panelWait('DOJ:all:');
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-size'].add(k));
    let e0 = errorsNow(); check(`ADM WS @${width}: no console errors`, e0.length === 0, e0.join(' | '));

    // Hiring and departures: presets and the same panel
    await go(base + 'history-hiring-and-departures.html'); await waitFor(READY); await panelWait('DOJ:all:');
    await evaluate(`document.querySelectorAll('.opm-field--presets .opm-choice')[3].click()`);
    const hdr = await evaluate(`[OPM.page.state.range.start, OPM.page.state.range.end, OPM.page.frames.flows.chart.data.labels.at(-1)].join(' ')`);
    ps = await panelState();
    check(`ADM HD @${width}: Trump II preset sets Jan 2025 to Jul 2026; panel defaults match doj_admin`, hdr.startsWith('2025-01 2026-07') && defaultsOk(ps, EXP_ADM, N0, true), hdr + ' ' + JSON.stringify(ps));
    await setEntity('DJ14'); await panelWait('DJ14:all:'); await pickSeries('0301', 'DJ14:0301'); await panelWait('DJ14:0301:');
    await pickSeries('1811', 'DJ14:1811'); await panelWait('DJ14:1811:');
    await shot(path.join(SCREENS, `administrations-hiring-and-departures-${width}.png`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['hiring-and-departures'].add(k));
    e0 = errorsNow(); check(`ADM HD @${width}: no console errors`, e0.length === 0, e0.join(' | '));

    // Components compared: the administrations in the Period list; Biden
    await go(base + 'history-components-compared.html'); await waitFor(READY); await panelWait('DOJ:all:');
    await waitFor(`[...document.querySelectorAll('.opm-field--period option')].some(o => o.value === 'biden')`);
    const per = await evaluate(`[...document.querySelectorAll('.opm-field--period option')].map(o => o.value + '=' + o.textContent)`);
    check(`ADM CC @${width}: Period list: the fiscal years, then the four administrations (latest first), labeled with their months`, per[0].startsWith('FY2026') &&
      per.slice(-4).join('|') === 'trump2=Trump II (so far, Jan 2025 to Jul 2026)|biden=Biden (Jan 2021 to Dec 2024)|trump1=Trump I (Jan 2017 to Dec 2020)|obama2=Obama II (Jan 2013 to Dec 2016)' &&
      per.slice(0, -4).every(x => /^FY\d{4}=/.test(x)), per.join(' | '));
    ps = await panelState();
    check(`ADM CC @${width}: panel (DOJ) defaults match doj_admin`, defaultsOk(ps, EXP_ADM, N0, true), JSON.stringify(ps));
    await setPeriod('biden'); await waitFor(`OPM.page.shown === 'biden:all'`, 30000);
    const ccRow = e => { const r = admRows(e).find(x => x.series_group === 'all' && x.administration === 'biden' && x.months_in_office === x.admin_months);
      return [NUM.format(r.headcount_n), signed(r.headcount_change) + ' (' + pctText(r.headcount_change / r.headcount_0) + ')', NUM.format(r.hires), NUM.format(r.departures),
        rate1(r.attrition_num / r.rate_den), rate1(r.quit_num / r.rate_den), rate1(r.retirement_num / r.rate_den)]; };
    const cb = await evaluate(`({ rows: [...document.querySelectorAll('.opm-compare__table tbody tr')].map(tr => [...tr.children].map(c => c.textContent)), caption: document.querySelector('.opm-compare__caption').textContent,
      rateHidden: document.querySelector('.opm-field--rate').hidden, note: document.querySelector('.opm-admin__rate-note').hidden ? null : document.querySelector('.opm-admin__rate-note').textContent,
      tableNotes: [...document.querySelectorAll('[data-chart="table"] .opm-chart__note')].map(p => p.textContent), rank: OPM.page.frames.ranking.chart.data.labels.length,
      ref: [...OPM.page.frames.ranking.notes.querySelectorAll('p')].map(p => p.textContent), reasons: [...OPM.page.frames.reasons.notes.querySelectorAll('p')].map(p => p.textContent) })`);
    const fbi = cb.rows.find(r => r[0] === 'FBI');
    check(`ADM CC @${width}: Biden: DOJ and FBI rows are their doj_admin whole-window rows (N = 48); caption is the period; the rate selector gives way to the annualized note`,
      JSON.stringify(cb.rows[0].slice(1)) === JSON.stringify(ccRow('DOJ')) && JSON.stringify(fbi.slice(1)) === JSON.stringify(ccRow('DJ02')) && cb.caption === 'Biden (Jan 2021 to Dec 2024)' && cb.rateHidden &&
      cb.note === 'Rates over an administration are annualized: departures per year, as a share of the average number of employees.' &&
      cb.ref[0] === 'Justice Department overall: ' + ccRow('DOJ')[4] && cb.reasons[0] === "Share of each component's departures in Biden (Jan 2021 to Dec 2024)." && cb.rank >= 11,
      JSON.stringify(cb) + ' expect DOJ ' + JSON.stringify(ccRow('DOJ')));
    infos.push(`ADM CC @${width} Biden DOJ row: ${cb.rows[0].join(' | ')}`);
    await shot(path.join(SCREENS, `administrations-components-compared-biden-${width}.png`));
    await setGrain('quarter');
    const q = await evaluate(`({ period: OPM.page.state.period, last: [...document.querySelectorAll('.opm-field--period option')].slice(-4).map(o => o.value).join() })`);
    check(`ADM CC @${width}: at Quarterly the administrations are still listed and Biden stays chosen`, q.period === 'biden' && q.last === 'trump2,biden,trump1,obama2', JSON.stringify(q));
    await pickSeries('0905', 'biden:0905');
    const cs = await evaluate(`[...document.querySelector('.opm-compare__table tbody tr').children].map(c => c.textContent)`);
    const r9 = admRows('DOJ').find(x => x.series_group === '0905' && x.administration === 'biden' && x.months_in_office === 48);
    check(`ADM CC @${width}: Biden with Attorneys: DOJ row from the 0905 window row`, cs[1] === NUM.format(r9.headcount_n) && cs[3] === NUM.format(r9.hires) && cs[5] === rate1(r9.attrition_num / r9.rate_den), JSON.stringify(cs));
    await setPeriod('trump2'); await waitFor(`OPM.page.shown === 'trump2:0905'`, 30000);
    const c2 = await evaluate(`({ caption: document.querySelector('.opm-compare__caption').textContent, badge: !!document.querySelector('.opm-compare__caption .opm-tile__prov') })`);
    check(`ADM CC @${width}: Trump II: "so far" in the caption, provisional badge`, c2.caption === 'Trump II (so far, Jan 2025 to Jul 2026)' && c2.badge, JSON.stringify(c2));
    await pickSeries('all', 'trump2:all'); await setGrain('fy'); await setPeriod('FY2025');
    check(`ADM CC @${width}: back to a fiscal year: the rate selector returns`, await evaluate(`!document.querySelector('.opm-field--rate').hidden && document.querySelector('.opm-admin__rate-note').hidden`));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-compared'].add(k));
    e0 = errorsNow(); check(`ADM CC @${width}: no console errors`, e0.length === 0, e0.join(' | '));

    // Who is leaving: By administration
    await go(base + 'history-who-is-leaving.html'); await waitFor(WL_READY); await panelWait('DOJ:all:');
    const vb = await evaluate(`[...document.querySelectorAll('.opm-field--grain .opm-choice')].map(b => b.dataset.value + '=' + b.textContent + (b.disabled ? ':off' : ''))`);
    check(`ADM WL @${width}: View: Yearly, Last 12 months, By administration`, vb.join('|') === 'fy=Yearly|t12=Last 12 months|admin=By administration', vb.join('|'));
    await setGrain('admin');
    const wp = await evaluate(`({ opts: [...document.querySelectorAll('.opm-field--period option')].map(o => o.value + '=' + o.textContent), period: OPM.page.state.period })`);
    check(`ADM WL @${width}: By administration: the four administrations in time order; Trump II (so far) chosen`, wp.period === 'trump2' &&
      wp.opts.join('|') === 'obama2=Obama II (Jan 2013 to Dec 2016)|trump1=Trump I (Jan 2017 to Dec 2020)|biden=Biden (Jan 2021 to Dec 2024)|trump2=Trump II (so far, Jan 2025 to Jul 2026)', JSON.stringify(wp));
    await setPeriod('biden');
    const wlB = (() => { const los = lrows('DOJ', 'admin', 'biden', 'los'); const deps = los.reduce((a, r) => a + r[lc('departures')], 0);
      const m = rowsOf('DOJ', 'month').filter(r => r[col('period')] >= '2021-01' && r[col('period')] <= '2024-12');
      const lost = m.reduce((a, r) => a + r[col('years_of_service_lost')], 0), known = m.reduce((a, r) => a + r[col('yos_known')], 0);
      return { deps: NUM.format(deps), lost: NUM.format(Math.round(lost)), avg: (lost / known).toFixed(1), months: m.length,
        bars: los.filter(r => !r[lc('is_unknown')]).map(r => r[lc('rate_num')] === null ? '' : rate1(r[lc('rate_num')] / r[lc('rate_den')]) + ' · ' + NUM.format(r[lc('departures')]) + ' left') }; })();
    const wb = await evaluate(`({ tiles: [...document.querySelectorAll('.opm-tile')].map(t => ({ v: t.querySelector('.opm-tile__value').textContent, subs: [...t.querySelectorAll('.opm-tile__sub')].map(s => s.textContent).filter(Boolean) })),
      los: OPM.page.panels.find(p => p.dim.key === 'los').labels(), sets: OPM.page.frames.los.chart.data.datasets.map(d => d.label),
      notes: [...OPM.page.frames.los.notes.querySelectorAll('p')].map(p => p.textContent), trend: OPM.page.frames.losTrend.chart.data.labels })`);
    check(`ADM WL @${width}: Biden: departures ${wlB.deps} (admin grain), years lost ${wlB.lost} over its ${wlB.months} months; no year-before comparison`,
      wb.tiles[0].v === wlB.deps && wb.tiles[0].subs.length === 0 && wb.tiles[1].v === wlB.lost && wb.tiles[2].v === wlB.avg && wb.sets.join('|') === 'Biden (Jan 2021 to Dec 2024)', JSON.stringify(wb) + ' expect ' + JSON.stringify(wlB));
    check(`ADM WL @${width}: Biden: length-of-service bars are the annualized admin-grain rates, with the annualized note; the trend runs across the four administrations`,
      JSON.stringify(wb.los) === JSON.stringify(wlB.bars) && wb.notes.includes('Rates over an administration are annualized: departures per year, as a share of the average number of employees.') &&
      wb.trend.join('|') === 'Obama II|Trump I|Biden|Trump II', JSON.stringify(wb));
    ps = await panelState();
    check(`ADM WL @${width}: the panel shows the departure rate and why people left only; DOJ defaults match doj_admin`, ps.frames.join() === 'rate,reasons' &&
      ps.heads.join('|') === `Departure rate, first ${N0} months (annualized)|Why people left, first ${N0} months` && defaultsOk(ps, EXP_ADM, N0, false), JSON.stringify(ps));
    await shot(path.join(SCREENS, `administrations-who-is-leaving-biden-${width}.png`));
    await pickSeries('0905', 'DOJ:0905');
    const ws9 = await evaluate(`({ grain: OPM.page.state.grain, period: OPM.page.state.period, t12: document.querySelector('.opm-field--grain [data-value="t12"]').disabled,
      admin: document.querySelector('.opm-field--grain [data-value="admin"]').disabled, los: OPM.page.panels.find(p => p.dim.key === 'los').labels() })`);
    const LS9 = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving_series.meta.json'), 'utf8'));
    const ls9 = (() => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, LS9.files.DOJ.path), 'utf8')); const c = n => f.columns.indexOf(n);
      return f.rows.filter(r => r[c('series_group')] === '0905' && r[c('grain')] === 'admin' && r[c('period')] === 'biden' && r[c('dimension')] === 'los' && !r[c('is_unknown')]).sort((a, b) => a[c('value_order')] - b[c('value_order')])
        .map(r => r[c('rate_not_applicable')] ? 'not applicable: no employees in this group' : r[c('rate_num')] === null ? '' : rate1(r[c('rate_num')] / r[c('rate_den')]) + ' · ' + NUM.format(r[c('departures')]) + ' left'); })();
    check(`ADM WL @${width}: with Attorneys, By administration stays (Biden), Last 12 months is off; bars from the series admin grain`, ws9.grain === 'admin' && ws9.period === 'biden' && ws9.t12 && !ws9.admin &&
      JSON.stringify(ws9.los) === JSON.stringify(ls9), JSON.stringify({ ws9, ls9 }));
    await panelWait('DOJ:0905:');
    await setEntity('DJ14'); await waitFor(`OPM.page.shown === 'DJ14:0905'`, 30000); await panelWait('DJ14:0905:');
    await pickSeries('0301', 'DJ14:0301'); await panelWait('DJ14:0301:');
    await pickSeries('1811', 'DJ14:1811'); await panelWait('DJ14:1811:');
    await pickSeries('all', 'DJ14:all');
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['who-is-leaving'].add(k));
    e0 = errorsNow(); check(`ADM WL @${width}: no console errors`, e0.length === 0, e0.join(' | '));
  }

  // ---- Redesign (docs/pages/redesign.md; D-071, D-072): Overview, Departures, Components. Expected values straight from the staged files.
  // the component multi-select (D-078): "All components" resets, then each code is ticked
  const setComps = list => evaluate(`(() => { document.querySelector('.opm-multi__all').click(); ${JSON.stringify(list)}.forEach(v => document.querySelector('.opm-multi__opt[data-value="' + v + '"] input').click()); })()`);
  const RD_WAIT = prefix => waitFor(`!!(OPM.page && OPM.page.shown && OPM.page.shown.startsWith('${prefix}'))`, 30000).then(ok => { if (!ok) throw new Error('page never showed ' + prefix); });
  const rdTiles = () => evaluate(`[...document.querySelectorAll('.opm-tile')].map(t => ({ name: t.querySelector('.opm-tile__name').textContent, value: t.querySelector('.opm-tile__value').textContent,
    subs: [...t.querySelectorAll('.opm-tile__sub:not(.opm-tile__at)')].map(s => s.textContent), at: [...t.querySelectorAll('.opm-tile__at')].map(s => s.textContent), badge: !!t.querySelector('.opm-tile__prov') }))`);
  const clickCompare = id => evaluate(`document.querySelector('.opm-field--compare [data-admin="${id}"]').click()`);
  const N_DOJ = admMax('DOJ', 'all', 'trump2');
  const monLabel = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5) - 1] + ' ' + m.slice(0, 4);
  const AT = ['biden', 'trump1', 'obama2'];
  const chg = r => signed(r.headcount_change) + ' (' + pctText(r.headcount_change / r.headcount_0) + ')';
  const atLine = (id, text) => `${ANAME[id]} at this point: ${text}`;
  const shownMonths = (maxN, k, n) => { const out = []; for (let m = k; m <= maxN; m += k) out.push(m); if (!out.includes(n)) out.push(n); return out.sort((a, b) => a - b).map(String); };
  const bandsAt = expr => evaluate(`(() => { const c = ${expr}.chart; const L = c.data.labels; return c.options.plugins.opmAdminBands.bands.map(b => ({ id: b.id, label: b.label, x0: b.x0, x1: b.x1,
    start: L[Math.round(b.x0 + 0.5)], n: L.length })); })()`);
  const svgBands = expr => evaluate(`(() => { const d = new DOMParser().parseFromString(${expr}.svg(), 'image/svg+xml'); return { ok: !d.querySelector('parsererror'), bands: [...d.querySelectorAll('.opm-svg-band text')].map(t => t.textContent) }; })()`);
  const exploreCheck = async (tag, pages) => {
    const before = await evaluate(`({ expanded: OPM.page.explore.toggle.getAttribute('aria-expanded'), hidden: document.querySelector('.opm-explore__body').hidden, frames: document.querySelectorAll('.opm-explore__frame').length,
      title: OPM.page.explore.toggle.textContent, note: document.querySelector('.opm-explore__note').textContent })`);
    check(`${tag}: "Explore full history" collapsed by default (nothing framed until opened)`, before.expanded === 'false' && before.hidden && before.frames === 0 && before.title === 'Explore full history' &&
      before.note === 'Every chart from earlier versions of this page, with its own date and rate controls.', JSON.stringify(before));
    await evaluate('OPM.page.explore.toggle.click()');
    const ok = await waitFor(`OPM.page.explore.frames().length === ${pages.length} && OPM.page.explore.frames().every(f => { const w = f.contentWindow; return w.OPM && w.OPM.page && w.OPM.page.frames && w.OPM.page.ready !== false && Object.keys(w.OPM.page.frames).length && parseInt(f.style.height) > 600; })`, 40000);
    await sleep(800);
    const inner = await evaluate(`OPM.page.explore.frames().map(f => { const w = f.contentWindow, d = w.document; return { src: f.getAttribute('src'), page: d.body.dataset.page, h: parseInt(f.style.height), content: Math.ceil(d.getElementById('page').getBoundingClientRect().bottom),
      header: getComputedStyle(d.querySelector('.opm-header')).display, frames: Object.keys(w.OPM.page.frames), canvases: d.querySelectorAll('canvas').length, controls: !!d.querySelector('.opm-settings'), title: f.title,
      grain: w.OPM.page.state.grain }; })`);
    infos.push(`${tag} embed heights: ` + inner.map(x => x.src.split('?')[0] + ' ' + x.h + ' px').join(', '));
    check(`${tag}: the framed page opens at this page's View (Monthly) where it has one`, inner.every((x, i) => pages[i][2] === 'who-is-leaving' || x.grain === 'month'), JSON.stringify(inner.map(x => x.grain)));
    check(`${tag}: opened, it frames the old ${pages.map(p => p[1]).join(' and ')} page${pages.length > 1 ? 's' : ''} unchanged, with their own controls, sized to their content, no header of their own`,
      ok && inner.length === pages.length && inner.every((x, i) => x.src === pages[i][0] + '?embed=1' + (pages[i][2] === 'who-is-leaving' ? '' : '&view=month') && x.page === pages[i][2] && x.header === 'none' && x.canvases > 2 && x.controls && Math.abs(x.h - x.content) <= 2 && x.title === pages[i][1]), JSON.stringify(inner));
    const sc = await evaluate(noScroll);
    check(`${tag}: with the history open, still no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
  };
  for (const width of [1280, 390]) {
    await viewport(width);
    // the old addresses open the new pages with the signed note (location.replace: no loop, the hash kept)
    for (const [old, target] of Object.entries(MOVED)) {
      await go(base + old + '#from-bookmark'); await waitFor(`location.pathname.endsWith('/${target}') && !!(window.OPM && OPM.page && OPM.page.ready)`, 30000);
      const mv = await evaluate(`({ path: location.pathname, search: location.search, hash: location.hash, note: (document.querySelector('.opm-moved') || {}).textContent, current: document.querySelector('.opm-nav__link[aria-current="page"]').getAttribute('href'),
        h1: document.querySelector('h1').textContent, back: history.length })`);
      const name = target === 'departures.html' ? 'Departures' : 'Components';
      check(`MOVED @${width}: ${old} opens ${target} with "This page has moved. You are now on ${name}." (hash kept)`, mv.path.endsWith('/' + target) && mv.search === '?moved=' + old.replace('.html', '') && mv.hash === '#from-bookmark' &&
        mv.note === `This page has moved. You are now on ${name}.` && mv.current === target && mv.h1 === name, JSON.stringify(mv));
      const e = errorsNow(); check(`MOVED @${width} ${old}: no console errors`, e.length === 0, e.join(' | '));
      if (old === 'who-is-leaving.html') (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['departures'].add(k));
      if (old === 'components-compared.html') (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-view'].add(k));
    }
    const plain = await (async () => { await go(base + 'departures.html'); await waitFor(READY); return evaluate(`!document.querySelector('.opm-moved')`); })();
    check(`MOVED @${width}: Departures opened directly shows no moved note`, plain);

    // Overview
    await go(base + 'index.html'); await waitFor(READY); await RD_WAIT('DOJ:all:month:');
    const bar = await evaluate(`({ fields: [...document.querySelectorAll('.opm-settings > .opm-field')].map(f => f.querySelector('.opm-field__name').textContent),
      compare: [...document.querySelectorAll('.opm-field--compare .opm-toggle')].map(b => b.textContent + '=' + b.getAttribute('aria-pressed')),
      view: [...document.querySelectorAll('.opm-field--grain .opm-choice')].map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')), note: document.querySelector('.opm-field--grain .opm-field__note').textContent,
      nav: [...document.querySelectorAll('.opm-nav__link')].map(a => a.textContent + (a.classList.contains('opm-nav__link--secondary') ? '(2)' : '')) })`);
    check(`OV @${width}: one control bar: Component, Job series, Compare with (Biden, Trump I, Obama II, D-077 order, all on), View (Monthly on, D-033 wording and note)`,
      bar.fields.join('|') === 'Component|Job series|Compare with|View' && bar.compare.join('|') === 'Biden=true|Trump I=true|Obama II=true' && bar.view.join('|') === 'Yearly|Quarterly|Monthly*' &&
      bar.note === 'Years run October to September, the federal fiscal year.', JSON.stringify(bar));
    check(`OV @${width}: navigation: Overview, Departures, Components, then Look-Up and Reading the data as smaller links`, bar.nav.join('|') === 'Overview|Departures|Components|Look-Up(2)|Reading the data(2)', bar.nav.join('|'));
    const ov = await rdTiles();
    const T2 = admAt('DOJ', 'all', 'trump2', N_DOJ), ATR = Object.fromEntries(AT.map(id => [id, admAt('DOJ', 'all', id, N_DOJ)]));
    const expOv = [
      { name: 'Employees', value: NUM.format(T2.headcount_n), subs: ['As of ' + monLabel(T2.month_n), `${signed(T2.headcount_change)} (${pctText(T2.headcount_change / T2.headcount_0)}) since the end of December 2024`], at: AT.map(id => atLine(id, chg(ATR[id]))) },
      { name: 'Departures since January 2025', value: NUM.format(T2.departures), subs: [], at: AT.map(id => atLine(id, NUM.format(ATR[id].departures))) },
      { name: 'Hires since January 2025', value: NUM.format(T2.hires), subs: [], at: AT.map(id => atLine(id, NUM.format(ATR[id].hires))) },
      { name: 'Departure rate (annualized)', value: rate1(T2.attrition_num / T2.rate_den), subs: [], at: AT.map(id => atLine(id, rate1(ATR[id].attrition_num / ATR[id].rate_den))) }];
    check(`OV @${width}: DOJ tiles at month ${N_DOJ} with "at this point" lines (doj_admin)`, JSON.stringify(ov.map(t => ({ name: t.name, value: t.value, subs: t.subs, at: t.at }))) === JSON.stringify(expOv) && ov.every(t => t.badge),
      JSON.stringify(ov) + ' expect ' + JSON.stringify(expOv));
    if (AMETA.range.last_month === '2026-07') check(`OV @${width}: the L-097 figures: employees 107,331, change -10,048 (-8.6%), departures 20,461, hires 11,343, rate 11.7%; Biden at this point: -552 (-0.5%)`,
      ov[0].value === '107,331' && ov[0].subs[1] === '-10,048 (-8.6%) since the end of December 2024' && ov[1].value === '20,461' && ov[2].value === '11,343' && ov[3].value === '11.7%' &&
      ov[0].at[0] === 'Biden at this point: -552 (-0.5%)' && ov[0].at[1] === 'Trump I at this point: -3,702 (-3.1%)' && ov[1].at[0] === 'Biden at this point: 15,191', JSON.stringify(ov));
    infos.push(`OV @${width} tiles: ` + ov.map(t => t.name + ' ' + t.value + ' [' + t.subs.concat(t.at).join('; ') + ']').join(' | '));
    const ovA = await evaluate(`({ title: OPM.page.frames.change.el.querySelector('h2').textContent, labels: OPM.page.frames.change.chart.data.labels, sets: OPM.page.frames.change.chart.data.datasets.map(d => d.label + ':' + d.borderWidth),
      table: [...OPM.page.frames.change.el.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent)), notes: [...OPM.page.frames.change.notes.querySelectorAll('p')].map(p => p.textContent),
      rule: OPM.page.frames.change.chart.options.plugins.opmMarkers.flags.indexOf(true) })`);
    const maxAll = Math.max(...['obama2', 'trump1', 'biden', 'trump2'].map(id => admMax('DOJ', 'all', id)));
    check(`OV @${width}: Chart A, Monthly: every month in office 1 to ${maxAll}; one line per administration, Trump II emphasized; a rule at month ${N_DOJ}; the table at month ${N_DOJ}`,
      ovA.title === 'Change in employees since taking office' && ovA.labels.join() === shownMonths(maxAll, 1, N_DOJ).join() && ovA.sets.join() === 'Trump II:3,Biden:2,Trump I:2,Obama II:2' &&
      ovA.labels[ovA.rule] === String(N_DOJ) && JSON.stringify(ovA.table) === JSON.stringify(['trump2', ...AT].map(id => { const r = admAt('DOJ', 'all', id, N_DOJ); return [id === 'trump2' ? 'Trump II' : ANAME[id], signed(r.headcount_change), pctText(r.headcount_change / r.headcount_0)]; })) &&
      ovA.notes[0] === 'Month 1 is January of the inauguration year. Change is measured from the end of the December before.', JSON.stringify(ovA));
    const ovB = await evaluate(`({ title: OPM.page.frames.timeline.el.querySelector('h2').textContent, n: OPM.page.frames.timeline.chart.data.labels.length, notes: [...OPM.page.frames.timeline.notes.querySelectorAll('p')].map(p => p.textContent),
      dashed: OPM.page.frames.timeline.chart.data.datasets[0]._dashIn.filter(Boolean).length })`);
    const bandsM = await bandsAt('OPM.page.frames.timeline');
    check(`OV @${width}: Chart B "Employees, October 2011 to Jul 2026", Monthly: ${EXP.DOJ.monthCount} months, last 3 dashed; shading notes`, ovB.title === 'Employees, October 2011 to Jul 2026' && ovB.n === EXP.DOJ.monthCount && ovB.dashed === 3 &&
      ovB.notes[0] === 'Shaded bands mark administrations.' && ovB.notes.some(x => x.startsWith('Provisional:')), JSON.stringify(ovB));
    check(`OV @${width}: shading at Monthly: Obama II from Jan 2013, Trump I from Jan 2017, Biden from Jan 2021, Trump II from Jan 2025 to the latest month; nothing before Jan 2013`,
      bandsM.map(b => b.label + '@' + b.start).join() === 'Obama II@Jan 2013,Trump I@Jan 2017,Biden@Jan 2021,Trump II@Jan 2025' && Math.abs(bandsM[3].x1 - (bandsM[3].n - 0.5)) < 1e-9 &&
      bandsM.every((b, i) => i === 0 || Math.abs(b.x0 - bandsM[i - 1].x1) < 1e-9) && bandsM[0].x0 === 15 - 0.5, JSON.stringify(bandsM));
    const sv = await svgBands('OPM.page.frames.timeline');
    check(`OV @${width}: the SVG export carries the four bands with their names`, sv.ok && sv.bands.join() === 'Obama II,Trump I,Biden,Trump II', JSON.stringify(sv));
    const ovC = await evaluate(`({ title: OPM.page.frames.rate.el.querySelector('h2').textContent, labels: OPM.page.frames.rate.chart.data.labels, data: OPM.page.frames.rate.chart.data.datasets[0].data.map(v => (v * 100).toFixed(1) + '%') })`);
    check(`OV @${width}: Chart C "Departure rate, first ${N_DOJ} months (annualized)": Trump II, Biden, Trump I, Obama II`, ovC.title === `Departure rate, first ${N_DOJ} months (annualized)` && ovC.labels.join() === 'Trump II,Biden,Trump I,Obama II' &&
      ovC.data.join() === ['trump2', ...AT].map(id => { const r = admAt('DOJ', 'all', id, N_DOJ); return rate1(r.attrition_num / r.rate_den); }).join(), JSON.stringify(ovC));
    await shot(path.join(SCREENS, `overview-${width}.png`));
    // View on each chart type
    await setGrain('quarter'); await RD_WAIT('DOJ:all:quarter:');
    let vq = await evaluate(`({ a: OPM.page.frames.change.chart.data.labels, b: OPM.page.frames.timeline.chart.data.labels, bands: OPM.page.frames.timeline.chart.options.plugins.opmAdminBands.bands.map(b => b.x0) })`);
    const qRows = rowsOf('DOJ', 'quarter');
    const qIndex = p => qRows.findIndex(r => r[col('period_first_month')] === p);
    check(`OV @${width}: Quarterly: Chart A every 3rd month in office (plus month ${N_DOJ}); Chart B by fiscal quarter, bands on quarter edges (Jan = start of Q2)`,
      vq.a.join() === shownMonths(maxAll, 3, N_DOJ).join() && vq.b.length === qRows.length && vq.bands[0] === qIndex('2013-01') - 0.5 && vq.bands[3] === qIndex('2025-01') - 0.5, JSON.stringify(vq));
    await setGrain('fy'); await RD_WAIT('DOJ:all:fy:');
    vq = await evaluate(`({ a: OPM.page.frames.change.chart.data.labels, b: OPM.page.frames.timeline.chart.data.labels, bands: OPM.page.frames.timeline.chart.options.plugins.opmAdminBands.bands.map(b => b.x0) })`);
    const fyRows = rowsOf('DOJ', 'fy'), fyIndex = p => fyRows.findIndex(r => r[col('period')] === p);
    check(`OV @${width}: Yearly: Chart A every 12th month in office (plus month ${N_DOJ}); Chart B by fiscal year; a January boundary sits a quarter into its fiscal year`,
      vq.a.join() === shownMonths(maxAll, 12, N_DOJ).join() && vq.b.length === EXP.DOJ.fyCount && Math.abs(vq.bands[0] - (fyIndex('FY2013') - 0.5 + 3 / 12)) < 1e-9 && Math.abs(vq.bands[3] - (fyIndex('FY2025') - 0.5 + 3 / 12)) < 1e-9, JSON.stringify(vq));
    const tilesFy = await rdTiles();
    check(`OV @${width}: tiles do not change with the View`, JSON.stringify(tilesFy) === JSON.stringify(ov), JSON.stringify(tilesFy));
    await shot(path.join(SCREENS, `overview-yearly-${width}.png`));
    await setGrain('month'); await RD_WAIT('DOJ:all:month:');
    // Compare with
    await clickCompare('obama2'); await RD_WAIT('DOJ:all:month:trump1,biden');
    const cw = await evaluate(`({ at: [...document.querySelectorAll('.opm-tile--employees .opm-tile__at')].map(p => p.dataset.admin), a: OPM.page.frames.change.chart.data.datasets.map(d => d.label), c: OPM.page.frames.rate.chart.data.labels,
      table: [...OPM.page.frames.change.el.querySelectorAll('tbody tr')].map(tr => tr.dataset.admin) })`);
    check(`OV @${width}: Compare with: Obama II off leaves Biden and Trump I in the tiles, Chart A, its table and Chart C`, cw.at.join() === 'biden,trump1' && cw.a.join() === 'Trump II,Biden,Trump I' && cw.c.join() === 'Trump II,Biden,Trump I' &&
      cw.table.join() === 'trump2,biden,trump1', JSON.stringify(cw));
    await clickCompare('trump1'); await clickCompare('biden'); await RD_WAIT('DOJ:all:month:');
    const cw0 = await evaluate(`({ at: document.querySelectorAll('.opm-tile__at').length, a: OPM.page.frames.change.chart.data.datasets.map(d => d.label) })`);
    check(`OV @${width}: Compare with all off: Trump II alone, no "at this point" lines`, cw0.at === 0 && cw0.a.join() === 'Trump II', JSON.stringify(cw0));
    await clickCompare('obama2'); await clickCompare('trump1'); await clickCompare('biden'); await RD_WAIT('DOJ:all:month:obama2,trump1,biden');
    // the Component and Job series filters
    await setComps(['DJ02']); await RD_WAIT('DJ02:all:');
    const fb = await rdTiles(), F2 = admAt('DJ02', 'all', 'trump2', admMax('DJ02', 'all', 'trump2'));
    check(`OV @${width}: Component FBI: tiles from FBI's doj_admin rows`, fb[0].value === NUM.format(F2.headcount_n) && fb[1].value === NUM.format(F2.departures) && fb[3].value === rate1(F2.attrition_num / F2.rate_den), JSON.stringify(fb.map(t => t.value)));
    await setComps(['DJ14']); await RD_WAIT('DJ14:all:');
    const n14 = admMax('DJ14', 'all', 'trump2'), cr = await evaluate(`({ n: OPM.page.last.n, title: OPM.page.frames.rate.el.querySelector('h2').textContent, sub: document.querySelector('.opm-tile--employees .opm-tile__sub').textContent })`);
    check(`OV @${width}: Community Relations Service: N = ${n14} (its last month, Apr 2026)`, cr.n === n14 && cr.title === `Departure rate, first ${n14} months (annualized)` && cr.sub === 'As of Apr 2026', JSON.stringify(cr));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0301'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DJ14:0301:');
    const sbo = await evaluate(`({ tile: [...document.querySelectorAll('.opm-tile--rate .opm-tile__sub')].map(p => p.textContent), notes: [...OPM.page.frames.rate.notes.querySelectorAll('p')].map(p => p.textContent), faded: OPM.page.frames.rate.chart.data.datasets[0]._faded })`);
    check(`OV @${width}: CRS, series 0301: small-base rate flagged on the tile, hatched and noted in Chart C`, sbo.tile.includes('Based on fewer than 30 employees on average: read with care.') &&
      sbo.notes.includes('Based on fewer than 30 employees on average: read with care.') && sbo.faded.some(Boolean), JSON.stringify(sbo));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DJ14:all:');
    await setComps([]); await RD_WAIT('DOJ:all:');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0905'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DOJ:0905:');
    const at9 = await rdTiles(), A9 = admAt('DOJ', '0905', 'trump2', admMax('DOJ', '0905', 'trump2')), B9 = admAt('DOJ', '0905', 'biden', admMax('DOJ', '0905', 'trump2'));
    const tl9 = await evaluate(`OPM.page.frames.timeline.chart.data.datasets[0].data.at(-1)`);
    check(`OV @${width}: Job series Attorneys: tiles from the 0905 rows, Biden at the same point; the timeline from doj_core_series`, at9[0].value === NUM.format(A9.headcount_n) && at9[0].at[0] === atLine('biden', chg(B9)) && tl9 === X.attNow,
      JSON.stringify({ at9, tl9, attNow: X.attNow }));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '1811'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DOJ:1811:');
    await setComps(['DJ14']); await RD_WAIT('DJ14:1811:');
    const no = await evaluate(`({ note: document.querySelector('.opm-series-none').hidden ? null : document.querySelector('.opm-series-none').textContent, v: document.querySelector('.opm-tile__value').textContent })`);
    check(`OV @${width}: CRS has no criminal investigators: "no employees in this job series", no figures`, no.note === 'no employees in this job series' && no.v === '–', JSON.stringify(no));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DJ14:all:');
    await setComps([]); await RD_WAIT('DOJ:all:');
    await exploreCheck(`OV @${width}`, [['history-workforce-size.html', 'Workforce size', 'workforce-size']]);
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['overview'].add(k));
    let er = errorsNow(); check(`OV @${width}: no console errors`, er.length === 0, er.join(' | '));

    // Departures
    await go(base + 'departures.html'); await waitFor(READY); await RD_WAIT('DOJ:all:month:');
    const dt = await rdTiles();
    const expDt = [['Departures since January 2025', 'departures'], ['Quits since January 2025', 'sep_quit'], ['Retirements since January 2025', 'sep_retirement'], ['DRP departures', 'sep_drp']]
      .map(([name, c]) => ({ name, value: NUM.format(T2[c]), at: c === 'sep_drp' ? [] : AT.map(id => atLine(id, NUM.format(ATR[id][c]))) })); // DRP: no "at this point" lines (D-076)
    check(`DEP @${width}: tiles since January 2025 (departures, quits, retirements, DRP) with "at this point" lines, none on the DRP tile`, JSON.stringify(dt.map(t => ({ name: t.name, value: t.value, at: t.at }))) === JSON.stringify(expDt), JSON.stringify(dt) + ' expect ' + JSON.stringify(expDt));
    infos.push(`DEP @${width} tiles: ` + dt.map(t => t.name + ' ' + t.value).join(' | '));
    const dA = await evaluate(`({ title: OPM.page.frames.running.el.querySelector('h2').textContent, labels: OPM.page.frames.running.chart.data.labels, t2: OPM.page.frames.running.chart.data.datasets.find(d => d.label === 'Trump II').data.filter(v => v !== null).at(-1) })`);
    check(`DEP @${width}: Chart A "Departures since taking office": running departures by month in office; Trump II reaches ${NUM.format(T2.departures)} at month ${N_DOJ}`, dA.title === 'Departures since taking office' && dA.labels.join() === shownMonths(maxAll, 1, N_DOJ).join() && dA.t2 === T2.departures, JSON.stringify(dA));
    const dB = await evaluate(`(() => { const f = OPM.page.frames.reasons, c = f.chart, svg = f.svg();
      c.tooltip.setActiveElements(c.data.datasets.map((d, k) => ({ datasetIndex: k, index: 0 })), { x: 0, y: 0 }); c.update();
      const tip = (c.tooltip.dataPoints || []).map(p => p.dataset.label + ' ' + p.formattedValue);
      c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update(); // closed again before the screenshot
      return { title: f.el.querySelector('h2').textContent, labels: c.data.labels, legend: c.data.datasets.map(d => d.label), cols: c.data.datasets.map(d => d._col), data: c.data.datasets.map(d => d.data),
        colors: c.data.datasets.map(d => d._color), drpColor: OPM.chartFrame.token('--chart-16'), notes: [...f.notes.querySelectorAll('p')].map(p => p.textContent), tip,
        svgDrp: svg.includes('>DRP<'), svgNote: svg.includes(${JSON.stringify('>' + DRP_NOTE + '<')}) }; })()`);
    const expB = ['trump2', ...AT].map(id => { const r = admAt('DOJ', 'all', id, N_DOJ); return DRP_SEVEN.map(c => r[c] / r.departures); });
    check(`DEP @${width}: Chart B "Why people left, first ${N_DOJ} months": one 100% bar per administration, seven reasons with DRP first (D-080)`, dB.title === `Why people left, first ${N_DOJ} months` && dB.labels.join() === 'Trump II,Biden,Trump I,Obama II' &&
      dB.legend.join('|') === DRP_LEGEND && dB.cols.join() === DRP_SEVEN.join() && dB.data.every((d, k) => d.every((v, j) => v === expB[j][k])) && dB.colors[0] === dB.drpColor && new Set(dB.colors).size === 7, JSON.stringify(dB));
    check(`DEP @${width}: Chart B: Trump II alone has a DRP segment, the others a 0 share; the shares of each bar sum to 100%`, dB.data[0][0] > 0 && dB.data[0].slice(1).every(v => v === 0) &&
      dB.labels.every((x, j) => Math.abs(dB.data.reduce((a, d) => a + d[j], 0) - 1) < 1e-9), JSON.stringify(dB.data.map(d => d.map(v => v.toFixed(4)))));
    check(`DEP @${width}: Chart B: the D-080 note under the chart; DRP in the tooltip and in the SVG export with the note`, dB.notes[0] === DRP_NOTE && dB.tip.length === 7 && dB.tip[0].startsWith('DRP ') && dB.svgDrp && dB.svgNote, JSON.stringify({ notes: dB.notes, tip: dB.tip, svgDrp: dB.svgDrp, svgNote: dB.svgNote }));
    const dC = await evaluate(`({ title: document.getElementById('dep-who-title').textContent, note: document.querySelector('.opm-who__note').textContent, unavailable: !document.querySelector('.opm-who .opm-unavailable').hidden,
      panels: OPM.page.who.map(p => p.frame.el.hidden ? null : p.frame.el.querySelector('h3').textContent), los: OPM.page.last.who.los, losLabels: OPM.page.frames.who_los.chart.data.labels, losSets: OPM.page.frames.who_los.chart.data.datasets.map(d => d.label),
      losNotes: [...OPM.page.frames.who_los.notes.querySelectorAll('p')].map(p => p.textContent) })`);
    const expLos = ['trump2', ...AT].map(id => lrows('DOJ', 'admin_n', id, 'los').filter(r => !r[lc('is_unknown')]).map(r => r[lc('rate_num')] === null ? null : +(r[lc('rate_num')] / r[lc('rate_den')]).toFixed(6)));
    const DIMW = { los: 'years of service', age: 'age', supervisory: 'supervisory status' };
    const expNotes = (e, dim, ids) => { const out = [];
      ids.forEach(id => { const u = lrows(e, 'admin_n', id, dim).find(r => r[lc('is_unknown')]); if (u && u[lc('departures')]) out.push(u[lc('departures')] === 1 ? `${id === 'trump2' ? 'Trump II' : ANAME[id]}: 1 departure with unknown ${DIMW[dim]} is counted in the total but not shown as a group.`
        : `${id === 'trump2' ? 'Trump II' : ANAME[id]}: ${NUM.format(u[lc('departures')])} departures with unknown ${DIMW[dim]} are counted in the total but not shown as a group.`); });
      if (dim === 'los') ids.forEach(id => { const r = lrows(e, 'admin_n', id, 'los')[0]; const c = r && r[lc('coverage')]; if (c !== null && c < 1) out.push(`${id === 'trump2' ? 'Trump II' : ANAME[id]}: based on ${(Math.floor(c * 1000) / 10).toFixed(1)}% of departures with a known length of service.`); });
      return out; };
    check(`DEP @${width}: Chart C "Who is leaving, first ${N_DOJ} months": four panels; years of service = the admin_n rates per administration; the Unknown count in a note`,
      dC.title === `Who is leaving, first ${N_DOJ} months` && dC.note === `Departure rate by group: departures in the first ${N_DOJ} months, annualized, as a share of the group's average number of employees.` && !dC.unavailable &&
      dC.panels.join('|') === 'By years of service|By age|Supervisors and managers vs. everyone else|By occupation' && dC.losSets.join() === 'Trump II,Biden,Trump I,Obama II' &&
      JSON.stringify(dC.los.rates.map(l => l.map(v => v === null ? null : +v.toFixed(6)))) === JSON.stringify(expLos) && dC.losLabels[0] === 'Under 1 year' &&
      JSON.stringify(dC.losNotes.filter(t => /unknown|known length/.test(t))) === JSON.stringify(expNotes('DOJ', 'los', ['trump2', ...AT])), JSON.stringify(dC) + ' expect ' + JSON.stringify(expLos) + ' ' + JSON.stringify(expNotes('DOJ', 'los', ['trump2', ...AT])));
    const supNotes = await evaluate(`[...OPM.page.frames.who_sup.notes.querySelectorAll('p')].map(p => p.textContent).filter(t => /unknown/.test(t))`);
    check(`DEP @${width}: Chart C notes per administration (D-074): every shown administration with any Unknown gets its own line (Obama II on supervisory status)`,
      JSON.stringify(supNotes) === JSON.stringify(expNotes('DOJ', 'supervisory', ['trump2', ...AT])) && supNotes.includes('Obama II: 1 departure with unknown supervisory status is counted in the total but not shown as a group.'), JSON.stringify(supNotes) + ' expect ' + JSON.stringify(expNotes('DOJ', 'supervisory', ['trump2', ...AT])));
    const dD = await evaluate(`({ title: OPM.page.frames.timeline.el.querySelector('h2').textContent, sets: OPM.page.frames.timeline.chart.data.datasets.map(d => d.label), n: OPM.page.frames.timeline.chart.data.labels.length })`);
    const bandsD = await bandsAt('OPM.page.frames.timeline');
    check(`DEP @${width}: Chart D "Hires and departures, October 2011 to Jul 2026": paired bars by month with the four bands`, dD.title === 'Hires and departures, October 2011 to Jul 2026' && dD.sets.join() === 'Hires,Departures' && dD.n === EXP.DOJ.monthCount &&
      bandsD.map(b => b.label + '@' + b.start).join() === 'Obama II@Jan 2013,Trump I@Jan 2017,Biden@Jan 2021,Trump II@Jan 2025', JSON.stringify({ dD, bandsD }));
    const svD = await svgBands('OPM.page.frames.timeline');
    check(`DEP @${width}: the timeline's SVG export carries the bands`, svD.ok && svD.bands.length === 4, JSON.stringify(svD));
    await shot(path.join(SCREENS, `departures-${width}.png`));
    await setGrain('quarter'); await RD_WAIT('DOJ:all:quarter:');
    const dq = await evaluate(`({ a: OPM.page.frames.running.chart.data.labels, d: OPM.page.frames.timeline.chart.data.labels.length })`);
    check(`DEP @${width}: Quarterly: Chart A every 3rd month in office, Chart D by fiscal quarter`, dq.a.join() === shownMonths(maxAll, 3, N_DOJ).join() && dq.d === qRows.length, JSON.stringify(dq));
    await setGrain('month'); await RD_WAIT('DOJ:all:month:');
    await clickCompare('trump1'); await RD_WAIT('DOJ:all:month:obama2,biden');
    const dcw = await evaluate(`({ sets: OPM.page.frames.who_los.chart.data.datasets.map(d => d.label), tiles: [...document.querySelectorAll('.opm-tile--quits .opm-tile__at')].map(p => p.dataset.admin) })`);
    await clickCompare('obama2'); await RD_WAIT('DOJ:all:month:biden');
    const supOff = await evaluate(`[...OPM.page.frames.who_sup.notes.querySelectorAll('p')].map(p => p.textContent).filter(t => /unknown/.test(t))`);
    check(`DEP @${width}: Compare with: Obama II off removes its Unknown line`, !supOff.some(t => t.startsWith('Obama II: ')), JSON.stringify(supOff));
    await clickCompare('obama2'); await RD_WAIT('DOJ:all:month:obama2,biden');
    check(`DEP @${width}: Compare with: Trump I off leaves it out of the panels and tiles`, dcw.sets.join() === 'Trump II,Biden,Obama II' && dcw.tiles.join() === 'biden,obama2', JSON.stringify(dcw));
    await clickCompare('trump1'); await RD_WAIT('DOJ:all:month:obama2,trump1,biden');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0905'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DOJ:0905:');
    const d9 = await evaluate(`({ panels: OPM.page.who.map(p => p.frame.el.hidden ? null : p.dim.key), los: OPM.page.last.who.los.rates[0] })`);
    const LSM = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving_series.meta.json'), 'utf8'));
    const ls9n = (() => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, LSM.files.DOJ.path), 'utf8')); const c = n => f.columns.indexOf(n);
      return f.rows.filter(r => r[c('series_group')] === '0905' && r[c('grain')] === 'admin_n' && r[c('period')] === 'trump2' && r[c('dimension')] === 'los' && !r[c('is_unknown')]).sort((a, b) => a[c('value_order')] - b[c('value_order')])
        .map(r => r[c('rate_num')] === null ? null : +(r[c('rate_num')] / r[c('rate_den')]).toFixed(6)); })();
    check(`DEP @${width}: Attorneys: the occupation panel is hidden; years of service from doj_leaving_series admin_n`, d9.panels.join() === 'los,age,sup,' && JSON.stringify(d9.los.map(v => v === null ? null : +v.toFixed(6))) === JSON.stringify(ls9n), JSON.stringify({ d9, ls9n }));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DOJ:all:');
    await setComps(['DJ14']); await RD_WAIT('DJ14:all:');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0301'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DJ14:0301:');
    const sb = await evaluate(`[...document.querySelectorAll('.opm-who .opm-chart__note')].map(p => p.textContent).filter(t => t.startsWith('Based on fewer'))`);
    check(`DEP @${width}: CRS, series 0301: small bases hatched and noted in the breakdowns`, sb.length > 0, JSON.stringify(sb));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('DJ14:all:');
    await setComps([]); await RD_WAIT('DOJ:all:');
    await exploreCheck(`DEP @${width}`, [['history-hiring-and-departures.html', 'Hiring and departures', 'hiring-and-departures'], ['history-who-is-leaving.html', 'Who is leaving', 'who-is-leaving']]);
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['departures'].add(k));
    er = errorsNow(); check(`DEP @${width}: no console errors`, er.length === 0, er.join(' | '));
    // until admin_n is published, Chart C alone says "Data not available." (the live web/data files lack the grain)
    // the files served as published today: doj_leaving without the admin_n grain (installed before the page's own scripts run)
    const strip = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = (u, o) => /doj_leaving\\/DOJ\\.json/.test(String(u)) ? f(u, o).then(r => r.json()).then(j => { const gi = j.columns.indexOf('grain'); j.rows = j.rows.filter(r => r[gi] !== 'admin_n'); return new Response(JSON.stringify(j), { status: 200 }); }) : f(u, o); })()` });
    await go(base + 'departures.html');
    await waitFor(READY); await RD_WAIT('DOJ:all:');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: strip.identifier });
    const fbk = await evaluate(`({ text: document.querySelector('.opm-who .opm-unavailable').hidden ? null : document.querySelector('.opm-who .opm-unavailable').textContent, panels: OPM.page.who.filter(p => !p.frame.el.hidden).length,
      others: OPM.page.frames.running.chart.data.datasets.length, tiles: document.querySelector('.opm-tile__value').textContent })`);
    check(`DEP @${width}: without the admin_n grain only Chart C says "Data not available."; the rest of the page draws`, fbk.text === 'Data not available.' && fbk.panels === 0 && fbk.others === 4 && fbk.tiles === NUM.format(T2.departures), JSON.stringify(fbk));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['departures'].add(k));

    // Components
    await go(base + 'components.html'); await waitFor(READY); await RD_WAIT('all:');
    const ct = await evaluate(`({ title: document.getElementById('comp-table-title').textContent, head: [...document.querySelectorAll('.opm-compare__table--components thead th')].map(t => t.textContent),
      rows: [...document.querySelectorAll('.opm-compare__table--components tbody tr')].map(tr => [...tr.children].map(c => c.textContent)),
      scroll: (() => { const s = document.querySelector('[data-chart="components-table"] .opm-compare__scroll'); return { sw: s.scrollWidth, cw: s.clientWidth }; })() })`);
    const compRow = e => { const n = admMax(e, 'all', 'trump2'), r = admAt(e, 'all', 'trump2', n);
      return [NUM.format(r.headcount_n), chg(r), NUM.format(r.departures), rate1(r.attrition_num / r.rate_den)].concat(AT.map(id => { const x = admAt(e, 'all', id, n); return pctText(x.headcount_change / x.headcount_0); })); };
    const fbiRow = ct.rows.find(r => r[0] === 'FBI'), crsRow = ct.rows.find(r => r[0].startsWith('Community Relations Service'));
    check(`COMP @${width}: "Components since January 2025": DOJ pinned first; columns with one "{admin} at this point" per compared administration; DOJ, FBI and CRS rows from doj_admin at their own N`,
      ct.title === 'Components since January 2025' && ct.head.join('|') === 'Component|Employees now|Change since Dec 2024|Departures since Jan 2025|Departure rate (annualized)|Biden at this point|Trump I at this point|Obama II at this point' &&
      ct.rows[0][0] === 'Justice Department (all components)' && JSON.stringify(ct.rows[0].slice(1)) === JSON.stringify(compRow('DOJ')) && JSON.stringify(fbiRow.slice(1)) === JSON.stringify(compRow('DJ02')) &&
      JSON.stringify(crsRow.slice(1)) === JSON.stringify(compRow('DJ14')) && crsRow[0] === 'Community Relations Service (last reported Apr 2026)' && ct.rows.length === 13, JSON.stringify(ct) + ' expect DOJ ' + JSON.stringify(compRow('DOJ')));
    infos.push(`COMP @${width} DOJ row: ${ct.rows[0].join(' | ')}`);
    if (width < 600) check(`COMP @${width}: the table scrolls inside its panel on a phone`, ct.scroll.sw > ct.scroll.cw, JSON.stringify(ct.scroll));
    await evaluate(`document.querySelector('.opm-compare__table--components [data-col="rate"]').click()`);
    const sorted = await evaluate(`[...document.querySelectorAll('.opm-compare__table--components tbody tr')].map(tr => tr.children[4].textContent)`);
    const rv = sorted.slice(1).map(v => parseFloat(v));
    check(`COMP @${width}: sortable (D-049): departure rate, highest first; DOJ stays pinned`, rv.every((v, i) => i === 0 || rv[i - 1] >= v) && sorted[0] === compRow('DOJ')[3], sorted.join(','));
    const cc = await evaluate(`({ title: OPM.page.frames.chart.el.querySelector('h2').textContent, labels: OPM.page.frames.chart.chart.data.labels, sets: OPM.page.frames.chart.chart.data.datasets.map(d => d.label + ':' + d.type),
      doj: OPM.page.frames.chart.chart.data.datasets.map(d => d.data[0]) })`);
    const DJr = admAt('DOJ', 'all', 'trump2', N_DOJ);
    check(`COMP @${width}: "Change since taking office, by component": Trump II bars, a marker per compared administration; DOJ first`, cc.title === 'Change since taking office, by component' && cc.labels[0] === 'Justice Department (all components)' && cc.labels.length === 13 &&
      cc.sets.join() === 'Trump II:bar,Biden:line,Trump I:line,Obama II:line' && cc.doj.map(v => v.toFixed(6)).join() === [DJr, ...AT.map(id => admAt('DOJ', 'all', id, N_DOJ))].map(r => (r.headcount_change / r.headcount_0).toFixed(6)).join(), JSON.stringify(cc));
    const svc = await evaluate(`(() => { const d = new DOMParser().parseFromString(OPM.page.frames.chart.svg(), 'image/svg+xml'); return { ok: !d.querySelector('parsererror'), points: d.querySelectorAll('.opm-svg-point').length }; })()`);
    const offMk = await evaluate(`OPM.page.last.offScale.filter(o => o.kind === 'marker').length`);
    check(`COMP @${width}: the chart's SVG export carries the markers (those beyond the axis as edge arrows)`, svc.ok && svc.points === 39 - offMk, JSON.stringify({ svc, offMk }));
    // the mini charts (D-075)
    const mm = await evaluate(`(() => { const out = OPM.page.minis.map(m => { const c = m.chart; if (!c) return { e: m.entity, none: true };
      const L = c.data.labels, t2 = c.data.datasets.find(d => d.label === 'Trump II'), bi = c.data.datasets.find(d => d.label === 'Biden');
      return { e: m.entity, value: m.valueEl.textContent, name: c.canvas.getAttribute('aria-label'), min: c.scales.y.min, max: c.scales.y.max, sets: c.data.datasets.map(d => d.label + ':' + d.borderWidth),
        t2last: L[t2.data.map((v, i) => v === null ? -1 : i).filter(i => i >= 0).at(-1)], t2at: t2.data[L.indexOf(String(${N_DOJ}))], biAt: bi.data[L.indexOf(String(${N_DOJ}))], cols: 0 }; });
      const lefts = new Set([...document.querySelectorAll('.opm-multiples--minis .opm-multiple')].map(e => Math.round(e.getBoundingClientRect().left)));
      return { minis: out, cols: lefts.size, title: document.getElementById('comp-minis-title').textContent, note: [...document.querySelectorAll('[data-chart="component-minis"] .opm-chart__note')].map(p => p.textContent)[0],
        key: [...document.querySelectorAll('[data-chart="component-minis"] .opm-key__item')].map(k => k.textContent),
        crsNote: (document.querySelector('.opm-multiples--minis [data-entity="DJ14"] .opm-multiple__note') || {}).textContent, notesIn: document.querySelectorAll('.opm-multiples--minis .opm-multiple__note').length }; })()`);
    const fbiM = mm.minis.find(m => m.e === 'DJ02'), crsM = mm.minis.find(m => m.e === 'DJ14');
    const fR = admAt('DJ02', 'all', 'trump2', N_DOJ), fB = admAt('DJ02', 'all', 'biden', N_DOJ);
    check(`COMP @${width}: 12 mini charts (no DOJ), signed names, CRS marked ended; FBI Trump II ${pctText(fR.headcount_change / fR.headcount_0)} and Biden ${pctText(fB.headcount_change / fB.headcount_0)} at month ${N_DOJ}`,
      mm.minis.length === 12 && !mm.minis.some(m => m.e === 'DOJ') && fbiM.name === 'FBI' && crsM.name === 'Community Relations Service (last reported Apr 2026)' && fbiM.value === 'Trump II: ' + pctText(fR.headcount_change / fR.headcount_0) &&
      Math.abs(fbiM.t2at - fR.headcount_change / fR.headcount_0) < 1e-12 && Math.abs(fbiM.biAt - fB.headcount_change / fB.headcount_0) < 1e-12 &&
      mm.title === 'Change in employees since taking office, by component' && mm.note === 'Percent change from the end of the December before each administration took office. All charts use the same scale.' &&
      mm.key.join() === 'Trump II,Biden,Trump I,Obama II' && fbiM.sets.join() === 'Trump II:2.5,Biden:1.25,Trump I:1.25,Obama II:1.25', JSON.stringify(mm));
    if (AMETA.range.last_month === '2026-07') check(`COMP @${width}: the L-099 figures: FBI Trump II -5.1%, Biden +4.2% at N = 19`, N_DOJ === 19 && pctText(fbiM.t2at) === '-5.1%' && pctText(fbiM.biAt) === '+4.2%', JSON.stringify(fbiM));
    const cur11 = mm.minis.filter(m => m.e !== 'DJ14');
    check(`COMP @${width}: the 11 current components share one y-axis from their own data (it excludes CRS's range); CRS has its own axis with the signed note; its Trump II line ends at month ${admMax('DJ14', 'all', 'trump2')}`,
      cur11.length === 11 && new Set(cur11.map(m => m.min + '/' + m.max)).size === 1 && (crsM.max > cur11[0].max || crsM.min < cur11[0].min) && cur11[0].max < 1 && crsM.max >= 1 &&
      mm.crsNote === 'Community Relations Service, a very small office, is shown on its own scale.' && mm.notesIn === 1 &&
      crsM.t2last === String(admMax('DJ14', 'all', 'trump2')) && fbiM.t2last === String(N_DOJ), JSON.stringify(mm.minis.map(m => [m.e, m.min, m.max, m.t2last])) + ' ' + mm.crsNote);
    check(`COMP @${width}: the minis grid: ${width < 600 ? 'one column' : '3 to 4 per row'}`, width < 600 ? mm.cols === 1 : mm.cols >= 3 && mm.cols <= 4, String(mm.cols));
    const msvg = await evaluate(`(() => { let svg = null, name = null; const orig = OPM.svgExport.download; OPM.svgExport.download = (s, n) => { svg = s; name = n; };
      document.querySelector('[data-export="component-minis"]').click(); OPM.svgExport.download = orig;
      const d = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { ok: !d.querySelector('parsererror'), cells: d.querySelectorAll('svg > svg').length, name,
        crs: (svg.match(/Community Relations Service, a very small office, is shown on its own scale\./g) || []).length }; })()`);
    check(`COMP @${width}: the minis grid exports as one SVG with 12 cells, CRS's cell carrying its own-scale note`, msvg.ok && msvg.cells === 12 && msvg.name === 'opm-component-minis-month.svg' && msvg.crs === 1, JSON.stringify(msvg));
    await setGrain('fy'); await RD_WAIT('all:');
    const mfy = await evaluate(`OPM.page.minis.filter(m => m.chart).map(m => m.entity + '=' + m.chart.data.labels.join('/'))`);
    check(`COMP @${width}: View Yearly on the minis: every 12th month in office, plus each component's own N`, mfy.includes('DJ02=12/19/24/36/48') && mfy.includes('DJ14=12/16/24/36/48'), JSON.stringify(mfy));
    await setGrain('month'); await RD_WAIT('all:');
    await shot(path.join(SCREENS, `components-${width}.png`));
    // D-081: readable ticks on the small charts, and the Expand dialog
    const key = async (k, shift) => { const code = { Escape: 27, Tab: 9 }[k]; const mods = shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods }); await sleep(80); };
    const tk = await evaluate(`(() => { const t = c => ({ x: c.scales.x.ticks.map(k => c.data.labels[k.value] + '=' + k.label), y: c.scales.y.ticks.map(k => k.label),
        zero: (() => { const g = c.config.options.scales.y.grid; const ctx0 = { tick: { value: 0 } }, ctx1 = { tick: { value: 0.4 } }; return [g.color(ctx0) !== g.color(ctx1), g.lineWidth(ctx0) > g.lineWidth(ctx1)]; })() });
      const f = OPM.page.minis.find(m => m.entity === 'DJ02'), c = OPM.page.minis.find(m => m.entity === 'DJ14');
      return { fbi: t(f.chart), crs: t(c.chart), cur: OPM.page.minis.filter(m => m.chart && !m.ownScale).map(m => m.chart.scales.y.ticks.map(k => k.label).join('|')) }; })()`);
    check(`D-081 COMP @${width}: small charts: x ticks "Year 1" to "Year 4" at months 12, 24, 36, 48`, tk.fbi.x.join() === '12=Year 1,24=Year 2,36=Year 3,48=Year 4' && tk.crs.x.join() === '12=Year 1,24=Year 2,36=Year 3,48=Year 4', JSON.stringify(tk));
    const ySh = tk.fbi.y;
    check(`D-081 COMP @${width}: small charts: three y labels${AMETA.range.last_month === '2026-07' ? ' -40%, 0%, +40%' : ''} on the shared scale (all 11 alike), a stronger zero line`,
      ySh.length === 3 && ySh[1] === '0%' && ySh[0] === ySh[2].replace('+', '-') && (AMETA.range.last_month !== '2026-07' || ySh.join() === '-40%,0%,+40%') && new Set(tk.cur).size === 1 &&
      tk.fbi.zero.every(Boolean), JSON.stringify(tk));
    check(`D-081 COMP @${width}: Community Relations Service: three labels on its own scale, its minimum, 0% and its maximum`, tk.crs.y.length === 3 && tk.crs.y[1] === '0%' && tk.crs.y[0].startsWith('-') && tk.crs.y[2].startsWith('+') &&
      (await evaluate(`(() => { const c = OPM.page.minis.find(m => m.entity === 'DJ14').chart; return Math.round(c.scales.y.min * 100) + '%|' + Math.round(c.scales.y.max * 100) + '%'; })()`)) === tk.crs.y[0] + '|' + tk.crs.y[2].slice(1), JSON.stringify(tk.crs));
    const msvg2 = await evaluate(`(() => { let svg = null; const orig = OPM.svgExport.download; OPM.svgExport.download = s => { svg = s; };
      document.querySelector('[data-export="component-minis"]').click(); OPM.svgExport.download = orig;
      const d = new DOMParser().parseFromString(svg, 'image/svg+xml'); const cell = [...d.querySelectorAll('svg > svg')][0];
      return { x: [...cell.querySelectorAll('.opm-svg-x text')].map(t => t.textContent), y: [...cell.querySelectorAll('.opm-svg-y text')].map(t => t.textContent), zero: d.querySelectorAll('.opm-svg-zero').length }; })()`);
    check(`D-081 COMP @${width}: the minis SVG export carries the new ticks (Year 1 to Year 4; three y labels) and the zero line`, msvg2.x.join() === 'Year 1,Year 2,Year 3,Year 4' && msvg2.y.join() === ySh.join() && msvg2.zero === 12, JSON.stringify(msvg2));
    const ex = await evaluate(`(() => { const b = [...document.querySelectorAll('.opm-multiples--minis [data-expand]')];
      const name = el => el.getAttribute('aria-labelledby').split(' ').map(id => document.getElementById(id).textContent).join(' ');
      return { n: b.length, text: b.map(x => x.textContent), fbi: name(document.querySelector('[data-expand="DJ02"]')), crs: name(document.querySelector('[data-expand="DJ14"]')), popup: b.every(x => x.getAttribute('aria-haspopup') === 'dialog') }; })()`);
    check(`D-081 COMP @${width}: an "Expand" button under each of the 12 charts, named with its component`, ex.n === 12 && ex.text.every(t => t === 'Expand') && ex.fbi === 'Expand FBI' && ex.crs === 'Expand Community Relations Service (last reported Apr 2026)' && ex.popup, JSON.stringify(ex));
    await evaluate(`document.querySelector('[data-expand="DJ02"]').scrollIntoView({ block: 'center' }); document.querySelector('[data-expand="DJ02"]').focus(); document.querySelector('[data-expand="DJ02"]').click()`);
    await waitFor('!!(OPM.page.expanded && OPM.page.expanded.chart)');
    const dl = await evaluate(`(() => { const d = document.querySelector('dialog.opm-dialog'), c = OPM.page.expanded.chart, r = d.getBoundingClientRect(), p = d.querySelector('.opm-dialog__plot').getBoundingClientRect();
      const el = c.getDatasetMeta(0).data[5]; c.tooltip.setActiveElements([{ datasetIndex: 0, index: 5 }], { x: el.x, y: el.y }); c.update();
      return { open: d.open, modal: d.matches(':modal'), title: document.getElementById('comp-mini-dialog-title').textContent.replace(/\\s+/g, ' ').trim(), focus: document.activeElement.textContent, focusIn: d.contains(document.activeElement),
        key: [...d.querySelectorAll('.opm-key__item')].map(k => k.textContent), close: d.querySelector('.opm-dialog__close').textContent,
        x: c.scales.x.ticks.map(k => k.label), xTitle: c.options.scales.x.title.display && c.options.scales.x.title.text, y: c.scales.y.ticks.map(k => k.label), tip: c.tooltip.title, tipBody: c.tooltip.body.length,
        w: Math.round(r.width), h: Math.round(p.height), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), sets: c.data.datasets.map(s => s.label), labels: c.data.labels.length,
        name: d.querySelector('canvas').getAttribute('aria-label') }; })()`);
    const fbiVal = 'Trump II: ' + pctText(fR.headcount_change / fR.headcount_0);
    check(`D-081 COMP @${width}: Expand opens a modal dialog titled "FBI ${fbiVal}", focus on Close, the full legend`, dl.open && dl.modal && dl.title === 'FBI ' + fbiVal && dl.focus === 'Close' && dl.focusIn && dl.close === 'Close' &&
      dl.key.join() === 'Trump II,Biden,Trump I,Obama II' && dl.sets.join() === 'Trump II,Biden,Trump I,Obama II' && dl.name === 'FBI', JSON.stringify(dl));
    check(`D-081 COMP @${width}: the expanded chart: "Months in office", a tick every 6 months, y every 10%, a tooltip per month`, dl.xTitle === 'Months in office' && dl.x.join() === '6,12,18,24,30,36,42,48' &&
      dl.y.length >= 3 && dl.y.every((t, i) => i === 0 || parseInt(t, 10) - parseInt(dl.y[i - 1], 10) === 10) && dl.y.includes('0%') && dl.labels === 48 &&
      JSON.stringify(dl.tip) === JSON.stringify(['Month 6 in office']) && dl.tipBody >= 1, JSON.stringify(dl));
    check(`D-081 COMP @${width}: the dialog is ${width < 600 ? 'the full width less a 16px gutter' : 'about 900 by 500'}`, width < 600 ? (dl.w === width - 32 && dl.left === 16 && dl.right === 16) : (dl.w === 900 && dl.h >= 480 && dl.h <= 500), JSON.stringify(dl));
    const nsd = await evaluate(noScroll);
    check(`D-081 COMP @${width}: no sideways scroll with the dialog open`, nsd.sw <= nsd.iw, JSON.stringify(nsd));
    await shot(path.join(SCREENS, `components-expanded-${width}.png`));
    // focus stays inside: Tab and Shift+Tab never leave the dialog
    const inside = [];
    for (const s of [false, false, true, true, true]) { await key('Tab', s); inside.push(await evaluate(`document.querySelector('dialog.opm-dialog').contains(document.activeElement)`)); }
    check(`D-081 COMP @${width}: Tab and Shift+Tab keep focus inside the dialog`, inside.every(Boolean), JSON.stringify(inside));
    await key('Escape');
    const esc = await evaluate(`({ open: document.querySelector('dialog.opm-dialog').open, focus: document.activeElement.dataset.expand, chart: !!(OPM.page.expanded && OPM.page.expanded.chart) })`);
    check(`D-081 COMP @${width}: Esc closes the dialog and focus returns to FBI's Expand button`, !esc.open && esc.focus === 'DJ02' && !esc.chart, JSON.stringify(esc));
    await evaluate(`document.querySelector('[data-expand="DJ14"]').focus(); document.querySelector('[data-expand="DJ14"]').click()`);
    await waitFor('!!(OPM.page.expanded && OPM.page.expanded.chart && OPM.page.expanded.entity === "DJ14")');
    const dc = await evaluate(`(() => { const d = document.querySelector('dialog.opm-dialog'), c = OPM.page.expanded.chart;
      return { title: document.getElementById('comp-mini-dialog-title').textContent.replace(/\\s+/g, ' ').trim(), y: c.scales.y.ticks.map(k => k.label), notes: [...d.querySelectorAll('.opm-chart__note')].map(p => p.textContent) }; })()`);
    const steps = dc.y.map(t => parseInt(t, 10)), stepC = steps[1] - steps[0];
    check(`D-081 COMP @${width}: Community Relations Service expanded: its own scale, a round step (${stepC}%), its own-scale note`, dc.title.startsWith('Community Relations Service (last reported Apr 2026) Trump II: ') &&
      [5, 10, 20, 25, 50, 100].includes(stepC) && steps.every((v, i) => i === 0 || v - steps[i - 1] === stepC) && dc.y.includes('0%') && dc.y.length <= 11 &&
      dc.notes.includes('Community Relations Service, a very small office, is shown on its own scale.'), JSON.stringify(dc));
    await evaluate(`document.querySelector('.opm-dialog__close').click()`);
    const cl = await evaluate(`({ open: document.querySelector('dialog.opm-dialog').open, focus: document.activeElement.dataset.expand })`);
    check(`D-081 COMP @${width}: Close closes the dialog and focus returns to the button that opened it`, !cl.open && cl.focus === 'DJ14', JSON.stringify(cl));
    await clickCompare('obama2'); await RD_WAIT('all:trump1,biden');
    const ch = await evaluate(`[...document.querySelectorAll('.opm-compare__table--components thead th')].map(t => t.textContent).slice(5)`);
    check(`COMP @${width}: Compare with: Obama II off drops its column and markers`, ch.join('|') === 'Biden at this point|Trump I at this point' && (await evaluate('OPM.page.frames.chart.chart.data.datasets.length')) === 3, ch.join('|'));
    await clickCompare('obama2'); await RD_WAIT('all:obama2,trump1,biden');
    await setComps(['DJ03']); await RD_WAIT('all:obama2,trump1,biden:DJ03');
    check(`COMP @${width}: the Component selector highlights its row`, (await evaluate(`[...document.querySelectorAll('.opm-compare__selected')].map(tr => tr.dataset.entity).join()`)) === 'DJ03');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0007'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('0007:');
    const c7 = await evaluate(`[...document.querySelectorAll('.opm-compare__table--components tbody tr')].map(tr => [...tr.children].map(c => c.textContent))`);
    const bopRow = c7.find(r => r[0] === 'BOP'), noneRows = c7.filter(r => r[0] !== 'BOP' && r[0] !== 'Justice Department (all components)');
    const m7 = await evaluate(`({ charts: OPM.page.minis.filter(m => m.chart).map(m => m.entity), none: [...document.querySelectorAll('.opm-multiples--minis .opm-multiple__none')].map(p => p.textContent) })`);
    check(`COMP @${width}: the minis follow the job series: Correctional officers chart BOP only, the 11 others say "no employees in this job series"`, m7.charts.join() === 'DJ03' && m7.none.length === 11 && m7.none.every(t => t === 'no employees in this job series'), JSON.stringify(m7));
    check(`COMP @${width}: Correctional officers: BOP has figures; every other component "no employees in this job series"`, bopRow && bopRow.length === 8 && noneRows.length === 11 && noneRows.every(r => r[1] === 'no employees in this job series'), JSON.stringify(c7.map(r => r.slice(0, 2))));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0301'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('0301:');
    const sbc = await evaluate(`({ crs: !!document.querySelector('.opm-compare__table--components tr[data-entity="DJ14"] .opm-compare__small'), notes: [...document.querySelectorAll('[data-chart="components-table"] .opm-chart__note')].map(p => p.textContent) })`);
    check(`COMP @${width}: series 0301: CRS's small-base rate marked in the table, with the note`, sbc.crs && sbc.notes.includes('Based on fewer than 30 employees on average: read with care.'), JSON.stringify(sbc));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('all:');
    await exploreCheck(`COMP @${width}`, [['history-components-compared.html', 'Components compared', 'components-compared']]);
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-view'].add(k));
    er = errorsNow(); check(`COMP @${width}: no console errors`, er.length === 0, er.join(' | '));
  }


  // ---- Visual QA (L-103, D-077): order, CRS off-scale, labels, alignment, table fit, contrast cues, at 1280, 1024, 768 and 390
  for (const width of [1280, 1024, 768, 390]) {
    await viewport(width);
    for (const [file, name] of [['index.html', 'overview'], ['departures.html', 'departures'], ['components.html', 'components']]) {
      await go(base + file); await waitFor(READY); await waitFor('!!(OPM.page && OPM.page.shown)', 30000); await sleep(400);
      const sc = await evaluate(noScroll);
      check(`QA ${file} @${width}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
      if (file !== 'components.html') {
        const tl = await evaluate(`(() => { const t = [...document.querySelectorAll('.opm-tiles--four .opm-tile')].map(e => ({ top: Math.round(e.getBoundingClientRect().top), v: Math.round(e.querySelector('.opm-tile__value').getBoundingClientRect().top) }));
          const rows = {}; t.forEach(x => (rows[x.top] = rows[x.top] || []).push(x.v)); return { cols: Object.values(rows)[0].length, rows: Object.values(rows) }; })()`);
        const wantCols = width >= 1024 ? 4 : width >= 600 ? 2 : 1;
        check(`QA ${file} @${width}: tiles ${wantCols} across, their numbers aligned (two-line title area)`, tl.cols === wantCols && tl.rows.every(r => r.every(v => v === r[0])), JSON.stringify(tl));
        const mh = await evaluate(`getComputedStyle(document.querySelector('.opm-tiles--four .opm-tile__name')).minHeight`);
        check(`QA ${file} @${width}: the two-line title area is reserved only when tiles sit side by side (N3)`, width >= 600 ? parseFloat(mh) > 20 : (mh === 'auto' || parseFloat(mh) === 0 || mh === '0px'), mh);
      }
      const ctl = await evaluate(`[...document.querySelectorAll('.opm-settings--main > .opm-field')].map(f => { const c = f.querySelector('select, .opm-choice, .opm-toggle, .opm-multi__button'); const r = c.getBoundingClientRect(); return { f: f.className.split(' ')[1], top: Math.round(r.top), h: Math.round(r.height) }; })`);
      const firstRow = ctl.filter(c => c.top === ctl[0].top);
      check(`QA ${file} @${width}: controls are all 40 px and those on one row share their top (N4)`, ctl.every(c => c.h === 40) && ctl.every(a => ctl.every(b => a.top === b.top || Math.abs(a.top - b.top) >= 40)) && (width < 1280 || firstRow.length === 4), JSON.stringify(ctl));
      if (file === 'components.html') {
        const tbl = await evaluate(`(() => { const s = document.querySelector('[data-chart="components-table"] .opm-compare__scroll'); return { sw: s.scrollWidth, cw: s.clientWidth,
          bg: getComputedStyle(document.querySelector('.opm-compare__table--components tbody tr')).backgroundColor, cell: getComputedStyle(document.querySelector('.opm-compare__table--components tbody tr th')).backgroundColor }; })()`);
        if (width >= 1024) check(`QA components @${width}: the table fits with no inner scroll`, tbl.sw <= tbl.cw + 1, JSON.stringify(tbl));
        check(`QA components @${width}: the pinned DOJ row is not yellow`, tbl.cell !== 'rgb(255, 249, 196)' && tbl.cell !== 'rgb(234, 245, 76)', JSON.stringify(tbl));
      }
      if (file === 'departures.html' && width >= 1024) {
        const g = await evaluate(`[...new Set(OPM.page.who.filter(p => !p.frame.el.hidden).map(p => Math.round(p.frame.el.getBoundingClientRect().left)))].length`);
        check(`QA departures @${width}: Chart C panels in a 2 x 2 grid`, g === 2, String(g));
      }
      await shot(path.join(SCREENS, `${name}-${width}.png`));
      // a months-in-office tooltip (its title is adm.tipMonth), as a reader hovering would see it
      const tipChart = { 'index.html': 'OPM.page.frames.change.chart', 'departures.html': 'OPM.page.frames.running.chart', 'components.html': 'OPM.page.minis.find(m => m.chart).chart' }[file];
      const tipTitle = await evaluate(`(() => { const c = ${tipChart}; const el = c.getDatasetMeta(0).data[5]; c.tooltip.setActiveElements([{ datasetIndex: 0, index: 5 }], { x: el.x, y: el.y }); c.update(); return c.tooltip.title; })()`);
      check(`QA ${file} @${width}: a months-in-office tooltip reads "Month 6 in office"`, JSON.stringify(tipTitle) === JSON.stringify(['Month 6 in office']), JSON.stringify(tipTitle));
      (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed[DATA_PAGES[file]].add(k));
      const e = errorsNow(); check(`QA ${file} @${width}: no console errors`, e.length === 0, e.join(' | '));
    }
    if (width === 390) {
      const nv = await evaluate(`(() => { const a = [...document.querySelectorAll('.opm-nav__link')].map(x => ({ t: x.textContent, top: Math.round(x.getBoundingClientRect().top) })); return a; })()`);
      check('QA nav @390: the two secondary links share their own row', nv[3].top === nv[4].top && nv[3].top > nv[2].top, JSON.stringify(nv));
    }
  }
  await viewport(1280);
  // order (D-077), the month-N rule label and tooltip title, band labels above the plot, January ticks
  await go(base + 'index.html'); await waitFor(READY); await RD_WAIT('DOJ:all:month:');
  const q1 = await evaluate(`(() => { const c = OPM.page.frames.change.chart, t = OPM.page.frames.timeline.chart;
    return { legend: [...OPM.page.frames.change.el.querySelectorAll('.opm-key__item')].map(b => b.textContent), toggles: [...document.querySelectorAll('.opm-toggle')].map(b => b.textContent),
      tip: c.options.plugins.tooltip.callbacks.title([{ label: '7' }]), rule: c._opmRuleLabel && c._opmRuleLabel.text,
      color: c.options.plugins.tooltip.callbacks.labelColor({ dataset: c.data.datasets[1] }), ds1: c.data.datasets[1]._color,
      bands: t._opmBandLabels.map(b => b.label + ':' + b.anchor + ':' + (b.y < t.chartArea.top)), ticks: t.scales.x.ticks.filter(x => x.label).map(x => x.label) }; })()`);
  check('QA order: Chart A legend and the Compare with toggles follow Trump II, Biden, Trump I, Obama II', q1.legend.join() === 'Trump II,Biden,Trump I,Obama II' && q1.toggles.join() === 'Biden,Trump I,Obama II', JSON.stringify(q1));
  check(`QA months-in-office: tooltip titled "Month 7 in office"; the rule labeled "Trump II so far (month ${N_DOJ})"; swatches in the series color`, q1.tip === 'Month 7 in office' && q1.rule === `Trump II so far (month ${N_DOJ})` &&
    q1.color.backgroundColor === q1.ds1 && q1.color.borderColor === q1.ds1, JSON.stringify(q1));
  check('QA bands: names in the strip above the plot; Trump II always named, right-aligned; x ticks at Januaries', q1.bands.join() === 'Obama II:start:true,Trump I:start:true,Biden:start:true,Trump II:end:true' &&
    q1.ticks.length > 3 && q1.ticks.every(t => t.startsWith('Jan ')) && q1.ticks.includes('Jan 2013') && q1.ticks.includes('Jan 2025'), JSON.stringify(q1));
  const svgA = await evaluate(`(() => { const d = new DOMParser().parseFromString(OPM.page.frames.change.svg(), 'image/svg+xml'); const l = d.querySelector('.opm-svg-marker--rule'); return { dash: l && l.querySelector('line').getAttribute('stroke-dasharray'), label: l && l.textContent }; })()`);
  check('QA Chart A SVG: the month-N rule dashed, with its label', svgA.dash === '3 3' && svgA.label === `Trump II so far (month ${N_DOJ})`, JSON.stringify(svgA));
  const svgB = await evaluate(`(() => { const d = new DOMParser().parseFromString(OPM.page.frames.timeline.svg(), 'image/svg+xml'); return [...d.querySelectorAll('.opm-svg-band text')].map(t => t.textContent + ':' + t.getAttribute('text-anchor')); })()`);
  check('QA timeline SVG: band names placed as on screen (Trump II right-aligned)', svgB.join() === 'Obama II:start,Trump I:start,Biden:start,Trump II:end', svgB.join());
  // the provisional note keyed by the tiles' badge glyph
  check('QA tiles: the provisional note starts with the badge glyph', await evaluate(`!!document.querySelector('.opm-tiles__notes .opm-chart__note--provisional .opm-tile__prov')`));
  // Components: CRS off the scale
  await go(base + 'components.html'); await waitFor(READY); await RD_WAIT('all:');
  const crsQ = await evaluate(`({ axis: OPM.page.last.axis, off: OPM.page.last.offScale, notes: [...OPM.page.frames.chart.notes.querySelectorAll('p')].map(p => p.textContent), drawn: OPM.page.frames.chart.chart._opmOffScale,
    text: [...document.querySelectorAll('.opm-compare__table--components td')].map(t => t.textContent).filter(t => t === '-0.0%' || t === '+0.0%').length })`);
  const crsR = admAt('DJ14', 'all', 'trump2', admMax('DJ14', 'all', 'trump2')), crsPct = crsR.headcount_change / crsR.headcount_0;
  check(`QA components chart: the axis fits the current components (${(crsQ.axis.lo * 100).toFixed(0)}% to ${(crsQ.axis.hi * 100).toFixed(0)}%); CRS runs off it with an arrow and its value ${pctText(crsPct)}; the signed note`,
    crsPct < crsQ.axis.lo && crsQ.off.filter(o => o.kind === 'bar').length === 1 && crsQ.off[0].entity === 'DJ14' && crsQ.off[0].text === pctText(crsPct) && crsQ.drawn.filter(d => d.kind === 'bar').length === 1 &&
    crsQ.notes.includes('Community Relations Service, a very small office, runs off the scale; its value is labeled.'), JSON.stringify(crsQ));
  check('QA negative zero: no "-0.0%" or "+0.0%" in the Components table', crsQ.text === 0, String(crsQ.text));
  // N1: a comparison marker beyond the axis is clamped to the edge with an arrow and its value, not dropped
  const offM = [];
  for (const e of ['DOJ', ...AMETA.entities.filter(x => x !== 'DOJ')]) {
    const n = admMax(e, 'all', 'trump2'); if (!n) continue;
    for (const id of AT) { const r = admAt(e, 'all', id, n); if (!r || !r.headcount_0) continue; const v = r.headcount_change / r.headcount_0;
      if (v < crsQ.axis.lo || v > crsQ.axis.hi) offM.push(e + ':' + id + ':' + pctText(v)); }
  }
  const gotM = crsQ.off.filter(o => o.kind === 'marker').map(o => o.entity + ':' + o.admin + ':' + o.text);
  check(`QA N1: comparison markers beyond the axis are clamped to its edge with an arrow and their value (${offM.join(', ')})`, offM.length > 0 && JSON.stringify(gotM.sort()) === JSON.stringify(offM.sort()) &&
    offM.includes('DJ14:biden:+29.6%') === (AMETA.range.last_month === '2026-07') && crsQ.drawn.filter(d => d.kind === 'marker').length === offM.length, JSON.stringify({ gotM, offM }));
  // N2: the SVG cuts bars at the plot edge, so no bar covers the label column, and carries the chart's notes
  const svgN2 = await evaluate(`(() => { const d = new DOMParser().parseFromString(OPM.page.frames.chart.svg(), 'image/svg+xml'); const a = OPM.page.frames.chart.chart.chartArea;
    const rects = [...d.querySelectorAll('.opm-svg-series rect')].map(r => +r.getAttribute('x')); return { minX: Math.min(...rects), left: a.left, arrows: d.querySelectorAll('.opm-svg-arrow').length,
      notes: [...d.querySelectorAll('.opm-svg-note')].map(t => t.textContent), crsLabel: [...d.querySelectorAll('.opm-svg-y text')].some(t => t.textContent.startsWith('Community Relations Service')) }; })()`);
  check('QA N2: in the SVG the off-scale bar starts at the plot edge (the CRS name stays visible), arrows for the bar and markers, the notes exported', svgN2.minX >= svgN2.left - 0.5 && svgN2.crsLabel &&
    svgN2.arrows === 1 + offM.length && svgN2.notes.includes('Community Relations Service, a very small office, runs off the scale; its value is labeled.'), JSON.stringify(svgN2));
  const svgC = await evaluate(`(() => { const s = OPM.page.frames.chart.svg(), d = new DOMParser().parseFromString(s, 'image/svg+xml'); const w = +d.documentElement.getAttribute('width');
    const g = d.querySelector('.opm-svg-plot').getAttribute('transform'); return { arrows: d.querySelectorAll('.opm-svg-arrow').length, diamonds: [...d.querySelectorAll('.opm-svg-point')].filter(p => p.tagName === 'path').length, shift: g, w }; })()`);
  check('QA components chart SVG: the off-scale arrows, diamond markers, and the plot shifted so the left labels fit', svgC.arrows === 1 + offM.length && svgC.diamonds === 39 - offM.length && /translate\((\d+(\.\d+)?),/.test(svgC.shift), JSON.stringify(svgC));
  // L-107: the SVG export's off-scale arrows and values are the current screen's, through several series (with off-scale
  // values, then without); clamped labels on one side of a row never overlap; the fitted axis ticks on round values
  for (const [g, prefix] of [['0905', '0905:'], ['1811', '1811:'], ['0905', '0905:'], ['all', 'all:']]) {
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '${g}'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT(prefix);
    await sleep(150);
    const st = await evaluate(`(() => { const c = OPM.page.frames.chart.chart, d = new DOMParser().parseFromString(OPM.page.frames.chart.svg(), 'image/svg+xml');
      const screen = (c._opmOffScale || []).map(x => x.text).sort(), items = OPM.page.last.offScale.map(x => x.text).sort();
      const svgLabels = [...d.querySelectorAll('.opm-svg-label')].map(t => t.textContent).sort(), svgArrows = d.querySelectorAll('.opm-svg-arrow').length;
      let overlap = false; (c._opmOffScale || []).forEach((a, i) => (c._opmOffScale || []).forEach((b, j) => { if (i < j && a.dir === b.dir && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 11) overlap = true; }));
      const ticks = c.scales.x.ticks.map(t => t.value), step = c.options.scales.x.ticks.stepSize;
      return { screen, items, svgLabels, svgArrows, overlap, ticks, step, round: ticks.every(v => Math.abs(Math.round(v / step) * step - v) < 1e-9) && [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].includes(step) }; })()`);
    check(`QA L-107 series ${g}: the SVG's off-scale arrows and values equal the screen's (${st.screen.join(' ') || 'none'})`, JSON.stringify(st.svgLabels) === JSON.stringify(st.screen) && st.svgArrows === st.screen.length &&
      JSON.stringify(st.screen) === JSON.stringify(st.items), JSON.stringify(st));
    check(`QA L-107 series ${g}: clamped values on one side of a row never overlap; ticks on a round step (${(st.step * 100).toFixed(0)}%)`, !st.overlap && st.round, JSON.stringify(st));
  }
  // Departures: Termination is not an administration color; every reason in the tooltip
  await go(base + 'departures.html'); await waitFor(READY); await RD_WAIT('DOJ:all:');
  const tr = await evaluate(`(() => { const ds = OPM.page.frames.reasons.chart.data.datasets; const admin = ['--admin-obama2', '--admin-trump1', '--admin-biden', '--admin-trump2'].map(OPM.chartFrame.token);
    return { term: ds.find(d => d._col === 'sep_termination_nondrp')._color, drp: ds.find(d => d._col === 'sep_drp')._color, admin, mode: OPM.page.frames.reasons.chart.options.interaction.mode }; })()`);
  check('QA Departures Chart B: Termination and DRP are not administration colors; the tooltip lists every reason', !tr.admin.includes(tr.term) && !tr.admin.includes(tr.drp) && tr.mode === 'index', JSON.stringify(tr));
  check('QA Departures: the DRP tile has no "at this point" lines', (await evaluate(`document.querySelectorAll('.opm-tile--drp .opm-tile__at').length`)) === 0);
  // Look-Up: newest first; on a phone the first column is one line with the full name as a tooltip
  await go(base + 'workforce-lookup.html'); await waitFor('!!(window.OPM && OPM.page && OPM.page.loaded === "separations")', 30000);
  const lu = await evaluate(`({ sort: document.querySelector('[data-col="effective"]').parentElement.getAttribute('aria-sort'), first: document.querySelector('.opm-lookup__table tbody tr td').textContent,
    title: document.querySelector('.opm-lookup__table tbody th').getAttribute('title') })`);
  check('QA Look-Up: departures open newest first (Took effect, descending); the first column carries its full name as a tooltip', lu.sort === 'descending' && lu.first === 'Jul 2026' && !!lu.title, JSON.stringify(lu));
  await viewport(390); await go(base + 'workforce-lookup.html'); await waitFor('!!(window.OPM && OPM.page && OPM.page.loaded === "separations")', 30000);
  const lu3 = await evaluate(`(() => { const c = [...document.querySelectorAll('.opm-lookup__table tbody th')].find(x => x.scrollWidth > x.clientWidth) || document.querySelector('.opm-lookup__table tbody th'); const st = getComputedStyle(c);
    return { ws: st.whiteSpace, ov: st.textOverflow, h: Math.round(c.getBoundingClientRect().height), truncated: c.scrollWidth > c.clientWidth, title: c.getAttribute('title'), aria: c.getAttribute('aria-label'), text: c.textContent }; })()`);
  check('QA Look-Up @390: the sticky first column is one line, truncated; a truncated cell carries its full text as title and aria-label (N5)', lu3.ws === 'nowrap' && lu3.ov === 'ellipsis' && lu3.truncated &&
    lu3.title === lu3.text && lu3.aria === lu3.text, JSON.stringify(lu3));
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['workforce-lookup'].add(k));
  await viewport(1280);


  // ---- D-078: the component multi-select. Expected values: the cube rows of the chosen components, summed by hand here.
  const sumRows = (rows, c) => rows.reduce((a, r) => a + r[c], 0);
  const LS2 = JSON.parse(readFileSync(path.join(DATA_DIR, 'doj_leaving.meta.json'), 'utf8'));
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(base + 'index.html'); await waitFor(READY); await RD_WAIT('DOJ:all:');
    const btn0 = await evaluate(`document.querySelector('.opm-multi__text').textContent`);
    await setComps(['DJ02', 'DJ06']); await waitFor(`OPM.page.shown.startsWith('SEL:all:') && OPM.page.shown.endsWith('|DJ02+DJ06')`, 30000);
    const t = await rdTiles(), btn = await evaluate(`document.querySelector('.opm-multi__text').textContent`);
    const two = ['DJ02', 'DJ06'].map(e => admAt(e, 'all', 'trump2', N_DOJ)), twoB = ['DJ02', 'DJ06'].map(e => admAt(e, 'all', 'biden', N_DOJ));
    const ch = sumRows(two, 'headcount_change'), h0 = sumRows(two, 'headcount_0'), bch = sumRows(twoB, 'headcount_change'), bh0 = sumRows(twoB, 'headcount_0');
    const want = [NUM.format(sumRows(two, 'headcount_n')), NUM.format(sumRows(two, 'departures')), NUM.format(sumRows(two, 'hires')), rate1(sumRows(two, 'attrition_num') / sumRows(two, 'rate_den'))];
    check(`D-078 @${width}: FBI + DEA on Overview: the tiles are the two cube rows summed (${want.join(', ')}); the rate is the summed numerator over the summed denominator; "2 components"`,
      btn0 === 'All components' && btn === '2 components' && JSON.stringify(t.map(x => x.value)) === JSON.stringify(want) &&
      t[0].subs[1] === `${signed(ch)} (${pctText(ch / h0)}) since the end of December 2024` && t[0].at[0] === `Biden at this point: ${signed(bch)} (${pctText(bch / bh0)})`, JSON.stringify(t) + ' expect ' + JSON.stringify(want));
    infos.push(`D-078 @${width} FBI + DEA tiles: ` + t.map(x => x.value).join(' | ') + '; ' + t[0].subs[1]);
    const tl = await evaluate(`OPM.page.frames.timeline.chart.data.datasets[0].data.at(-1)`);
    check(`D-078 @${width}: the timeline is the two components' month rows summed`, tl === hc(rowsOf('DJ02', 'month').at(-1)) + hc(rowsOf('DJ06', 'month').at(-1)), String(tl));
    // CRS cannot be combined
    await evaluate(`document.querySelector('.opm-multi__opt[data-value="DJ14"] input').click()`); await RD_WAIT('DJ14:all:');
    const x1 = await evaluate(`({ on: [...document.querySelectorAll('.opm-multi__opt input')].filter(b => b.checked).map(b => b.value), text: document.querySelector('.opm-multi__text').textContent })`);
    await evaluate(`document.querySelector('.opm-multi__opt[data-value="DJ08"] input').click()`); await RD_WAIT('DJ08:all:');
    const x2 = await evaluate(`[...document.querySelectorAll('.opm-multi__opt input')].filter(b => b.checked).map(b => b.value)`);
    check(`D-078 @${width}: Community Relations Service stands alone: choosing it clears the others; choosing another clears it`, x1.on.join() === 'DJ14' && x1.text === 'Community Relations Service (last reported Apr 2026)' && x2.join() === 'DJ08', JSON.stringify({ x1, x2 }));
    // the job series with several components
    await setComps(['DJ02', 'DJ06']); await RD_WAIT('SEL:all:');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '1811'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('SEL:1811:');
    const n18 = admMax('DJ02', '1811', 'trump2'), s18 = ['DJ02', 'DJ06'].map(e => admAt(e, '1811', 'trump2', n18));
    const t18 = await rdTiles();
    check(`D-078 @${width}: FBI + DEA, criminal investigators: the 1811 rows summed`, t18[0].value === NUM.format(sumRows(s18, 'headcount_n')) && t18[3].value === rate1(sumRows(s18, 'attrition_num') / sumRows(s18, 'rate_den')), JSON.stringify(t18.map(x => x.value)));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '0007'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('SEL:0007:');
    const n07 = await evaluate(`document.querySelector('.opm-series-none').hidden ? null : document.querySelector('.opm-series-none').textContent`);
    check(`D-078 @${width}: FBI + DEA have no correctional officers: "no employees in this job series"`, n07 === 'no employees in this job series', String(n07));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('SEL:all:');
    await shot(path.join(SCREENS, `overview-fbi-dea-${width}.png`));
    // the keyboard: Enter opens with focus in the list, arrows move, Space ticks, Escape closes back to the button
    await setComps([]); await RD_WAIT('DOJ:all:');
    await evaluate(`document.querySelector('.opm-multi__button').focus()`);
    const key = async (k, code, kc) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: kc, text: k === ' ' ? ' ' : undefined }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: kc }); await sleep(80); };
    await key('Enter', 'Enter', 13);
    const k1 = await evaluate(`({ open: document.querySelector('.opm-multi__button').getAttribute('aria-expanded'), focus: document.activeElement.className, head: document.querySelector('.opm-multi__head').textContent })`);
    await key('ArrowDown', 'ArrowDown', 40);
    const k2 = await evaluate(`document.activeElement.value`);
    await key(' ', 'Space', 32); await RD_WAIT(await evaluate(`document.activeElement.value`) + ':');
    const k3 = await evaluate(`[...document.querySelectorAll('.opm-multi__opt input')].filter(b => b.checked).map(b => b.value)`);
    await key('Escape', 'Escape', 27);
    const k4 = await evaluate(`({ open: document.querySelector('.opm-multi__button').getAttribute('aria-expanded'), focus: document.activeElement.classList.contains('opm-multi__button'), text: document.querySelector('.opm-multi__text').textContent })`);
    check(`D-078 @${width}: keyboard: Enter opens "Choose components" with focus on "All components", Down moves to the first component, Space ticks it, Escape closes back to the button`,
      k1.open === 'true' && k1.focus === 'opm-multi__all' && k1.head === 'Choose components' && k2 === k3[0] && k3.length === 1 && k4.open === 'false' && k4.focus && k4.text !== 'All components', JSON.stringify({ k1, k2, k3, k4 }));
    // Tab leaves the open list and closes it
    await evaluate(`document.querySelector('.opm-multi__button').focus()`); await key('Enter', 'Enter', 13); await key('Tab', 'Tab', 9); await sleep(100);
    const tb = await evaluate(`({ open: document.querySelector('.opm-multi__button').getAttribute('aria-expanded'), inside: document.querySelector('.opm-multi__pop').contains(document.activeElement) })`);
    check(`D-078 @${width}: Tab inside the list leaves it and closes it`, tb.open === 'false' && !tb.inside, JSON.stringify(tb));
    // D-079: OBD has no criminal investigators; OBD + FBI with 1811 keeps FBI's rate (OBD adds 0 to the numerator and denominator)
    await setComps(['DJ01', 'DJ02']); await waitFor(`OPM.page.shown.endsWith('|DJ01+DJ02')`, 30000);
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '1811'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('SEL:1811:');
    const t79 = await rdTiles(), n79 = admMax('DJ02', '1811', 'trump2');
    const rr = id => ['DJ01', 'DJ02'].map(e => admAt(e, '1811', id, n79)).filter(r => r && r.rate_den !== null && r.rate_den !== 0);
    const r79 = id => rate1(sumRows(rr(id), 'attrition_num') / sumRows(rr(id), 'rate_den'));
    check(`D-079 @${width}: OBD + FBI, criminal investigators: rate ${r79('trump2')} (Trump II), Trump I ${r79('trump1')}, Obama II ${r79('obama2')}: summed over the components with anyone in the group`,
      t79[3].value === r79('trump2') && t79[3].at.join('|') === ['biden', 'trump1', 'obama2'].map(id => `${ANAME[id]} at this point: ${r79(id)}`).join('|') &&
      (AMETA.range.last_month !== '2026-07' || (r79('trump2') === '7.5%' && r79('trump1') === '5.1%' && r79('obama2') === '3.5%')), JSON.stringify(t79[3]));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('SEL:all:');
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['overview'].add(k));
    let e7 = errorsNow(); check(`D-078 Overview @${width}: no console errors`, e7.length === 0, e7.join(' | '));
    // Departures: Chart C sums departures and rate denominators per value
    await go(base + 'departures.html'); await waitFor(READY); await RD_WAIT('DOJ:all:');
    await setComps(['DJ02', 'DJ06']); await RD_WAIT('SEL:all:');
    const dl = await evaluate(`OPM.page.last.who.los.rates[0]`);
    const lrowsE = e => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, LS2.files[e].path), 'utf8')); const c = n => f.columns.indexOf(n);
      return f.rows.filter(r => r[c('grain')] === 'admin_n' && r[c('period')] === 'trump2' && r[c('dimension')] === 'los' && !r[c('is_unknown')]).sort((a, b) => a[c('value_order')] - b[c('value_order')]).map(r => ({ v: r[c('value')], num: r[c('rate_num')], den: r[c('rate_den')] })); };
    const a = lrowsE('DJ02'), b = lrowsE('DJ06');
    const wantL = a.map((x, i) => +((x.num + b[i].num) / (x.den + b[i].den)).toFixed(6));
    check(`D-078 @${width}: Departures Chart C, FBI + DEA: each group's rate is the summed numerator over the summed denominator`, JSON.stringify(dl.map(v => +v.toFixed(6))) === JSON.stringify(wantL), JSON.stringify({ dl, wantL }));
    // D-080: Chart B, FBI + DEA: each of the seven reasons is the summed count over the summed departures (DRP included)
    const nB = await evaluate('OPM.page.last.n');
    const dbS = await evaluate(`OPM.page.last.reasons.map(r => ({ id: r.id, shares: r.shares }))`);
    const wantB = dbS.map(x => { const rs = ['DJ02', 'DJ06'].map(e => admAt(e, 'all', x.id, nB)); return DRP_SEVEN.map(c => sumRows(rs, c) / sumRows(rs, 'departures')); });
    check(`D-080 @${width}: Departures Chart B, FBI + DEA: the seven reasons summed across the components over their summed departures; Trump II has DRP`,
      dbS.length > 0 && dbS.every((x, j) => x.shares.length === 7 && x.shares.every((v, k) => Math.abs(v - wantB[j][k]) < 1e-12)) && dbS[0].id === 'trump2' && dbS[0].shares[0] > 0, JSON.stringify({ dbS, wantB }));
    // D-079: BOP + USMS + OIG by occupation: USMS and OIG have no correctional officers, BOP no criminal investigators; the others carry the rate
    await setComps(['DJ03', 'DJ08', 'DJ10']); await waitFor(`OPM.page.shown.endsWith('|DJ03+DJ08+DJ10')`, 30000);
    const occ = await evaluate(`({ values: OPM.page.last.who.occ.values, rates: OPM.page.last.who.occ.rates[0], labels: OPM.page.frames.who_occ.chart.data.datasets[0]._labels })`);
    const occRows = (v) => ['DJ03', 'DJ08', 'DJ10'].map(e => { const f = JSON.parse(readFileSync(path.join(DATA_DIR, LS2.files[e].path), 'utf8')); const c = n => f.columns.indexOf(n);
      const r = f.rows.find(x => x[c('grain')] === 'admin_n' && x[c('period')] === 'trump2' && x[c('dimension')] === 'occupation' && x[c('value')] === v); return { num: r[c('rate_num')], den: r[c('rate_den')], na: r[c('rate_not_applicable')] }; }).filter(x => !x.na && x.den);
    const occRate = v => occRows(v).reduce((a, x) => a + x.num, 0) / occRows(v).reduce((a, x) => a + x.den, 0);
    const i18 = occ.values.indexOf('1811'), i07 = occ.values.indexOf('0007');
    check(`D-079 @${width}: Departures Chart C, BOP + USMS + OIG by occupation: criminal investigators ${occRate('1811').toFixed(4)} and correctional officers ${occRate('0007').toFixed(4)} (Trump II), not "not applicable"`,
      Math.abs(occ.rates[i18] - occRate('1811')) < 1e-12 && Math.abs(occ.rates[i07] - occRate('0007')) < 1e-12 && occ.labels[i18] !== 'not applicable: no employees in this group' &&
      (AMETA.range.last_month !== '2026-07' || (occRate('1811').toFixed(4) === '0.0621' && occRate('0007').toFixed(4) === '0.1210')), JSON.stringify(occ));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['departures'].add(k));
    // Components: every component still shown; the chosen highlighted; their total under DOJ
    await go(base + 'components.html'); await waitFor(READY); await RD_WAIT('all:');
    await setComps(['DJ02', 'DJ06']); await RD_WAIT('all:obama2,trump1,biden:DJ02+DJ06');
    const cs = await evaluate(`({ sel: [...document.querySelectorAll('.opm-compare__table--components tr.opm-compare__selected')].map(tr => tr.dataset.entity), rows: document.querySelectorAll('.opm-compare__table--components tbody tr').length,
      total: [...document.querySelector('.opm-compare__table--components tr.opm-compare__total').children].map(c => c.textContent), second: document.querySelector('.opm-compare__table--components tbody tr:nth-child(2)').dataset.entity,
      bars: OPM.page.frames.chart.chart.data.datasets[0]._selected.filter(Boolean).length, minis: [...document.querySelectorAll('.opm-multiple--selected')].map(m => m.dataset.entity) })`);
    const wantT = ['Selected components (2)', NUM.format(sumRows(two, 'headcount_n')), signed(ch) + ' (' + pctText(ch / h0) + ')', NUM.format(sumRows(two, 'departures')), rate1(sumRows(two, 'attrition_num') / sumRows(two, 'rate_den')),
      ...AT.map(id => { const rr = ['DJ02', 'DJ06'].map(e => admAt(e, 'all', id, N_DOJ)); return pctText(sumRows(rr, 'headcount_change') / sumRows(rr, 'headcount_0')); })];
    check(`D-078 @${width}: Components: every component still listed; FBI and DEA highlighted in the table, the bars and the minis; "Selected components (2)" under DOJ with the summed figures`,
      JSON.stringify(cs.sel.sort()) === JSON.stringify(['DJ02', 'DJ06']) && cs.rows === 14 && cs.second === 'SEL' && JSON.stringify(cs.total) === JSON.stringify(wantT) && cs.bars === 2 && cs.minis.sort().join() === 'DJ02,DJ06', JSON.stringify(cs) + ' expect ' + JSON.stringify(wantT));
    await shot(path.join(SCREENS, `components-fbi-dea-${width}.png`));
    const ol = await evaluate(`(() => { const d = new DOMParser().parseFromString(OPM.page.frames.chart.svg(), 'image/svg+xml'); return d.querySelectorAll('.opm-svg-outline').length; })()`);
    check(`D-078 @${width}: the chart's SVG carries the selection outline on the two chosen bars`, ol === 2, String(ol));
    await setComps(['DJ01', 'DJ02']); await RD_WAIT('all:obama2,trump1,biden:DJ01+DJ02');
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = '1811'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('1811:');
    const ct79 = await evaluate(`[...document.querySelector('.opm-compare__table--components tr.opm-compare__total').children].map(c => c.textContent)`);
    const n2 = admMax('DJ02', '1811', 'trump2'), fb = admAt('DJ02', '1811', 'trump2', n2);
    check(`D-079 @${width}: Components total row, OBD + FBI with criminal investigators: rate ${rate1(fb.attrition_num / fb.rate_den)} (FBI's; OBD has none)`, ct79[0] === 'Selected components (2)' && ct79[4] === rate1(fb.attrition_num / fb.rate_den) &&
      ct79[1] === NUM.format(fb.headcount_n), JSON.stringify(ct79));
    await evaluate(`(() => { const s = document.querySelector('.opm-field--series select'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await RD_WAIT('all:');
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed['components-view'].add(k));
    e7 = errorsNow(); check(`D-078 Departures and Components @${width}: no console errors`, e7.length === 0, e7.join(' | '));
  }
  await viewport(1280);
  // ---- data not available
  for (const width of [1280, 390]) for (const [file, pageId] of Object.entries(DATA_PAGES)) {
    await viewport(width);
    await go(bareBase + file); await waitFor(READY);
    const u = await evaluate('({ un: !!(OPM.page && OPM.page.unavailable), text: (document.querySelector(".opm-unavailable") || {}).textContent, charts: document.querySelectorAll("canvas").length })');
    check(`no data ${file} @${width}: page shows "Data not available." and no charts`, u.un && u.text === 'Data not available.' && u.charts === 0, JSON.stringify(u));
    const errs = errorsNow(/404.*\/data\/(doj_(core|leaving|admin)|lookup)/);
    check(`no data ${file} @${width}: no errors besides the 404s for the data files`, errs.length === 0, errs.join(' | '));
    if (width === 1280 && file === 'index.html') await shot(path.join(SCREENS, 'overview-no-data-1280.png'));
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
      hr.lions > 0 && Math.abs(hr.last - hr.content) <= 1 && Math.abs(hr.frame - hr.last) <= 1 && hr.opm && hr.opm.height === hr.last && hr.opm.page === 'overview', JSON.stringify(hr));

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
