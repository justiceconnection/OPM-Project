/* The Components mini charts' ticks and their Expand dialog (D-081, amending D-075 and D-076). Pure and testable:
   tick positions and labels from a chart's months-in-office labels and its y scale, and a small controller for the
   dialog (open from a button, close on Close or Esc, focus kept inside while open, focus back to the button after).
   No figures are computed here; the y scale comes from the page's own lowest and highest values drawn. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.miniExpand = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function r9(v) { return Math.round(v * 1e9) / 1e9; } // 0.2 * 3 = 0.6000000000000001 -> 0.6
  function monthOf(label) { var m = Number(label); return isFinite(m) ? m : null; }

  /* Small chart x ticks: "Year 1" to "Year 4" at months 12, 24, 36 and 48 (every 12th month in office shown).
     labels: the chart's category labels (months in office as strings). -> [{ index, month, year }] */
  function yearTicks(labels) {
    var out = [];
    labels.forEach(function (l, i) { var m = monthOf(l); if (m !== null && m > 0 && m % 12 === 0) out.push({ index: i, month: m, year: m / 12 }); });
    return out;
  }
  /* Expanded chart x ticks: one every `every` months in office (6). -> [{ index, month }] */
  function monthTicks(labels, every) {
    var k = every || 6, out = [];
    labels.forEach(function (l, i) { var m = monthOf(l); if (m !== null && m > 0 && m % k === 0) out.push({ index: i, month: m }); });
    return out;
  }

  /* Small chart y labels: three. On the shared scale, 0% and the same distance either side, as far as the scale
     reaches both ways (-40%, 0%, +40% when the scale runs from -40% to +60%). On a component's own scale (Community
     Relations Service, D-076): its minimum, 0% and its maximum. sc = { lo, hi } with lo <= 0 <= hi on round steps. */
  function miniYTicks(sc, own) {
    var lo = r9(sc.lo), hi = r9(sc.hi), reach = Math.min(-lo, hi);
    var vals = own || !(reach > 0) ? [lo, 0, hi] : [-reach, 0, reach];
    return vals.map(r9).filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  var STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  /* the smallest round step that cuts lo..hi into at most maxGaps gaps */
  function niceStep(lo, hi, maxGaps) {
    var span = hi - lo;
    return STEPS.filter(function (x) { return span / x <= maxGaps + 1e-9; })[0] || 20;
  }
  /* Expanded chart y step: every 10% on the shared scale. A component's own scale (CRS), or a shared scale too wide
     for 10% steps to stay readable (more than 12), takes the smallest round step giving at most 10 gaps. */
  function expandedStep(sc, own) {
    if (!own && (sc.hi - sc.lo) / 0.1 <= 12 + 1e-9) return 0.1;
    return niceStep(sc.lo, sc.hi, 10);
  }
  /* every multiple of step from lo to hi (lo and hi are multiples of the small chart's step; a finer step divides them
     or the ends are kept as they are) */
  function steppedTicks(sc, step) {
    var out = [], first = Math.ceil(r9(sc.lo / step)) * step;
    for (var v = first; v <= sc.hi + 1e-9; v += step) out.push(r9(v));
    if (!out.length || out[0] > r9(sc.lo)) out.unshift(r9(sc.lo));
    if (out[out.length - 1] < r9(sc.hi)) out.push(r9(sc.hi));
    return out;
  }
  /* whole percents with a sign, as the minis label them (L-103): -40%, 0%, +40% */
  function pctLabel(v) { var t = Math.round(v * 100); return (t > 0 ? '+' : '') + (t === 0 ? 0 : t) + '%'; }

  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  /* The dialog controller. dialog: a <dialog> (showModal/close when the browser has them, else the open attribute);
     opts: { doc (for activeElement), closeButton, onOpen(opener), onClose() }. Returns { open(opener), close(), isOpen() }.
     Esc and Close close it; Tab and Shift+Tab cycle inside it; on close, focus returns to the button that opened it. */
  function dialogController(dialog, opts) {
    var opener = null, shown = false, doc = opts.doc;
    function focusables() {
      return [].filter.call(dialog.querySelectorAll(FOCUSABLE), function (el) { return !el.disabled && !el.hidden; });
    }
    function open(from) {
      if (shown) return;
      opener = from || null; shown = true;
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      if (opts.onOpen) opts.onOpen(opener);
      opts.closeButton.focus();
    }
    function close() {
      if (!shown) return;
      shown = false;
      if (typeof dialog.close === 'function') { if (dialog.open !== false) dialog.close(); } else dialog.removeAttribute('open');
      if (opts.onClose) opts.onClose();
      var back = opener; opener = null;
      if (back && typeof back.focus === 'function') back.focus();
    }
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); }); // the browser's own Esc
    dialog.addEventListener('close', function () { if (shown) close(); }); // closed some other way: still clean up
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1], at = doc.activeElement, inside = list.indexOf(at) >= 0;
      if (e.shiftKey && (at === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !inside)) { e.preventDefault(); first.focus(); }
    });
    opts.closeButton.addEventListener('click', function () { close(); });
    return { open: open, close: close, isOpen: function () { return shown; } };
  }

  return { yearTicks: yearTicks, monthTicks: monthTicks, miniYTicks: miniYTicks, expandedStep: expandedStep, steppedTicks: steppedTicks,
    niceStep: niceStep, pctLabel: pctLabel, dialogController: dialogController, FOCUSABLE: FOCUSABLE };
});
