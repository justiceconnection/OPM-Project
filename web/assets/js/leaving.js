/* Who is leaving page logic, pure and testable (docs/pages/who-is-leaving.md; container D-042,
   contents and copy D-044, occupation order D-043). doj_leaving rows for one entity (its own file)
   plus doj_core rows for the years-lost tiles. Picks rows, sums columns (across a dimension's
   values with sumAcrossValues; across periods only for flow kinds) and divides. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./data.js') : root.OPM.data);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.leaving = api; }
})(typeof self !== 'undefined' ? self : this, function (P, D) {
  'use strict';

  /* The four breakdowns, in panel order. key names the copy keys (panel.<key>.title, dim.<key>).
     unknownLine: 'always' (length of service), 'nonzero' (age, supervisory) or null (occupation). */
  var DIMS = [
    { id: 'los', key: 'los', unknownLine: 'always' },
    { id: 'age', key: 'age', unknownLine: 'nonzero' },
    { id: 'supervisory', key: 'sup', unknownLine: 'nonzero' },
    { id: 'occupation', key: 'occ', unknownLine: null }
  ];
  var GRAINS = ['fy', 't12'];

  function byKey(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function periodsOf(rows, grain) {
    var seen = {};
    rows.forEach(function (r) { if (r.grain === grain) seen[r.period] = true; });
    return Object.keys(seen).sort(byKey);
  }

  /* The same period a year earlier: the previous fiscal year, or the 12 months ending a year earlier. */
  function priorPeriod(grain, period) {
    if (grain === 'fy') return 'FY' + (+period.slice(2) - 1);
    if (grain === 't12') return P.addMonths(period, -12);
    throw new Error('priorPeriod: unknown grain ' + grain);
  }

  function pick(rows, grain, period, dim) {
    return rows.filter(function (r) { return r.grain === grain && r.period === period && r.dimension === dim; })
      .sort(function (a, b) { return a.value_order - b.value_order; });
  }

  /* The copy key (and fill values) that names a group. Age values other than the two ends are ranges 'lo_hi'. */
  function groupLabel(dim, value) {
    if (dim === 'los') return { ref: 'page:group.los.' + value };
    if (dim === 'supervisory') return { ref: 'page:group.sup.' + value };
    if (dim === 'occupation') return { ref: 'page:group.occ.' + value };
    if (dim === 'age') {
      if (value === 'under25' || value === '65plus') return { ref: 'page:group.age.' + value };
      var m = /^(\d+)_(\d+)$/.exec(value);
      if (!m) throw new Error('groupLabel: unexpected age value ' + value);
      return { ref: 'page:group.age.range', vars: { lo: m[1], hi: m[2] } };
    }
    throw new Error('groupLabel: unknown dimension ' + dim);
  }

  function groupStat(r) {
    if (!r) return null;
    return {
      departures: D.value(r, 'departures'), rate: D.ratio(r, 'rate_num', 'rate_den'),
      smallBase: r.rate_small_base === true, na: r.rate_not_applicable === true
    };
  }

  /* One panel's snapshot: the known groups in signed order, each with its rate, departures and flags,
     and the same group a year earlier; the Unknown count apart (never a rate); the dimension's coverage. */
  function snapshot(rows, grain, period, dim) {
    var now = pick(rows, grain, period, dim), before = pick(rows, grain, priorPeriod(grain, period), dim);
    var unknown = now.filter(function (r) { return r.is_unknown === true; })[0] || null;
    return {
      groups: now.filter(function (r) { return r.is_unknown !== true; }).map(function (r) {
        var p = before.filter(function (b) { return b.value === r.value; })[0];
        return Object.assign({ value: r.value, order: r.value_order, prior: groupStat(p) }, groupStat(r));
      }),
      unknown: unknown ? D.value(unknown, 'departures') : null,
      coverage: now.length ? D.value(now[0], 'coverage') : null,
      provisional: now.some(function (r) { return r.provisional === true; }),
      partial: now.some(function (r) { return r.partial === true; })
    };
  }

  /* Departures in the period: any one dimension's values summed (they partition); length of service is used. */
  function departures(rows, grain, period) {
    return D.sumAcrossValues(pick(rows, grain, period, 'los'), 'departures');
  }

  /* Years of experience lost and the average per departure, from doj_core: the fiscal-year row, or the
     12 month rows ending at the period summed (flow columns). Coverage and average are ratios of sums. */
  function yearsLost(coreRows, entity, grain, period, coreMeta) {
    var list;
    if (grain === 'fy') {
      list = coreRows.filter(function (r) { return r.entity === entity && r.grain === 'fy' && r.period === period; });
      if (list.length !== 1) return null;
    } else {
      var months = P.listMonths(P.addMonths(period, -11), period);
      list = months.map(function (m) { return coreRows.filter(function (r) { return r.entity === entity && r.grain === 'month' && r.period === m; })[0]; });
      if (list.some(function (r) { return !r; })) return null;
    }
    var lost = D.sumAcrossPeriods(list, 'years_of_service_lost', coreMeta);
    var known = D.sumAcrossPeriods(list, 'yos_known', coreMeta);
    var deps = D.sumAcrossPeriods(list, 'departures', coreMeta);
    return { lost: lost, known: known, departures: deps, average: D.divide(lost, known), coverage: D.divide(known, deps) };
  }

  /* One panel's trend: every period of the grain, and per known group its rates and flags. */
  function trend(rows, grain, dim) {
    var periods = periodsOf(rows, grain);
    var byPeriod = {};
    rows.forEach(function (r) { if (r.grain === grain && r.dimension === dim) (byPeriod[r.period] = byPeriod[r.period] || {})[r.value] = r; });
    var values = pick(rows, grain, periods[periods.length - 1], dim).filter(function (r) { return r.is_unknown !== true; }).map(function (r) { return r.value; });
    return {
      periods: periods,
      flags: periods.map(function (p) {
        var any = byPeriod[p] ? byPeriod[p][Object.keys(byPeriod[p])[0]] : null;
        return { provisional: !!(any && any.provisional), partial: !!(any && any.partial), last: any ? any.period_last_month : null };
      }),
      series: values.map(function (v) {
        var rs = periods.map(function (p) { return byPeriod[p] ? byPeriod[p][v] : null; });
        return {
          value: v,
          rates: rs.map(function (r) { return r ? D.ratio(r, 'rate_num', 'rate_den') : null; }),
          smallBase: rs.map(function (r) { return !!(r && r.rate_small_base === true && D.ratio(r, 'rate_num', 'rate_den') !== null); }),
          na: rs.map(function (r) { return !!(r && r.rate_not_applicable === true); })
        };
      })
    };
  }

  return { DIMS: DIMS, GRAINS: GRAINS, periodsOf: periodsOf, priorPeriod: priorPeriod, groupLabel: groupLabel, snapshot: snapshot,
    departures: departures, yearsLost: yearsLost, trend: trend };
});
