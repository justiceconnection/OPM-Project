'use strict';
/* Contrast of the design tokens (L-103 visual QA; WCAG 1.4.3 text 4.5:1, 1.4.11 non-text 3:1), computed from
   assets/tokens.css itself. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tokens.css'), 'utf8');
function token(name) {
  const m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(css);
  if (!m) throw new Error('no hex token --' + name);
  return m[1];
}
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(token(a)), y = lum(token(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
module.exports = { ratio };

const TEXT = [
  ['color-muted', 'color-plot-bg'],   // axis ticks on the plot
  ['color-ink-soft', 'color-plot-bg'], // band names, in the strip above the plot
  ['color-muted', 'color-panel'],     // notes, ticks outside the plot
  ['color-muted', 'color-bg'],        // the footer's build line
  ['color-ink', 'color-accent']       // the selected View (yellow) text
];
const NONTEXT = [
  ['color-control-border', 'color-panel'], // control borders
  ['admin-trump1', 'color-plot-bg'], ['admin-obama2', 'color-plot-bg'], ['admin-biden', 'color-plot-bg'], ['admin-trump2', 'color-plot-bg'], // the administration lines
  ['admin-trump1', 'color-panel']
];

test('text tokens reach 4.5:1 where they are used', () => {
  for (const [fg, bg] of TEXT) assert.ok(ratio(fg, bg) >= 4.5, fg + ' on ' + bg + ': ' + ratio(fg, bg).toFixed(2));
});
test('controls and administration lines reach 3:1', () => {
  for (const [fg, bg] of NONTEXT) assert.ok(ratio(fg, bg) >= 3, fg + ' on ' + bg + ': ' + ratio(fg, bg).toFixed(2));
});
test('report the ratios', () => {
  const out = TEXT.concat(NONTEXT).map(([a, b]) => a + ' / ' + b + ' = ' + ratio(a, b).toFixed(2));
  console.log(out.join('\n'));
  assert.equal(token('color-plot-bg').toLowerCase(), '#f3f4f6');
  assert.equal(token('admin-trump1').toLowerCase(), '#9a6f00');
});
