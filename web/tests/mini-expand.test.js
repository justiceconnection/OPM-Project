'use strict';
/* D-081: the Components mini charts' ticks and the Expand dialog (open, close, focus). */
const test = require('node:test');
const assert = require('node:assert/strict');
const MX = require('../assets/js/mini-expand.js');
const copy = require('../copy.json');

const months = n => Array.from({ length: n }, (_, i) => String(i + 1));

test('small charts: x ticks at months 12, 24, 36 and 48 (Year 1 to Year 4), never 1, 13, 25, 37', () => {
  const t = MX.yearTicks(months(48));
  assert.deepEqual(t.map(x => x.month), [12, 24, 36, 48]);
  assert.deepEqual(t.map(x => x.index), [11, 23, 35, 47]);
  assert.deepEqual(t.map(x => x.year), [1, 2, 3, 4]);
  const year = copy.shell['comp.minis.year'];
  assert.equal(year, 'Year {n}');
  assert.deepEqual(t.map(x => year.replace('{n}', x.year)), ['Year 1', 'Year 2', 'Year 3', 'Year 4']);
  // View Yearly: every 12th month plus the component's own N (19); the ticks stay on the years
  assert.deepEqual(MX.yearTicks(['12', '19', '24', '36', '48']).map(x => [x.index, x.month]), [[0, 12], [2, 24], [3, 36], [4, 48]]);
  // Quarterly: every 3rd month
  assert.deepEqual(MX.yearTicks(['3', '6', '9', '12', '15', '18', '19', '21', '24']).map(x => x.month), [12, 24]);
});

test('expanded chart: a tick every 6 months in office', () => {
  assert.deepEqual(MX.monthTicks(months(48), 6).map(x => x.month), [6, 12, 18, 24, 30, 36, 42, 48]);
  assert.deepEqual(MX.monthTicks(months(48), 6).map(x => x.index), [5, 11, 17, 23, 29, 35, 41, 47]);
  assert.deepEqual(MX.monthTicks(['12', '19', '24'], 6).map(x => x.month), [12, 24]);
});

test('small charts: three y labels, -40%, 0%, +40% on the shared scale; CRS its minimum, 0% and maximum', () => {
  // the shared scale today runs from -40% to +60% in 20% steps (the lowest and highest values drawn, rounded)
  const shared = MX.miniYTicks({ lo: -0.4, hi: 0.6000000000000001 }, false);
  assert.deepEqual(shared, [-0.4, 0, 0.4]);
  assert.deepEqual(shared.map(MX.pctLabel), ['-40%', '0%', '+40%']);
  // Community Relations Service on its own scale (D-076): -100% to +150%
  const crs = MX.miniYTicks({ lo: -1, hi: 1.5 }, true);
  assert.deepEqual(crs.map(MX.pctLabel), ['-100%', '0%', '+150%']);
  // a scale with nothing below zero still has three distinct labels at most, never a duplicate 0%
  assert.deepEqual(MX.miniYTicks({ lo: 0, hi: 0.2 }, false).map(MX.pctLabel), ['0%', '+20%']);
  assert.equal(MX.pctLabel(-0), '0%');
  assert.equal(MX.pctLabel(-1e-12), '0%');
});

test('expanded chart: y every 10% on the shared scale; CRS a round step on its own scale', () => {
  const sc = { lo: -0.4, hi: 0.6 };
  assert.equal(MX.expandedStep(sc, false), 0.1);
  assert.deepEqual(MX.steppedTicks(sc, 0.1).map(MX.pctLabel), ['-40%', '-30%', '-20%', '-10%', '0%', '+10%', '+20%', '+30%', '+40%', '+50%', '+60%']);
  const crs = { lo: -1, hi: 1.5 };
  assert.equal(MX.expandedStep(crs, true), 0.25);
  assert.deepEqual(MX.steppedTicks(crs, 0.25).map(MX.pctLabel), ['-100%', '-75%', '-50%', '-25%', '0%', '+25%', '+50%', '+75%', '+100%', '+125%', '+150%']);
  // a shared scale too wide for readable 10% steps (a small job series) takes a round step with at most 10 gaps
  assert.equal(MX.expandedStep({ lo: -1, hi: 2 }, false), 0.5);
  // every tick is a clean value (no 0.30000000000000004)
  assert.ok(MX.steppedTicks(sc, 0.1).every(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-12));
});

