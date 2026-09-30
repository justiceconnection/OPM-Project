/* Hiring and departures page logic, pure and testable (docs/pages/hiring-and-departures.md;
   container D-037, contents and copy D-040). Picks cube rows; sums flow columns over periods with
   sumAcrossPeriods; rates are a picked row's numerator over its denominator. Never subtracts. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./data.js') : root.OPM.data, node ? require('./workforce.js') : root.OPM.workforce);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.hiring = api; }
})(typeof self !== 'undefined' ? self : this, function (P, D, W) {
  'use strict';

  /* The six signed departure categories (D-015, D-020), in legend order; they sum to departures. */
  var REASONS = ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];
  /* The two hire types; they sum to hires. */
  var HIRE_TYPES = ['acc_new_hire', 'acc_transfer_in'];
  var RATES = ['attrition', 'quit', 'retirement'];

  function monthRow(rows, entity, month) {
    return rows.filter(function (r) { return r.entity === entity && r.grain === 'month' && r.period === month; })[0] || null;
  }

  /* Panel 1. Always the latest 12 months of the entity, with the 12 months before as a second
     number; the rate is the latest month's method A rate, and the same month a year earlier. */
  function tiles(rows, entity, meta) {
    var m = W.entityRows(rows, entity, 'month');
    if (!m.length) return null;
    var last12 = m.slice(-12), prior12 = m.length >= 24 ? m.slice(-24, -12) : [];
    var latest = m[m.length - 1];
    var yearAgo = monthRow(rows, entity, P.addMonths(latest.period, -12));
    function sum(list, col) { return list.length === 12 ? D.sumAcrossPeriods(list, col, meta) : null; }
    return {
      hires: sum(last12, 'hires'), hiresPrior: sum(prior12, 'hires'),
      departures: sum(last12, 'departures'), departuresPrior: sum(prior12, 'departures'),
      rate: D.ratio(latest, 'attrition_a_num', 'rate_a_den'), ratePrior: yearAgo ? D.ratio(yearAgo, 'attrition_a_num', 'rate_a_den') : null,
      smallBase: latest.rate_a_small_base === true, smallBasePrior: !!(yearAgo && yearAgo.rate_a_small_base === true),
      provisional: last12.some(function (r) { return r.provisional === true; }),
      latest: latest, yearAgo: yearAgo, first: last12[0]
    };
  }

  /* Panel 4: the three rates for the picked rows under one method, with the cube's small-base flags. */
  function rates(picked, method) {
    var out = {};
    RATES.forEach(function (measure) {
      var s = D.rateSeries(picked, measure, method);
      out[measure] = { values: s.map(function (p) { return p.value; }), smallBase: s.map(function (p) { return p.smallBase && p.value !== null; }) };
    });
    return out;
  }

  /* Rows whose method B value is year to date (D-023): a partial fiscal year with a value. */
  function ytdRows(picked, method) {
    if (method !== 'b') return [];
    return picked.filter(function (r) { return r.grain === 'fy' && r.partial === true && D.ratio(r, 'attrition_b_num', 'rate_b_den') !== null; });
  }

  return { REASONS: REASONS, HIRE_TYPES: HIRE_TYPES, RATES: RATES, tiles: tiles, rates: rates, ytdRows: ytdRows, monthRow: monthRow };
});
