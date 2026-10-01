/* Framer embed height reporter: a port of the LIONS reporter, /Users/carycheng/lions/lions-system/web/shared/
   height-reporter.js, under D-060 (the one LIONS code exception to D-022 and D-028; Cary: "replicate the height
   resizer and adapt it").

   Same behavior as LIONS: measure the content container's box, post the height to the parent with targetOrigin
   "*" (it is not sensitive) whenever it changes, scheduled through requestAnimationFrame on load, resize and
   DOMContentLoaded, by a ResizeObserver on html, body and the container, by a MutationObserver on the whole
   document, by a 1000 ms interval as the fallback, and once immediately. Like LIONS it posts even when the page
   is not framed: parent is then the window itself and the message is simply ignored.

   Adapted for OPM: the container is the page wrapper (#page, .opm-page) rather than LIONS's .wrap; each change
   sends BOTH the LIONS message { type: 'lions-dashboard-height', height }, so the existing LIONS Framer embed
   works unchanged, and the OPM message { type: 'opm:height', height, page }; a parent may ask again with
   { type: 'opm:height-request' }. Kept as a module (createHeightReporter) so it can be tested with a fake window. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.height = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIONS_MESSAGE = 'lions-dashboard-height';
  var MESSAGE = 'opm:height';
  var REQUEST = 'opm:height-request';

  /* opts: { win, doc, target (the content container), page } */
  function createHeightReporter(opts) {
    var win = opts.win, doc = opts.doc || win.document, target = opts.target;
    var last = 0, scheduled = false, started = false, ro = null, mo = null, timer = null;

    function measure() {
      // Measure the ACTUAL content height from the page container (as LIONS does with .wrap).
      // Why not documentElement.scrollHeight/offsetHeight or body.scrollHeight: once Framer grows the iframe,
      // the document fills the iframe's viewport, so those values get pinned to the grown height and never
      // shrink back when the content gets shorter (a filter with fewer results, a smaller view). The
      // container's box reflects the real content and shrinks correctly.
      if (target) {
        var r = target.getBoundingClientRect();
        return Math.ceil(r.bottom + (win.scrollY || win.pageYOffset || 0));
      }
      return doc && doc.body ? doc.body.scrollHeight : 0;
    }

    function post(h) {
      var to = win.parent || win;
      to.postMessage({ type: LIONS_MESSAGE, height: h }, '*');
      to.postMessage({ type: MESSAGE, height: h, page: opts.page || null }, '*');
    }

    /* post when the height changed (or always, when asked); returns whether it posted */
    function report(always) {
      var h = measure();
      if (h && (always || h !== last)) { last = h; post(h); return true; }
      return false;
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      var raf = win.requestAnimationFrame || function (f) { return win.setTimeout(f, 16); };
      raf(function () { scheduled = false; report(false); });
    }

    function onMessage(ev) {
      if (ev && ev.data && ev.data.type === REQUEST && ev.source === win.parent) report(true);
    }

    function start() {
      if (started) return;
      started = true;
      win.addEventListener('load', schedule);
      win.addEventListener('resize', schedule);
      win.addEventListener('message', onMessage);
      if (doc && doc.addEventListener) doc.addEventListener('DOMContentLoaded', schedule);
      if (typeof win.ResizeObserver === 'function') {
        ro = new win.ResizeObserver(schedule);
        if (doc && doc.documentElement) ro.observe(doc.documentElement);
        if (doc && doc.body) ro.observe(doc.body);
        if (target) ro.observe(target); // catch content grow and shrink directly
      }
      if (typeof win.MutationObserver === 'function' && doc && doc.documentElement) {
        mo = new win.MutationObserver(schedule);
        mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
      }
      timer = win.setInterval(schedule, 1000);
      schedule();
    }

    function stop() {
      if (!started) return;
      started = false;
      win.removeEventListener('load', schedule);
      win.removeEventListener('resize', schedule);
      win.removeEventListener('message', onMessage);
      if (doc && doc.removeEventListener) doc.removeEventListener('DOMContentLoaded', schedule);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      if (timer !== null) win.clearInterval(timer);
      ro = mo = timer = null;
    }

    return { start: start, stop: stop, report: report, measure: measure, schedule: schedule,
      isFramed: function () { return !!win.parent && win.parent !== win; } };
  }

  return { LIONS_MESSAGE: LIONS_MESSAGE, MESSAGE: MESSAGE, REQUEST: REQUEST, createHeightReporter: createHeightReporter };
});
