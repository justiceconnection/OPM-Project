'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../assets/js/height.js');

/* A fake window and element: enough of the browser for the reporter. */
function fakeWorld(opts = {}) {
  const posted = [], listeners = {}, observers = [];
  const parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
  const target = { bottom: 800, getBoundingClientRect() { return { bottom: this.bottom }; } };
  const win = {
    parent: opts.top ? null : parent,
    pageYOffset: 0,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    requestAnimationFrame(f) { f(); return 1; },
    ResizeObserver: function (cb) { const o = { cb, observed: [], disconnected: false, observe(el) { this.observed.push(el); }, disconnect() { this.disconnected = true; } }; observers.push(o); return o; }
  };
  if (opts.top) win.parent = win;
  return { win, target, posted, listeners, observers, parent };
}

test('posts the content height on start, with type and page', () => {
  const w = fakeWorld();
  const r = H.createHeightReporter({ win: w.win, target: w.target, page: 'workforce-size' });
  r.start();
  assert.deepEqual(w.posted, [{ msg: { type: 'opm:height', height: 800, page: 'workforce-size' }, origin: '*' }]);
});

test('rounds up and includes the scroll offset', () => {
  const w = fakeWorld();
  w.target.bottom = 700.2; w.win.pageYOffset = 50;
  H.createHeightReporter({ win: w.win, target: w.target }).start();
  assert.equal(w.posted[0].msg.height, 751);
});

test('posts again only when the height changes', () => {
  const w = fakeWorld();
  const r = H.createHeightReporter({ win: w.win, target: w.target });
  r.start();
  w.observers[0].cb();                // resize with no change
  assert.equal(w.posted.length, 1);
  w.target.bottom = 950; w.observers[0].cb();
  w.listeners.resize.forEach(f => f()); // window resize, same height
  assert.deepEqual(w.posted.map(p => p.msg.height), [800, 950]);
});

test('answers a height request from the parent, even when unchanged', () => {
  const w = fakeWorld();
  H.createHeightReporter({ win: w.win, target: w.target }).start();
  w.listeners.message.forEach(f => f({ source: w.parent, data: { type: 'opm:height-request' } }));
  w.listeners.message.forEach(f => f({ source: {}, data: { type: 'opm:height-request' } })); // not the parent
  w.listeners.message.forEach(f => f({ source: w.parent, data: { type: 'other' } }));
  assert.equal(w.posted.length, 2);
});

test('does nothing when not framed', () => {
  const w = fakeWorld({ top: true });
  const r = H.createHeightReporter({ win: w.win, target: w.target });
  r.start();
  assert.equal(r.isFramed(), false);
  assert.equal(w.posted.length, 0);
});

test('stop removes every listener and disconnects the observer', () => {
  const w = fakeWorld();
  const r = H.createHeightReporter({ win: w.win, target: w.target });
  r.start(); r.start(); // idempotent
  assert.equal(w.listeners.resize.length, 1);
  r.stop();
  assert.equal(w.listeners.resize.length, 0);
  assert.equal(w.listeners.load.length, 0);
  assert.equal(w.listeners.message.length, 0);
  assert.ok(w.observers[0].disconnected);
});

test('works without ResizeObserver, falling back to window events', () => {
  const w = fakeWorld();
  delete w.win.ResizeObserver;
  H.createHeightReporter({ win: w.win, target: w.target }).start();
  w.target.bottom = 900; w.listeners.load.forEach(f => f());
  assert.deepEqual(w.posted.map(p => p.msg.height), [800, 900]);
});
