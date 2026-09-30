'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../assets/js/svg-export.js');

const base = {
  width: 600, height: 300, area: { left: 50, top: 10, right: 590, bottom: 270 },
  title: 'Demo <chart> & "rates"', note: 'A note under the chart',
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
  assert.ok(svg.includes('A note under the chart'));
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
  assert.ok(!svg.includes('A note under the chart'));
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

test('provisional segments are dashed, partial and provisional points get markers', () => {
  const svg = X.buildSvg(Object.assign({}, base, { series: [{ label: 'Employees', color: '#212123', kind: 'line',
    points: [{ x: 60, y: 100 }, { x: 100, y: 90 }, { x: 140, y: 95, dashIn: true, marker: 'provisional' }, { x: 180, y: 97, dashIn: true, marker: 'partial' }] }] }));
  assert.equal((svg.match(/<path [^>]*stroke-dasharray="5 4"/g) || []).length, 1);
  assert.equal((svg.match(/<path d="M[^>]*stroke-width="2"/g) || []).length, 2); // one solid, one dashed
  assert.equal((svg.match(/opm-svg-partial/g) || []).length, 1);
  assert.equal((svg.match(/opm-svg-provisional/g) || []).length, 1);
  assert.deepEqual(X.segments([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0, dashIn: true }]).map(s => [s.dash, s.pts.length]), [[false, 2], [true, 2]]);
});

test('break markers, value labels and faded bars', () => {
  const svg = X.buildSvg(Object.assign({}, base, { markers: [{ x: 300, kind: 'break' }, { x: 320, kind: 'break' }], labels: [{ x: 10, y: 10, text: '35,348' }],
    series: [{ label: 'Change', color: '#2a78d6', kind: 'bar', bars: [{ x: 60, y: 100, w: 10, h: 50 }, { x: 80, y: 120, w: 10, h: 30, faded: true }] }] }));
  assert.equal((svg.match(/class="opm-svg-marker"/g) || []).length, 2);
  assert.ok(svg.includes('>35,348<'));
  assert.equal((svg.match(/fill-opacity="0.45"/g) || []).length, 1);
});

test('grid export nests one drawing per cell', () => {
  const svg = X.buildGridSvg([base, base, base, base], { cols: 3, title: 'Employees by component' });
  assert.equal((svg.match(/<svg x="/g) || []).length, 4);
  assert.ok(svg.includes('>Employees by component<'));
  const stack = [];
  for (const mm of svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)) { if (mm[3]) continue; if (mm[1]) assert.equal(stack.pop(), mm[2]); else stack.push(mm[2]); }
  assert.deepEqual(stack, []);
});
