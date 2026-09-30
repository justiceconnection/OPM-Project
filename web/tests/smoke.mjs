#!/usr/bin/env node
/* Browser smoke test. Drives headless Chrome over the DevTools protocol (Node's built-in
   WebSocket; no packages) and saves screenshots.
   Two servers (python3 -m http.server):
   - SITE: a copy of web/ assembled in a temp directory, without web/data/ if it exists, with the
     cube files from --data-dir (default warehouse/cubes/) placed at data/.
   - BARE: a second temp copy of web/ without data/, to check the "data not available" state.
   Neither run depends on whether web/data/ exists (the gate's promoted_matches_staged owns that).
   Usage: node web/tests/smoke.mjs [--data-dir <dir>] [--screens <dir>] */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
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
const RUNTIME_FILE = path.join(WEB, 'tests', 'runtime-copy-workforce-size.json');
const runtimeUsed = new Set();
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

// ---- served trees and processes
const skipCopy = src => src.includes(path.sep + '_screens') || src === path.join(WEB, 'data') || src.startsWith(path.join(WEB, 'data') + path.sep);
const site = path.join(mkdtempSync(path.join(tmpdir(), 'opm-site-')), 'site');
cpSync(WEB, site, { recursive: true, filter: src => !skipCopy(src) });
const bareSite = path.join(mkdtempSync(path.join(tmpdir(), 'opm-bare-')), 'site');
cpSync(WEB, bareSite, { recursive: true, filter: src => !skipCopy(src) });
mkdirSync(path.join(site, 'data'));
for (const f of CUBE_FILES) cpSync(path.join(DATA_DIR, f), path.join(site, 'data', f));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', site], { stdio: 'ignore' });
const bare = spawn('python3', ['-m', 'http.server', String(PORT_BARE), '--bind', '127.0.0.1', '--directory', bareSite], { stdio: 'ignore' });
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
const noScroll = `(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
  wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).map(e => e.tagName + '.' + e.className).slice(0, 5) }))()`;
const READY = '!!(window.OPM && OPM.page && (OPM.page.unavailable || OPM.page.frames))';
const setGrain = g => evaluate(`document.querySelector('.opm-field--grain [data-value="${g}"]').click()`);
const setEntity = e => evaluate(`(() => { const s = document.querySelector('.opm-field--component select'); s.value = '${e}'; s.dispatchEvent(new Event('change')); })()`);
const tiles = () => evaluate(`[...document.querySelectorAll('.opm-tile')].map(t => ({ name: t.querySelector('.opm-tile__name').textContent, value: t.querySelector('.opm-tile__value').textContent,
  subs: [...t.querySelectorAll('.opm-tile__sub')].map(s => s.textContent), badge: !!t.querySelector('.opm-tile__prov') }))`);
const labels = id => evaluate(`OPM.page.frames.${id}.chart.data.labels`);
const notes = id => evaluate(`[...OPM.page.frames.${id}.notes.querySelectorAll('p')].map(p => p.textContent + (p.querySelector('a') ? ' ->' + p.querySelector('a').getAttribute('href') : ''))`);

