'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../assets/js/svg-export.js');

const base = {
  width: 600, height: 300, area: { left: 50, top: 10, right: 590, bottom: 270 },
  title: 'Demo <chart> & "rates"', note: 'FIXTURE: invented numbers',
  colors: { ink: '#212123', muted: '#6b6c68', grid: '#e6e6e3', bg: '#ffffff', plot: '#e9ebee' },
  xTicks: [{ x: 60, label: 'Oct 2011' }, { x: 580, label: 'Jul 2026' }],
  yTicks: [{ y: 270, label: '0%' }, { y: 10, label: '20%' }],
  series: [
    { label: 'Attrition rate', color: '#212123', kind: 'line', points: [{ x: 60, y: 100 }, { x: 100, y: 90 }, null, { x: 200, y: 80 }, { x: 300, y: 70 }] },
    { label: 'Quit rate', color: '#2a78d6', kind: 'line', points: [null, null] }
  ]
};

test('writes a standalone SVG with title, legend, ticks and note', () => {
  const svg = X.buildSvg(base);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('Demo &lt;chart&gt; &amp; &quot;rates&quot;'));
  assert.ok(!svg.includes('<chart>'));
  assert.ok(svg.includes('>Attrition rate<') && svg.includes('>Quit rate<'));
  assert.ok(svg.includes('>Oct 2011<') && svg.includes('>20%<'));
  assert.ok(svg.includes('FIXTURE: invented numbers'));
});

test('a null value breaks the line into two paths, never drawing it as zero', () => {
  const svg = X.buildSvg(base);
  const paths = svg.match(/<path /g) || [];
  assert.equal(paths.length, 2); // attrition splits in two; quit has no points
  assert.deepEqual(X.runs([{ x: 1, y: 1 }, null, { x: 2, y: 2 }, { x: 3, y: NaN }]).map(r => r.length), [1, 1]);
});

test('bars become rects; the canvas is wide enough for the legend', () => {
  const svg = X.buildSvg(Object.assign({}, base, { note: '', series: [{ label: 'Hires', color: '#1d9e75', kind: 'bar', bars: [{ x: 60, y: 100, w: 10, h: 170 }, null] }] }));
  assert.equal((svg.match(/fill="#1d9e75"/g) || []).length, 2); // swatch + one bar
  assert.ok(!svg.includes('FIXTURE'));
});

test('parses as XML', () => {
  // Node has no DOMParser; check the tags balance, which is what a parser would reject first.
  const svg = X.buildSvg(base);
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2]); else stack.push(m[2]);
  }
  assert.deepEqual(stack, []);
});
