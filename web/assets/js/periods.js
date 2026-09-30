/* Time grains and date ranges (D-008, invariant 3). Pure functions, no DOM.
   Month keys are 'YYYY-MM'. Grain ids match the cube: 'month', 'quarter' (fiscal), 'fy'. Period keys match
   the cube: month '2012-03', fiscal quarter 'FY2012Q2', fiscal year 'FY2012'. FY2012 = Oct 2011 to Sep 2012; Q1 = Oct-Dec.
   This module only does calendar arithmetic on keys. It never touches data values. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.periods = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRAINS = ['month', 'quarter', 'fy'];
  var FIRST_MONTH = '2011-10';

  var MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
  var FQ_RE = /^FY(\d{4})Q([1-4])$/;
  var FY_RE = /^FY(\d{4})$/;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function parseMonth(key) {
    var m = MONTH_RE.exec(key);
    if (!m) throw new Error('not a month key: ' + key);
    return { y: +m[1], m: +m[2] };
  }

  function monthKey(y, m) { return y + '-' + pad2(m); }

  function isMonthKey(key) { return typeof key === 'string' && MONTH_RE.test(key); }

  function addMonths(key, n) {
    var p = parseMonth(key);
    var idx = p.y * 12 + (p.m - 1) + n;
    return monthKey(Math.floor(idx / 12), (idx % 12 + 12) % 12 + 1);
  }

  function monthsBetween(a, b) { // inclusive count, a <= b
    var pa = parseMonth(a), pb = parseMonth(b);
    return (pb.y * 12 + pb.m) - (pa.y * 12 + pa.m) + 1;
  }

  function listMonths(start, end) {
    var out = [], k = start;
    while (k <= end) { out.push(k); k = addMonths(k, 1); }
    return out;
  }

  function fiscalYear(key) { var p = parseMonth(key); return p.m >= 10 ? p.y + 1 : p.y; }

  function fiscalQuarter(key) {
    var m = parseMonth(key).m;
    return m >= 10 ? 1 : Math.floor((m - 1) / 3) + 2;
  }

  function assertGrain(grain) {
    if (GRAINS.indexOf(grain) < 0) throw new Error('unknown grain: ' + grain);
  }

  function periodKey(month, grain) {
    assertGrain(grain);
    parseMonth(month);
    if (grain === 'month') return month;
    if (grain === 'quarter') return 'FY' + fiscalYear(month) + 'Q' + fiscalQuarter(month);
    return 'FY' + fiscalYear(month);
  }

  function grainOf(key) {
    if (MONTH_RE.test(key)) return 'month';
    if (FQ_RE.test(key)) return 'quarter';
    if (FY_RE.test(key)) return 'fy';
    throw new Error('not a period key: ' + key);
  }

  function periodBounds(key) {
    var m;
    if (MONTH_RE.test(key)) return { start: key, end: key };
    if ((m = FQ_RE.exec(key))) {
      var start = addMonths(monthKey(+m[1] - 1, 10), 3 * (+m[2] - 1));
      return { start: start, end: addMonths(start, 2) };
    }
    if ((m = FY_RE.exec(key))) return { start: monthKey(+m[1] - 1, 10), end: monthKey(+m[1], 9) };
    throw new Error('not a period key: ' + key);
  }

  /* Widen a month range to whole periods of the grain: the start moves back to its period's
     first month and the end forward to its period's last month. */
  function snapRange(range, grain) {
    return {
      start: periodBounds(periodKey(range.start, grain)).start,
      end: periodBounds(periodKey(range.end, grain)).end
    };
  }

  function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }

  /* Clamp a requested range into the available bounds, swapping a reversed pair.
     Anything missing or malformed falls back to the full bounds (the default range). */
  function normalizeRange(req, bounds) {
    var s = req && isMonthKey(req.start) ? req.start : bounds.start;
    var e = req && isMonthKey(req.end) ? req.end : bounds.end;
    if (s > e) { var t = s; s = e; e = t; }
    if (s < bounds.start) s = bounds.start;
    if (e > bounds.end) e = bounds.end;
    if (s > bounds.end) s = bounds.end;
    if (e < bounds.start) e = bounds.start;
    return { start: s, end: e };
  }

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }

  /* fmt = { months: [12 names], month: '{mon} {year}', fiscalQuarter: 'FY{fy} Q{q}', fiscalYear: 'FY{fy}' }
     All strings come from copy.json. */
  function periodLabel(key, fmt) {
    var g = grainOf(key), m;
    if (g === 'month') { var p = parseMonth(key); return fill(fmt.month, { mon: fmt.months[p.m - 1], year: p.y }); }
    if (g === 'quarter') { m = FQ_RE.exec(key); return fill(fmt.fiscalQuarter, { fy: m[1], q: m[2] }); }
    m = FY_RE.exec(key); return fill(fmt.fiscalYear, { fy: m[1] });
  }

  return {
    GRAINS: GRAINS, FIRST_MONTH: FIRST_MONTH,
    parseMonth: parseMonth, monthKey: monthKey, isMonthKey: isMonthKey, addMonths: addMonths,
    monthsBetween: monthsBetween, listMonths: listMonths, fiscalYear: fiscalYear,
    fiscalQuarter: fiscalQuarter, periodKey: periodKey, grainOf: grainOf, periodBounds: periodBounds,
    snapRange: snapRange, overlaps: overlaps, normalizeRange: normalizeRange,
    periodLabel: periodLabel, fill: fill
  };
});
