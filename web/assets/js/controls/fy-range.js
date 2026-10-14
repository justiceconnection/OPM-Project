/* "From [FY] to [FY]" with a "Full range" reset, on every chart that runs from October 2011 (D-090, docs/pages/
   october-2026-changes.md section 7). Default: the full range. The range is whole fiscal years, cut to the months the
   data covers (FY2012 starts in October 2011; the latest fiscal year ends at the latest month), so it applies at every
   View grain: a month, fiscal quarter or fiscal year row is either inside it or outside it. Each chart has its own.
   Pure helpers (fyOptions, monthRange, pick, fromTo, adjust) plus render(); nothing here reads a data value. */
(function (root, factory) {
  var periods = (typeof require === 'function' && typeof module === 'object')
    ? require('../periods.js') : root.OPM.periods;
  var api = factory(periods);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.fyRange = api; }
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  /* The fiscal years from the first month's to the latest month's: ['FY2012', ..., 'FY2026']. */
  function fyOptions(bounds) {
    var a = P.fiscalYear(bounds.start), b = P.fiscalYear(bounds.end), out = [];
    for (var y = a; y <= b; y++) out.push('FY' + y);
    return out;
  }

  /* The months of fiscal years from..to, cut to the data's bounds: { start, end } (month keys). */
  function monthRange(from, to, bounds) {
    var s = P.periodBounds(from).start, e = P.periodBounds(to).end;
    return { start: s < bounds.start ? bounds.start : s, end: e > bounds.end ? bounds.end : e };
  }

  /* The rows (any grain) whose period lies in the range, in the order given. The range starts and ends on fiscal-year
     boundaries (or the data's own ends), so a row that overlaps it lies inside it. */
  function pick(rows, range) {
    if (!range) return rows;
    return rows.filter(function (r) { return P.overlaps({ start: r.period_first_month, end: r.period_last_month || r.period_first_month }, range); });
  }

  /* The title's {from} and {to}: the first and last month of the range (the latest month when it runs to the end). */
  function fromTo(range, label) { return { from: label(range.start), to: label(range.end) }; }

  /* After one select changes: the other follows when the pair would be reversed. changed: 'from' | 'to'. */
  function adjust(from, to, changed) {
    if (from <= to) return { from: from, to: to };
    return changed === 'from' ? { from: from, to: from } : { from: to, to: to };
  }

  /* opts: { bounds: { start, end } (month keys), copy: { from, to, reset }, fyLabel(fy), labelledBy (the chart title's
     id), onChange(range) }. Returns { el, get() -> { start, end, from, to, full }, reset() }. */
  function render(container, opts) {
    var dom = self.OPM.dom, h = dom.h, list = fyOptions(opts.bounds);
    var cur = { from: list[0], to: list[list.length - 1] };
    function select(text) {
      var id = dom.id('fyrange'), s = h('select', { id: id, class: 'opm-fyrange__select' });
      list.forEach(function (fy) { s.appendChild(h('option', { value: fy, text: opts.fyLabel(fy) })); });
      return { label: h('label', { for: id, class: 'opm-fyrange__label', text: text }), sel: s };
    }
    var from = select(opts.copy.from), to = select(opts.copy.to);
    var reset = h('button', { type: 'button', class: 'opm-mini-btn opm-fyrange__reset', text: opts.copy.reset });
    var wrap = h('div', { class: 'opm-fyrange', role: 'group', 'aria-labelledby': opts.labelledBy || null }, [
      h('span', { class: 'opm-fyrange__pair' }, [from.label, from.sel]), h('span', { class: 'opm-fyrange__pair' }, [to.label, to.sel]), reset]);
    container.appendChild(wrap);
    function full() { return cur.from === list[0] && cur.to === list[list.length - 1]; }
    function paint() { from.sel.value = cur.from; to.sel.value = cur.to; reset.disabled = full(); }
    function get() { var r = monthRange(cur.from, cur.to, opts.bounds); return { start: r.start, end: r.end, from: cur.from, to: cur.to, full: full() }; }
    function set(next) { cur = next; paint(); if (opts.onChange) opts.onChange(get()); }
    from.sel.addEventListener('change', function () { set(adjust(from.sel.value, cur.to, 'from')); });
    to.sel.addEventListener('change', function () { set(adjust(cur.from, to.sel.value, 'to')); });
    reset.addEventListener('click', function () { set({ from: list[0], to: list[list.length - 1] }); from.sel.focus(); });
    paint();
    return { el: wrap, get: get, reset: function () { reset.click(); }, selects: { from: from.sel, to: to.sel }, resetButton: reset,
      setFy: function (f, t) { set(adjust(f, t, 'from')); } };
  }

  return { fyOptions: fyOptions, monthRange: monthRange, pick: pick, fromTo: fromTo, adjust: adjust, render: render };
});