/* a minimal DOM: elements with listeners and focus, a document with activeElement */
function fakeDom() {
  const doc = { activeElement: null };
  function el(name, opts = {}) {
    const ls = {};
    const e = { name, disabled: false, hidden: false, attrs: {},
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      dispatch(t, extra = {}) { const ev = Object.assign({ type: t, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra); (ls[t] || []).forEach(f => f(ev)); return ev; },
      focus() { doc.activeElement = e; },
      setAttribute(k, v) { e.attrs[k] = v; }, removeAttribute(k) { delete e.attrs[k]; } };
    return Object.assign(e, opts);
  }
  return { doc, el };
}
function setup(native) {
  const { doc, el } = fakeDom();
  const opener = el('expand'), other = el('other'), close = el('close'), inner = el('inner');
  const dialog = el('dialog');
  dialog.querySelectorAll = () => [close, inner];
  if (native) {
    dialog.open = false; dialog.modal = 0;
    dialog.showModal = () => { dialog.open = true; dialog.modal += 1; };
    dialog.close = () => { dialog.open = false; dialog.dispatch('close'); };
  }
  const log = [];
  const ctl = MX.dialogController(dialog, { doc, closeButton: close, onOpen: b => log.push('open:' + b.name), onClose: () => log.push('close') });
  return { doc, opener, other, close, inner, dialog, ctl, log };
}

test('dialog: opens modal from its button with focus on Close; Close returns focus to the button', () => {
  const s = setup(true);
  s.opener.focus();
  s.ctl.open(s.opener);
  assert.equal(s.dialog.open, true); assert.equal(s.dialog.modal, 1);
  assert.equal(s.ctl.isOpen(), true);
  assert.equal(s.doc.activeElement, s.close);
  s.close.dispatch('click');
  assert.equal(s.dialog.open, false); assert.equal(s.ctl.isOpen(), false);
  assert.equal(s.doc.activeElement, s.opener);
  assert.deepEqual(s.log, ['open:expand', 'close']); // onClose once, though close() fires the close event
});

test('dialog: Esc closes it (keydown and the browser cancel event), focus back to the button', () => {
  const s = setup(true);
  s.ctl.open(s.opener); s.other.focus();
  const ev = s.dialog.dispatch('keydown', { key: 'Escape' });
  assert.ok(ev.defaultPrevented); assert.equal(s.dialog.open, false); assert.equal(s.doc.activeElement, s.opener);
  s.ctl.open(s.opener);
  const c = s.dialog.dispatch('cancel');
  assert.ok(c.defaultPrevented); assert.equal(s.ctl.isOpen(), false); assert.equal(s.doc.activeElement, s.opener);
  assert.deepEqual(s.log, ['open:expand', 'close', 'open:expand', 'close']);
});

test('dialog: Tab and Shift+Tab stay inside while open', () => {
  const s = setup(true);
  s.ctl.open(s.opener);
  assert.equal(s.doc.activeElement, s.close);
  let ev = s.dialog.dispatch('keydown', { key: 'Tab', shiftKey: true }); // from the first, back to the last
  assert.ok(ev.defaultPrevented); assert.equal(s.doc.activeElement, s.inner);
  ev = s.dialog.dispatch('keydown', { key: 'Tab' }); // from the last, round to the first
  assert.ok(ev.defaultPrevented); assert.equal(s.doc.activeElement, s.close);
  ev = s.dialog.dispatch('keydown', { key: 'Tab' }); // in the middle: the browser moves focus as usual
  assert.equal(ev.defaultPrevented, false);
  s.other.focus(); // focus somehow outside: Tab brings it back in
  ev = s.dialog.dispatch('keydown', { key: 'Tab' });
  assert.ok(ev.defaultPrevented); assert.equal(s.doc.activeElement, s.close);
  ev = s.dialog.dispatch('keydown', { key: 'a' });
  assert.equal(ev.defaultPrevented, false);
});

test('dialog: without native <dialog> support the open attribute is used; closing twice is harmless', () => {
  const s = setup(false);
  s.ctl.open(s.opener);
  assert.equal(s.dialog.attrs.open, '');
  s.ctl.close(); s.ctl.close();
  assert.equal('open' in s.dialog.attrs, false);
  assert.equal(s.doc.activeElement, s.opener);
  assert.deepEqual(s.log, ['open:expand', 'close']);
});

test('copy: the D-081 keys are signed with the wording Cary signed', () => {
  const want = { 'comp.minis.expand': 'Expand', 'comp.minis.close': 'Close', 'comp.minis.year': 'Year {n}', 'comp.minis.xTitle': 'Months in office' };
  Object.keys(want).forEach(k => { assert.equal(copy.shell[k], want[k]); assert.equal(copy.shell._status[k], 'signed'); });
});
