#!/usr/bin/env node
/* Copy audit: which copy.json keys each page can show, and whether the page reads web/data.
   A static parse; no browser. The gate runs `node web/tools/copy-audit.js --json` and fails when a
   page that reads web/data uses an unsigned key.

   Usage: node web/tools/copy-audit.js [--json] [--check]
     --json   print the report below as JSON (stable: pages sorted by file, keys sorted by ref)
     --check  exit 1 if any page that reads data has an unsigned key, or the audit has errors
     (none)   print a short human summary

   Output (format "opm-copy-audit/1"):
   {
     "format": "opm-copy-audit/1",
     "pages": [
       {
         "file": "index.html",              HTML file under web/
         "page": "workforce-size",          its data-page id
         "readsData": true,                 a script it loads names a 'data/...' file
         "dataFiles": ["data/doj_core.json", "data/doj_core.meta.json"],
         "scripts": ["assets/js/dom.js", ...],   local scripts in load order, stamp removed
         "keys": [{ "ref": "shell:nav.label", "status": "signed" }, ...],   every key the page can show
         "unsigned": ["..."],               refs in keys whose status is not signed, minus exempt
         "exempt": ["shell:site.draftNotice"],   used but not counted (the draft badge's own text)
         "errors": []                       problems found for this page
       }
     ],
     "errors": []                           problems not tied to one page
   }
   A ref is "section:key" with section 'shell', 'components' or a page id ('page:' is resolved).

   How keys are found:
   - data-copy="section:key" attributes in the HTML;
   - literal calls copy.t('section:key' ...) and copy.raw('section:key' ...) in the page's scripts
     (copy.peek(...) reads without using and is not counted);
   - directives in a script comment, for lookups a literal parse cannot see:
       copy-audit: <ref> [<ref> ...]      refs used dynamically; 'section:*' = every key in the
                                          section; 'pages:<key>' = that key in every page section
       copy-audit: exempt <ref>           used, but not counted toward unsigned (the badge text)
       copy-audit: data-copy              the file fills the HTML's data-copy refs (parsed above)
       copy-audit: if-nonempty <ref> then <ref> [<ref> ...]
                                          the listed refs, literal calls included, count only while
                                          the value at the first ref is a non-empty list or string
   A script with a dynamic call (a first argument that is not one whole string literal) and no
   directive is an error, so nothing can be used without the audit seeing it. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEB = path.resolve(__dirname, '..');
const FORMAT = 'opm-copy-audit/1';

function sections(copy) {
  const out = { shell: copy.shell, components: copy.components };
  for (const [id, sec] of Object.entries(copy.pages)) out[id] = sec;
  return out;
}

function htmlInfo(file) {
  const html = fs.readFileSync(path.join(WEB, file), 'utf8');
  const page = (/<body[^>]*data-page="([^"]+)"/.exec(html) || [])[1] || null;
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1].split('?')[0]).filter(s => !/^(https?:)?\/\//.test(s));
  const dataCopy = [...html.matchAll(/data-copy="([^"]+)"/g)].map(m => m[1]);
  return { page, scripts, dataCopy };
}

/* Everything one script says about copy. */
function scanScript(src) {
  const literal = [], dynamic = [], directives = [];
  for (const m of src.matchAll(/copy\.(t|raw)\(\s*/g)) {
    const rest = src.slice(m.index + m[0].length);
    const lit = /^'([a-zA-Z0-9_-]+:[^']+)'\s*[,)]/.exec(rest);
    if (lit) literal.push(lit[1]); else dynamic.push(rest.slice(0, 40).split('\n')[0]);
  }
  for (const m of src.matchAll(/copy-audit:[ \t]*([^\n]+)/g)) {
    const words = m[1].replace(/\*\/.*$/, '').trim().split(/\s+/);
    if (words[0] === 'exempt') directives.push({ kind: 'exempt', refs: words.slice(1) });
    else if (words[0] === 'data-copy') directives.push({ kind: 'data-copy' });
    else if (words[0] === 'if-nonempty') {
      const t = words.indexOf('then');
      directives.push({ kind: 'if-nonempty', cond: words[1], refs: t > 0 ? words.slice(t + 1) : [] });
    } else directives.push({ kind: 'use', refs: words });
  }
  return { literal, dynamic, directives };
}