try {
  await getJson(`http://127.0.0.1:${PORT}/copy.json`);
  await getJson(`http://127.0.0.1:${PORT_BARE}/copy.json`);
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
  const base = `http://127.0.0.1:${PORT}/`, bareBase = `http://127.0.0.1:${PORT_BARE}/`;

  // ---- every page, both widths
  for (const width of [1280, 390]) {
    await viewport(width);
    for (const p of PAGES) {
      await go(base + p);
      const ready = await waitFor(p === 'index.html' ? READY : '!!document.querySelector(".opm-nav__link")');
      const info = await evaluate(`({ title: document.title, h1: document.querySelector('h1').textContent, navLinks: document.querySelectorAll('.opm-nav__link').length,
        current: [...document.querySelectorAll('.opm-nav__link[aria-current="page"]')].map(a => a.getAttribute('href')), footer: document.querySelector('.opm-footer').textContent,
        draft: !document.querySelector('.opm-brand__draft').hidden })`);
      const sc = await evaluate(noScroll);
      const tag = `${p} @${width}`;
      check(`${tag}: shell rendered`, ready && info.navLinks === 6 && info.h1 && info.title.includes(info.h1), JSON.stringify(info) + ' ' + errorsNow().join(' | '));
      check(`${tag}: current page marked`, info.current.length === 1 && info.current[0] === p, info.current.join(','));
      check(`${tag}: no horizontal scroll`, sc.sw <= sc.iw && sc.wide.length === 0, JSON.stringify(sc));
      if (p === 'index.html') check(`${tag}: draft badge off (every string the page uses is signed)`, !info.draft);
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
    check(`FY/DOJ @${width}: panel 3 note and break link`, n3[0].startsWith('These are counted from different OPM files') && n3.some(x => x === 'Known gap; see Reading the data. ->reading-the-data.html'), n3.join(' | '));
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
  (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed.add(k));
  check('interactions: no console errors', errorsNow().length === 0, errorsNow().join(' | '));

  // ---- data not available
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(bareBase + 'index.html'); await waitFor(READY);
    const u = await evaluate('({ un: !!(OPM.page && OPM.page.unavailable), text: (document.querySelector(".opm-unavailable") || {}).textContent, charts: document.querySelectorAll("canvas").length })');
    check(`no data @${width}: page shows "Data not available." and no charts`, u.un && u.text === 'Data not available.' && u.charts === 0, JSON.stringify(u));
    const errs = errorsNow(/404.*\/data\/doj_core/);
    check(`no data @${width}: no errors besides the two 404s for data/`, errs.length === 0, errs.join(' | '));
    if (width === 1280) await shot(path.join(SCREENS, 'workforce-size-no-data-1280.png'));
    (await evaluate('OPM.shell.usedCopy()')).forEach(k => runtimeUsed.add(k));
  }

  // ---- Framer height reporter, framed
  for (const width of [1280, 390]) {
    await viewport(width);
    await go(base + 'tests/embed-harness.html');
    await waitFor('window.__heights.length > 0', 10000);
    await sleep(1200);
    const hr = await evaluate(`(() => { const f = document.getElementById('f'); const inner = f.contentDocument.getElementById('page');
      return { msgs: window.__heights.length, last: window.__heights.at(-1), content: Math.ceil(inner.getBoundingClientRect().bottom), frame: f.getBoundingClientRect().height }; })()`);
    check(`height reporter @${width}: parent receives opm:height matching the content`, hr.msgs > 0 && Math.abs(hr.last.height - hr.content) <= 1 && hr.last.page === 'workforce-size' && Math.abs(hr.frame - hr.content) <= 1, JSON.stringify(hr));
  }
  await viewport(1280);
  await go(base + 'index.html'); await waitFor('!!(window.OPM && OPM.shell.reporter)');
  check('height reporter unframed: posts nothing', (await evaluate('OPM.shell.reporter.isFramed()')) === false);
  // the runtime copy list (data and no-data runs together), for tests/copy-audit.test.js
  writeFileSync(RUNTIME_FILE, JSON.stringify({ _note: 'Written by web/tests/smoke.mjs. Keys Workforce size used at runtime, data and no-data runs together.',
    page: 'workforce-size', file: 'index.html', sourcesHash: audit.sourcesHash('index.html'), used: [...runtimeUsed].sort() }, null, 2) + '\n');
  infos.push('runtime copy list written: ' + runtimeUsed.size + ' keys -> ' + path.relative(REPO, RUNTIME_FILE));
} catch (e) {
  check('smoke run completed', false, e.stack || String(e));
} finally {
  try { ws && ws.close(); } catch {}
  cleanup();
}

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + r.detail)); }
for (const i of infos) console.log('INFO ' + i);
console.log(`\n${results.length - fail} of ${results.length} smoke checks pass. Data: ${DATA_DIR} (served from a temp copy). Screenshots: ${SCREENS}`);
process.exit(fail ? 1 : 0);
