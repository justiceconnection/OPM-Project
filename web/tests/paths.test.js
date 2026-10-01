'use strict';
/* The site is served from a subpath (https://justiceconnection.github.io/OPM-Project/), so every URL in the
   pages, stylesheets and scripts must be relative: no leading "/" and no protocol-relative "//". External
   absolute URLs (the Google Fonts stylesheet) are allowed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../tools/stamp-lib.js');

const WEB = path.join(__dirname, '..');
const served = S.servedFiles();

test('HTML: every src and href is relative or an external https URL', () => {
  const bad = [];
  for (const f of served.filter(x => x.endsWith('.html')).concat(['tests/embed-harness.html'])) {
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    for (const m of html.matchAll(/\b(src|href)="([^"]*)"/g)) {
      const u = m[2];
      if (/^https:\/\//.test(u) || /^(data:|#|mailto:)/.test(u)) continue;
      if (u.startsWith('/')) bad.push(f + ': ' + u);
    }
  }
  assert.deepEqual(bad, []);
});

test('CSS and JS: no root-relative URLs', () => {
  const bad = [];
  for (const f of served.filter(x => /\.(css|js)$/.test(x) && !x.includes('/vendor/'))) {
    const src = fs.readFileSync(path.join(WEB, f), 'utf8');
    for (const m of src.matchAll(/url\(\s*['"]?(\/[^)'"]*)/g)) bad.push(f + ': url(' + m[1] + ')');
    for (const m of src.matchAll(/['"`](\/(?:data|assets|tests)\/[^'"`]*|\/[a-z-]+\.html[^'"`]*)['"`]/g)) bad.push(f + ': ' + m[1]);
    if (/location\.(pathname|origin)/.test(src)) bad.push(f + ': builds URLs from location');
  }
  assert.deepEqual(bad, []);
});
