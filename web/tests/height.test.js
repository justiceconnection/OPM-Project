'use strict';
/* The Framer height reporter, ported from LIONS (D-060): both messages, every trigger, the container measure,
   shrinking, unframed posting to itself, the request, and stop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../assets/js/height.js');

/* A fake window, document and container: enough of the browser for the reporter. */
function fakeWorld(opts = {}) {
  const posted = [], listeners = {}, docListeners = {}, observers = [], mutations = [], intervals = [];
  const target = { bottom: 800, getBoundingClientRect() { return { bottom: this.bottom }; } };
  const doc = {
    documentElement: { scrollHeight: 5000 }, body: { scrollHeight: 5000 },
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); }
  };
  const win = {
    pageYOffset: 0, document: doc,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    requestAnimationFrame(f) { f(); return 1; },
    setInterval(f, ms) { intervals.push({ f, ms, cleared: false }); return intervals.length; },
    clearInterval(id) { intervals[id - 1].cleared = true; },
    ResizeObserver: function (cb) { const o = { cb, observed: [], disconnected: false, observe(el) { this.observed.push(el); }, disconnect() { this.disconnected = true; } }; observers.push(o); return o; },
    MutationObserver: function (cb) { const o = { cb, target: null, options: null, disconnected: false, observe(t, op) { this.target = t; this.options = op; }, disconnect() { this.disconnected = true; } }; mutations.push(o); return o; }
  };
  const parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
  win.parent = opts.top ? win : parent;
  if (opts.top) win.postMessage = (msg, origin) => posted.push({ msg, origin, self: true });
  return { win, doc, target, posted, listeners, docListeners, observers, mutations, intervals, parent };
}
const reporter = (w, page = 'workforce-size') => H.createHeightReporter({ win: w.win, doc: w.doc, target: w.target, page });

test('start posts both messages at once: the LIONS one and the OPM one, to "*"', () => {
  const w = fakeWorld();
  reporter(w).start();
  assert.deepEqual(w.posted, [
    { msg: { type: 'lions-dashboard-height', height: 800 }, origin: '*' },
    { msg: { type: 'opm:height', height: 800, page: 'workforce-size' }, origin: '*' }
  ]);
});

test('it measures the content container, never the document (which stays pinned to the grown frame)', () => {
  const w = fakeWorld();
  w.target.bottom = 700.2; w.win.pageYOffset = 50;
  w.doc.documentElement.scrollHeight = 9999; w.doc.body.scrollHeight = 9999;
  const r = reporter(w);
  assert.equal(r.measure(), 751); // ceil(bottom + scrollY)
  const noTarget = H.createHeightReporter({ win: w.win, doc: w.doc, target: null });
  assert.equal(noTarget.measure(), 9999); // LIONS's fallback when there is no container
});

test('it posts when the height changes, up or down, and only then', () => {
  const w = fakeWorld();
  reporter(w).start();
  const fire = () => w.observers[0].cb();
  fire();                                      // no change
  w.target.bottom = 1200; fire();              // grows
  w.mutations[0].cb();                         // a DOM change, same height
  w.target.bottom = 640; w.intervals[0].f();   // shrinks (the 1000 ms fallback notices)
  const lions = w.posted.filter(p => p.msg.type === 'lions-dashboard-height').map(p => p.msg.height);
  const opm = w.posted.filter(p => p.msg.type === 'opm:height').map(p => p.msg.height);
  assert.deepEqual(lions, [800, 1200, 640]);
  assert.deepEqual(opm, [800, 1200, 640]);
});

test('every LIONS trigger is wired: load, resize, DOMContentLoaded, ResizeObserver on html, body and container, MutationObserver, 1000 ms interval', () => {
  const w = fakeWorld();
  reporter(w).start();
  assert.equal(w.listeners.load.length, 1);
  assert.equal(w.listeners.resize.length, 1);
  assert.equal(w.docListeners.DOMContentLoaded.length, 1);
  assert.deepEqual(w.observers[0].observed, [w.doc.documentElement, w.doc.body, w.target]);
  assert.equal(w.mutations[0].target, w.doc.documentElement);
  assert.deepEqual(w.mutations[0].options, { subtree: true, childList: true, attributes: true });
  assert.deepEqual(w.intervals.map(i => i.ms), [1000]);
  w.target.bottom = 900; w.listeners.resize[0]();
  w.target.bottom = 910; w.listeners.load[0]();
  w.target.bottom = 920; w.docListeners.DOMContentLoaded[0]();
  assert.deepEqual(w.posted.filter(p => p.msg.type === 'lions-dashboard-height').map(p => p.msg.height), [800, 900, 910, 920]);
});

test('a request from the parent is answered even when nothing changed; others are ignored', () => {
  const w = fakeWorld();
  reporter(w).start();
  w.listeners.message.forEach(f => f({ source: w.parent, data: { type: 'opm:height-request' } }));
  w.listeners.message.forEach(f => f({ source: {}, data: { type: 'opm:height-request' } }));
  w.listeners.message.forEach(f => f({ source: w.parent, data: { type: 'lions-dashboard-height', height: 1 } }));
  assert.equal(w.posted.length, 4); // two at start, two for the one real request
});

test('unframed, it posts to itself (as LIONS does) without error', () => {
  const w = fakeWorld({ top: true });
  const r = reporter(w);
  assert.doesNotThrow(() => r.start());
  assert.equal(r.isFramed(), false);
  assert.ok(w.posted.length === 2 && w.posted.every(p => p.self));
});

test('stop removes every listener, both observers and the interval', () => {
  const w = fakeWorld();
  const r = reporter(w);
  r.start(); r.start(); // idempotent
  assert.equal(w.listeners.resize.length, 1);
  r.stop();
  assert.equal(w.listeners.resize.length, 0);
  assert.equal(w.listeners.load.length, 0);
  assert.equal(w.listeners.message.length, 0);
  assert.equal(w.docListeners.DOMContentLoaded.length, 0);
  assert.ok(w.observers[0].disconnected && w.mutations[0].disconnected && w.intervals[0].cleared);
});

test('without ResizeObserver or MutationObserver, events and the interval still report', () => {
  const w = fakeWorld();
  delete w.win.ResizeObserver; delete w.win.MutationObserver;
  reporter(w).start();
  w.target.bottom = 900; w.intervals[0].f();
  assert.deepEqual(w.posted.filter(p => p.msg.type === 'opm:height').map(p => p.msg.height), [800, 900]);
});