function auditPage(file, copy) {
  const secs = sections(copy);
  const info = htmlInfo(file);
  const errors = [];
  const used = new Set(), exempt = new Set(), conditional = new Map(); // ref -> condition met?
  const resolve = ref => ref.startsWith('page:') ? info.page + ':' + ref.slice(5) : ref;
  const expand = ref => {
    const r = resolve(ref), i = r.indexOf(':'), sec = r.slice(0, i), key = r.slice(i + 1);
    if (sec === 'pages') return Object.keys(copy.pages).map(id => id + ':' + key);
    if (key === '*') return Object.keys(secs[sec] || {}).filter(k => k !== '_status').map(k => sec + ':' + k);
    return [r];
  };
  const valueAt = ref => { const r = resolve(ref), i = r.indexOf(':'); const s = secs[r.slice(0, i)]; return s ? s[r.slice(i + 1)] : undefined; };
  const nonEmpty = v => (Array.isArray(v) || typeof v === 'string') && v.length > 0;

  info.dataCopy.forEach(r => used.add(resolve(r)));
  const dataFiles = new Set();
  for (const s of info.scripts) {
    const p = path.join(WEB, s);
    if (!fs.existsSync(p)) { errors.push('missing script ' + s); continue; }
    if (s.includes('/vendor/')) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/['"](data\/[^'"\s]+)['"]/g)) dataFiles.add(m[1]);
    const scan = scanScript(src);
    for (const d of scan.directives) {
      if (d.kind === 'if-nonempty') {
        const met = nonEmpty(valueAt(d.cond));
        d.refs.forEach(r => expand(r).forEach(x => conditional.set(x, met)));
      }
    }
    scan.literal.map(resolve).forEach(r => { if (!conditional.has(r)) used.add(r); });
    for (const d of scan.directives) {
      if (d.kind === 'use') d.refs.forEach(r => expand(r).forEach(x => used.add(x)));
      if (d.kind === 'exempt') d.refs.forEach(r => expand(r).forEach(x => { used.add(x); exempt.add(x); }));
    }
    if (scan.dynamic.length && !scan.directives.length) errors.push(s + ': dynamic copy lookup without a copy-audit directive: ' + scan.dynamic.join(' | '));
  }
  for (const [r, met] of conditional) if (met) used.add(r);

  const keys = [...used].sort().map(ref => {
    const i = ref.indexOf(':'), sec = secs[ref.slice(0, i)], key = ref.slice(i + 1);
    if (!sec || !(key in sec) || key === '_status') { errors.push('unknown copy key ' + ref); return { ref, status: 'missing' }; }
    return { ref, status: (sec._status || {})[key] || 'missing' };
  });
  return {
    file, page: info.page, readsData: dataFiles.size > 0, dataFiles: [...dataFiles].sort(), scripts: info.scripts,
    keys, unsigned: keys.filter(k => k.status !== 'signed' && !exempt.has(k.ref)).map(k => k.ref), exempt: [...exempt].sort(), errors
  };
}

function htmlFiles() {
  return fs.readdirSync(WEB).filter(f => f.endsWith('.html')).sort();
}

function audit() {
  const errors = [];
  let copy;
  try { copy = JSON.parse(fs.readFileSync(path.join(WEB, 'copy.json'), 'utf8')); } catch (e) { return { format: FORMAT, pages: [], errors: ['copy.json: ' + e.message] }; }
  return { format: FORMAT, pages: htmlFiles().map(f => auditPage(f, copy)), errors };
}

/* A hash of what decides a page's copy use: copy.json and the page's own scripts. The smoke test
   stores it next to the runtime list, so a stale runtime list is detected. */
function sourcesHash(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(path.join(WEB, 'copy.json')));
  for (const s of htmlInfo(file).scripts) if (!s.includes('/vendor/')) h.update(fs.readFileSync(path.join(WEB, s)));
  h.update(fs.readFileSync(path.join(WEB, file)));
  return h.digest('hex');
}

if (require.main === module) {
  const report = audit();
  const bad = report.errors.length > 0 || report.pages.some(p => p.errors.length || (p.readsData && p.unsigned.length));
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    for (const p of report.pages) {
      console.log(`${p.file} (${p.page}): ${p.keys.length} keys, ${p.unsigned.length} unsigned${p.readsData ? ', reads ' + p.dataFiles.join(', ') : ''}` +
        (p.unsigned.length ? ': ' + p.unsigned.join(', ') : '') + (p.errors.length ? ' ERRORS: ' + p.errors.join('; ') : ''));
    }
    report.errors.forEach(e => console.log('ERROR ' + e));
  }
  if (process.argv.includes('--check') && bad) process.exit(1);
}

module.exports = { FORMAT, audit, auditPage, scanScript, sourcesHash };
