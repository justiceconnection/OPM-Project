#!/usr/bin/env node
/* Copy sheet: a readable list of every string each dashboard page shows, for editing in a Google Doc.
   Reads web/copy.json and the copy audit (which keys each page can show); writes HTML that Google Docs
   imports with headings and tables intact (upload to Drive, then Open with > Google Docs).

   Usage: node web/tools/copy-sheet.js [outDir]      (default: copy-sheets/ at the repo root, git-ignored)
   Writes copy-sheet.html (all pages, one section each) and one <page>.html per section.

   Sections: one per page in the site navigation, in nav order, holding the keys only that page uses;
   "Every page" for keys all of them use (header, navigation, footer); "Shared labels" for keys used on
   some pages but not all, and the component, series and job series names. Within a section, keys are in
   order of first appearance in the page's HTML and scripts (page script first); keys a script looks up
   by a computed name come last. The hidden history-*.html pages are left out. Read-only: changes nothing. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WEB = path.join(__dirname, '..');
const ROOT = path.join(WEB, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'copy-sheets'));
const copy = JSON.parse(fs.readFileSync(path.join(WEB, 'copy.json'), 'utf8'));
const audit = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'copy-audit.js'), '--json'], { encoding: 'utf8' }));

// Pages in navigation order (shell.js), with the HTML file each nav item opens.
const NAV = [['index.html', 'overview'], ['departures.html', 'departures'], ['components.html', 'components-view'],
  ['appointments.html', 'appointments'], ['workforce-lookup.html', 'workforce-lookup'], ['reading-the-data.html', 'reading-the-data']];
const pages = NAV.map(([file, id]) => {
  const p = audit.pages.find(x => x.file === file);
  if (!p) throw new Error('copy audit has no ' + file);
  return { file, id, keys: p.keys.map(k => k.ref), scripts: p.scripts };
});

function section(name) { return name === 'shell' || name === 'components' || name === 'series' || name === 'series_names' ? copy[name] : copy.pages[name]; }
function lookup(ref) {
  const i = ref.indexOf(':'), sec = section(ref.slice(0, i)), key = ref.slice(i + 1);
  return { text: sec && sec[key], status: sec && sec._status && sec._status[key] };
}
function shown(v) { return Array.isArray(v) ? v.join(', ') : String(v); }
const EMPTY = '(empty: shows nothing)';

// Order of first appearance: the page's HTML (data-copy), then its own pages/*.js, then the other scripts.
function order(p) {
  const html = fs.readFileSync(path.join(WEB, p.file), 'utf8');
  const own = p.scripts.filter(s => s.startsWith('assets/js/pages/'));
  const srcs = [html].concat(own.concat(p.scripts.filter(s => !own.includes(s) && !s.includes('/vendor/')))
    .map(s => fs.readFileSync(path.join(WEB, s), 'utf8')));
  const pos = {};
  p.keys.forEach(ref => {
    const [sec, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    const names = [ref, 'page:' + key].filter((x, i) => i === 0 || sec === p.id);
    for (let i = 0; i < srcs.length && pos[ref] == null; i++) {
      for (const n of names) {
        const at = Math.min(...['"' + n + '"', "'" + n + "'"].map(q => { const j = srcs[i].indexOf(q); return j < 0 ? Infinity : j; }));
        if (at < Infinity) { pos[ref] = i * 1e7 + at; break; }
      }
    }
  });
  return ref => (pos[ref] == null ? 9e9 : pos[ref]);
}

const usedBy = {};
pages.forEach(p => p.keys.forEach(ref => { (usedBy[ref] = usedBy[ref] || []).push(p.id); }));
const navName = id => { const p = pages.find(x => x.id === id); return lookup('shell:nav.' + ({ overview: 'overview', departures: 'departures', 'components-view': 'components', appointments: 'appointments', 'workforce-lookup': 'lookup', 'reading-the-data': 'reading' }[id])).text || p.file; };
const labelSection = ref => /^(components|series|series_names):/.test(ref);

const sheets = pages.map(p => {
  const pos = order(p);
  const refs = p.keys.filter(r => usedBy[r].length === 1 && !labelSection(r)).sort((a, b) => pos(a) - pos(b));
  return { id: p.id, title: navName(p.id), file: p.file, refs };
});
const all = Object.keys(usedBy).filter(r => usedBy[r].length === pages.length && !labelSection(r));
const some = Object.keys(usedBy).filter(r => usedBy[r].length > 1 && usedBy[r].length < pages.length && !labelSection(r)).sort();
const labels = Object.keys(usedBy).filter(labelSection).sort();
const firstPos = order(pages[0]);
sheets.push({ id: 'every-page', title: 'Every page (header, navigation, footer)', refs: all.sort((a, b) => firstPos(a) - firstPos(b)) });
sheets.push({ id: 'shared', title: 'Shared labels (used on several pages)', refs: some.concat(labels), shared: true });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = s => esc(s).replace(/\{(\w+)\}/g, '<b>{$1}</b>');
function table(sh) {
  const rows = sh.refs.map((ref, i) => {
    const { text, status } = lookup(ref);
    const where = sh.shared ? usedBy[ref].map(navName).join(', ') : '';
    return `<tr><td>${i + 1}</td><td>${shown(text) === '' ? '<i>' + EMPTY + '</i>' : mark(shown(text))}${status === 'signed' ? '' : ' <i>(draft)</i>'}</td>` +
      (sh.shared ? `<td>${esc(where)}</td>` : '') + `<td><code>${esc(ref)}</code></td></tr>`;
  }).join('\n');
  return `<h1>${esc(sh.title)}</h1>\n<p>${sh.file ? 'Page: ' + esc(sh.file) + '. ' : ''}${sh.refs.length} strings.</p>\n` +
    `<table border="1" cellpadding="4" style="border-collapse:collapse">\n<tr><th>#</th><th>Text</th>${sh.shared ? '<th>Used on</th>' : ''}<th>Key (do not edit)</th></tr>\n${rows}\n</table>`;
}
const d = new Date(), z = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
const intro = `<p><b>Dashboard copy sheet</b>, generated ${stamp} from web/copy.json (${Object.keys(usedBy).length} strings). ` +
  `Edit the Text column only; keep the Key column as it is so each change can be matched back. Words in bold braces, such as ` +
  `<b>{month}</b>, are filled in with figures on the page: keep them. A change goes live only after it is signed off and applied ` +
  `to copy.json. Strings marked (draft) are not yet signed.</p>`;
const doc = body => `<!doctype html><html><head><meta charset="utf-8"><title>Dashboard copy sheet</title></head><body>\n${intro}\n${body}\n</body></html>\n`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'copy-sheet.html'), doc(sheets.map(table).join('\n<br style="page-break-before:always">\n')));
sheets.forEach(sh => fs.writeFileSync(path.join(OUT, sh.id + '.html'), doc(table(sh))));
const n = sheets.reduce((a, s) => a + s.refs.length, 0);
console.log(`wrote ${sheets.length} sections, ${n} strings to ${path.relative(ROOT, OUT) || '.'}/ (copy-sheet.html + one file per section)`);
if (n !== Object.keys(usedBy).length) { console.error(`section total ${n} != ${Object.keys(usedBy).length} keys used`); process.exit(1); }
