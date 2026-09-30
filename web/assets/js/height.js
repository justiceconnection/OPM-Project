/* Framer embed height reporter. Posts the page's content height to the parent frame so the
   embed can size itself: { type: 'opm:height', height: <px>, page: <id> }.
   The parent may ask again with { type: 'opm:height-request' }.
   Only posts when the page is framed and the height actually changed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.height = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MESSAGE = 'opm:height';
  var REQUEST = 'opm:height-request';

  /* opts: { win, target (element whose bottom edge ends the content), page, force } */
  function createHeightReporter(opts) {
    var win = opts.win, target = opts.target;
    var framed = !!win.parent && win.parent !== win;
    var last = null, observer = null, pending = false, started = false;

    function measure() {
      var r = target.getBoundingClientRect();
      var scrollY = win.pageYOffset || win.scrollY || 0;
      return Math.ceil(r.bottom + scrollY);
    }

    function report(always) {
      pending = false;
      if (!framed && !opts.force) return false;
      var hgt = measure();
      if (!always && hgt === last) return false;
      last = hgt;
      win.parent.postMessage({ type: MESSAGE, height: hgt, page: opts.page || null }, '*');
      return true;
    }

    function schedule() {
      if (pending) return;
      pending = true;
      (win.requestAnimationFrame || function (f) { return win.setTimeout(f, 16); })(function () { report(false); });
    }

    function onMessage(ev) {
      if (ev && ev.source === win.parent && ev.data && ev.data.type === REQUEST) report(true);
    }

    function start() {
      if (started) return;
      started = true;
      report(false);
      if (typeof win.ResizeObserver === 'function') {
        observer = new win.ResizeObserver(schedule);
        observer.observe(target);
      }
      win.addEventListener('resize', schedule);
      win.addEventListener('load', schedule);
      win.addEventListener('message', onMessage);
    }

    function stop() {
      if (!started) return;
      started = false;
      if (observer) observer.disconnect();
      observer = null;
      win.removeEventListener('resize', schedule);
      win.removeEventListener('load', schedule);
      win.removeEventListener('message', onMessage);
    }

    return { start: start, stop: stop, report: report, measure: measure, isFramed: function () { return framed; } };
  }

  return { MESSAGE: MESSAGE, REQUEST: REQUEST, createHeightReporter: createHeightReporter };
});
