/* The browser's whole data layer. Invariant 3 and the frontend rule: the browser may only
   (1) pick precomputed cube rows by entity, grain and range, (2) read a column, (3) sum columns,
   and (4) divide a summed numerator by a summed denominator. Nothing else.

   Cube contract, as in the doj_core cube (warehouse/cubes/doj_core.meta.json):
     file   { columns: [names], rows: [[values in column order]] }
     entity             'DOJ' or a component code
     grain              'month' | 'quarter' | 'fy'
     period             '2012-03' | 'FY2012Q2' | 'FY2012'
     period_first_month first calendar month 'YYYY-MM'
     period_last_month  last PUBLISHED month 'YYYY-MM' (stocks come from it)
     partial, provisional   booleans set by the cube
     <measure>_<m>_num over rate_<m>_den, m in a | b | c (D-019); rate_<m>_small_base set by the cube
   A missing or null value stays null. It is never read as zero (invariant 4). */
(function (root, factory) {
  var periods = (typeof require === 'function' && typeof module === 'object')
    ? require('./periods.js') : root.OPM.periods;
  var api = factory(periods);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.data = api; }
})(typeof self !== 'undefined' ? self : this, function (periods) {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* Columnar cube file -> row objects. Values are not touched. */
  function fromCube(file) {
    var cols = file.columns;
    return file.rows.map(function (r) {
      var o = {};
      for (var i = 0; i < cols.length; i++) o[cols[i]] = r[i];
      return o;
    });
  }

  function value(row, col) { return row && isNum(row[col]) ? row[col] : null; }

  /* Rows of one entity and grain whose period overlaps the range, in time order.
     A partial period's span runs to its last published month. */
  function selectRows(rows, opts) {
    var range = opts.range, entity = opts.entity;
    return rows.filter(function (r) {
      return r.grain === opts.grain && (entity === undefined || r.entity === entity) &&
        (!range || periods.overlaps({ start: r.period_first_month, end: r.period_last_month }, range));
    }).sort(function (a, b) {
      return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : 0;
    });
  }

  /* Sum of columns within one row (for example categories of one period). Null if any is null. */
  function sumColumns(row, cols) {
    var total = 0;
    for (var i = 0; i < cols.length; i++) {
      var v = value(row, cols[i]);
      if (v === null) return null;
      total += v;
    }
    return total;
  }

  /* Sum of one column across rows of the SAME grain and period (for example across components).
     Every row is checked before any value is read, so a null never hides a bad mix. Refused, by throwing:
     - a row with no entity: it cannot be checked for double counting;
     - rows from more than one period: a stock such as headcount is never summed over time;
     - the 'DOJ' total together with component rows: the total already contains them;
     - the same (entity, grain, period) twice: it would be counted twice.
     After the checks, any null value makes the sum null (never read as zero). */
  function sumRows(rows, col) {
    if (!rows.length) return null;
    var g = rows[0].grain, p = rows[0].period, hasDoj = false, hasComponent = false, seen = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeof r.entity !== 'string' || r.entity === '') throw new Error('sumRows: row ' + i + ' has no entity');
      if (r.grain !== g || r.period !== p) {
        throw new Error('sumRows: rows span more than one period (' + p + ', ' + r.period + ')');
      }
      if (r.entity === 'DOJ') hasDoj = true; else hasComponent = true;
      if (hasDoj && hasComponent) {
        throw new Error('sumRows: the DOJ total cannot be summed with component rows (double count)');
      }
      var key = r.entity + '|' + r.grain + '|' + r.period;
      if (seen[key]) throw new Error('sumRows: duplicate row for ' + r.entity + ' ' + r.grain + ' ' + r.period);
      seen[key] = true;
    }
    var total = 0;
    for (var j = 0; j < rows.length; j++) {
      var v = value(rows[j], col);
      if (v === null) return null;
      total += v;
    }
    return total;
  }

  /* Sum of one column across the values of ONE dimension, for ONE entity, grain and period (a
     dimension's values partition the total, doj_leaving). Refused, by throwing: rows of more than one
     entity, grain, period or dimension; a missing entity or value; a value listed twice. After the
     checks, any null makes the sum null (never read as zero). */
  function sumAcrossValues(rows, col) {
    if (!rows.length) return null;
    var f = rows[0], seen = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeof r.entity !== 'string' || r.entity === '') throw new Error('sumAcrossValues: row ' + i + ' has no entity');
      if (r.entity !== f.entity || r.grain !== f.grain || r.period !== f.period || r.dimension !== f.dimension) {
        throw new Error('sumAcrossValues: rows are not one entity, grain, period and dimension (' + [f.entity, f.grain, f.period, f.dimension].join(' ') + ' vs ' + [r.entity, r.grain, r.period, r.dimension].join(' ') + ')');
      }
      if (r.value === undefined || r.value === null) throw new Error('sumAcrossValues: row ' + i + ' has no value');
      if (seen[r.value]) throw new Error('sumAcrossValues: value ' + r.value + ' listed twice');
      seen[r.value] = true;
    }
    var total = 0;
    for (var j = 0; j < rows.length; j++) {
      var v = value(rows[j], col);
      if (v === null) return null;
      total += v;
    }
    return total;
  }

  /* The kind the cube meta declares for a column ('stock', 'flow', 'stock_change', 'flag', ...). */
  function kindOf(meta, col) {
    var c = meta && meta.columns ? meta.columns.filter(function (x) { return x.name === col; })[0] : null;
    return c ? c.kind : null;
  }

  var SUMMABLE_OVER_TIME = { flow: true, stock_change: true };

  /* Sum of one column over consecutive periods of ONE entity and ONE grain. Allowed only for a
     column the meta declares as a flow or a stock change (a sum of headcount_change telescopes to
     last headcount minus the headcount before the first period, so no two rows are subtracted).
     Refused, by throwing: stock, rate, flag or undeclared columns; rows of more than one entity
     or grain; a missing entity; duplicate or missing periods (gaps). Rows are taken in time order.
     After the checks, any null value makes the sum null (never read as zero). */
  function sumAcrossPeriods(rows, col, meta) {
    var kind = kindOf(meta, col);
    if (!SUMMABLE_OVER_TIME[kind]) {
      throw new Error('sumAcrossPeriods: ' + col + ' is ' + (kind || 'not declared in the meta') + ', not a flow or stock change');
    }
    if (!rows.length) return null;
    var sorted = rows.slice().sort(function (a, b) { return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : 0; });
    var e = sorted[0].entity, g = sorted[0].grain;
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      if (typeof r.entity !== 'string' || r.entity === '') throw new Error('sumAcrossPeriods: a row has no entity');
      if (r.entity !== e) throw new Error('sumAcrossPeriods: rows of more than one entity (' + e + ', ' + r.entity + ')');
      if (r.grain !== g) throw new Error('sumAcrossPeriods: rows of more than one grain (' + g + ', ' + r.grain + ')');
      if (i > 0) {
        var expected = periods.addMonths(periods.periodBounds(sorted[i - 1].period).end, 1);
        if (r.period_first_month !== expected) {
          throw new Error('sumAcrossPeriods: periods are not consecutive (' + sorted[i - 1].period + ' then ' + r.period + ')');
        }
      }
    }
    var total = 0;
    for (var j = 0; j < sorted.length; j++) {
      var v = value(sorted[j], col);
      if (v === null) return null;
      total += v;
    }
    return total;
  }

  /* The row of the same entity and grain for the period just before this row's period, or null. */
  function previousRow(rows, row) {
    var key = periods.periodKey(periods.addMonths(row.period_first_month, -1), row.grain);
    return rows.filter(function (r) { return r.entity === row.entity && r.grain === row.grain && r.period === key; })[0] || null;
  }

  function divide(num, den) { return num === null || den === null || den === 0 ? null : num / den; }

  function ratio(row, numCol, denCol) { return divide(value(row, numCol), value(row, denCol)); }

  function ratioOfSums(rows, numCol, denCol) { return divide(sumRows(rows, numCol), sumRows(rows, denCol)); }

  function rateColumns(measure, method) {
    return { num: measure + '_' + method + '_num', den: 'rate_' + method + '_den', smallBase: 'rate_' + method + '_small_base' };
  }

  /* One rate per row, plus the flags the cube set. */
  function rateSeries(rows, measure, method) {
    var c = rateColumns(measure, method);
    return rows.map(function (r) {
      return {
        period: r.period,
        value: ratio(r, c.num, c.den),
        smallBase: r[c.smallBase] === true,
        partial: r.partial === true,
        provisional: r.provisional === true
      };
    });
  }

  /* Developer guard: every row's period fields agree with its key. Returns a list of problems. */
  function validateRows(rows) {
    var errs = [];
    rows.forEach(function (r, i) {
      try {
        if (periods.grainOf(r.period) !== r.grain) errs.push(i + ': grain ' + r.grain + ' vs ' + r.period);
        var b = periods.periodBounds(r.period);
        if (b.start !== r.period_first_month) errs.push(i + ': first month of ' + r.period);
        if (!(r.period_last_month >= b.start && r.period_last_month <= b.end)) errs.push(i + ': last month of ' + r.period);
        if (r.period_last_month !== b.end && r.partial !== true) errs.push(i + ': ' + r.period + ' ends early but is not partial');
      } catch (e) { errs.push(i + ': ' + e.message); }
    });
    return errs;
  }

  function monthBounds(rows) {
    var months = rows.filter(function (r) { return r.grain === 'month'; }).map(function (r) { return r.period; }).sort();
    return months.length ? { start: months[0], end: months[months.length - 1] } : null;
  }

  /* ---- Several components together (D-078): the same key's rows of the selected components, summed. Components
     partition DOJ, so counts, headcounts and rate numerators and denominators add up; a rate is then a summed numerator
     over a summed denominator (ratio of sums), a coverage a summed known over summed departures, and the small-base flag
     the D-007 rule (summed denominator below 30) applied here. Never across months, series or administrations: the rows
     summed always share the whole key. DOJ itself is never part of a combination. */
  var SMALL_BASE = 30; // D-007
  var SUMMED_KINDS = { stock: true, stock_change: true, flow: true, rate_numerator: true, rate_denominator: true };

  /* meta.columns -> which columns are summed, which flags are OR-ed, which are recomputed */
  function combinePlan(meta) {
    var plan = { sum: [], or: [], smallBase: [], notApplicable: [], coverage: [], denOf: {} };
    (meta && meta.columns || []).forEach(function (c) {
      if (SUMMED_KINDS[c.kind] && !/_months$/.test(c.name)) plan.sum.push(c.name); // a months count is the same for each, not added
      else if (c.kind === 'flag' && /small_base$/.test(c.name)) plan.smallBase.push(c.name);
      else if (c.name === 'rate_not_applicable') plan.notApplicable.push(c.name);
      else if (c.kind === 'flag' && c.name !== 'is_unknown') plan.or.push(c.name);
      else if (c.kind === 'coverage') plan.coverage.push(c.name);
    });
    if (!plan.sum.length) throw new Error('combinePlan: the meta lists no summable columns');
    // each rate column's denominator: attrition_a_num, quit_a_num, ... -> rate_a_den; attrition_num, rate_num, ... -> rate_den
    plan.sum.forEach(function (c) {
      var m = /^(?:attrition|quit|retirement)_([abc])_num$/.exec(c);
      if (m) plan.denOf[c] = 'rate_' + m[1] + '_den';
      else if (/^(?:attrition|quit|retirement|rate)_num$/.test(c)) plan.denOf[c] = 'rate_den';
      else if (/^rate_([abc]_)?den$/.test(c)) plan.denOf[c] = c;
    });
    return plan;
  }

  /* rows: one row per selected component, all with the same key (keyCols). Returns the summed row, entity 'SEL'. */
  function sumAcrossEntities(rows, meta, keyCols) {
    if (!rows.length) throw new Error('sumAcrossEntities: no rows');
    var plan = combinePlan(meta), f = rows[0], seen = {};
    rows.forEach(function (r, i) {
      if (typeof r.entity !== 'string' || !r.entity) throw new Error('sumAcrossEntities: row ' + i + ' has no entity');
      if (r.entity === 'DOJ' || r.entity === 'SEL') throw new Error('sumAcrossEntities: ' + r.entity + ' cannot be part of a combination');
      if (seen[r.entity]) throw new Error('sumAcrossEntities: ' + r.entity + ' listed twice');
      seen[r.entity] = true;
      // the key, and the months a row's stocks come from (a component that ended early has a different last month)
      keyCols.concat(['period_last_month', 'month_n', 'month_0']).forEach(function (k) {
        if (r[k] !== f[k]) throw new Error('sumAcrossEntities: rows differ on ' + k + ' (' + f[k] + ' vs ' + r[k] + '): only the same period, series and key are summed');
      });
    });
    var out = Object.assign({}, f, { entity: 'SEL', entities: rows.map(function (r) { return r.entity; }) });
    /* D-079: structural empties. A component with nobody in the group over the window has an empty rate by the cube's own
       rules: its denominator is null or 0 while its counts are published (D-027: no month-end with anyone on board), or
       the cube flags it rate_not_applicable (D-038). Such a component adds 0 to the combined rate numerator AND
       denominator (its few departures in those windows stay out of combined rates, as D-027 has it); its counts still add
       normally. A genuinely missing value (a null count, or a null denominator with no published counts) still empties
       the sum, and an Unknown row never has a rate. The combined rate is empty when every component is structural. */
    function structural(r, den) {
      if (r.is_unknown === true) return false;
      var d = value(r, den);
      if (d !== null && d !== 0) return false;
      if (r.rate_not_applicable === true) return true;
      return ['headcount', 'headcount_0', 'headcount_n', 'departures'].some(function (c) { return value(r, c) !== null; });
    }
    var allStructural = {};
    plan.sum.forEach(function (c) {
      var den = plan.denOf[c], total = 0, any = false, nul = false;
      rows.forEach(function (r) {
        if (den && structural(r, den)) return; // contributes 0 to the rate's numerator and denominator
        var v = value(r, c); if (v === null) nul = true; else { any = true; total += v; }
      });
      if (den && !any && !nul) { allStructural[den] = true; out[c] = null; return; } // every component structural: no rate
      out[c] = nul || !any ? null : total; // a genuinely missing value in any component keeps the total null (invariant 4)
    });
    plan.or.forEach(function (c) { out[c] = rows.some(function (r) { return r[c] === true; }); });
    plan.smallBase.forEach(function (c) { var d = out[c.replace(/small_base$/, 'den')]; out[c] = d !== null && d !== undefined && d < SMALL_BASE; });
    plan.notApplicable.forEach(function (c) { out[c] = allStructural.rate_den === true || out.rate_den === 0; });
    plan.coverage.forEach(function (c) { out[c] = c === 'years_of_service_lost_coverage' ? divide(value(out, 'yos_known'), value(out, 'departures')) : null; }); // others: per dimension, below
    return out;
  }

  /* All rows of the selected entities -> one summed row per key. entities: the selected codes (two or more; never DOJ). */
  function combineEntities(rows, entities, meta, keyCols) {
    if (entities.indexOf('DOJ') >= 0) throw new Error('combineEntities: DOJ cannot be combined with its components');
    var want = {}, groups = {}, order = [];
    entities.forEach(function (e) { want[e] = true; });
    rows.forEach(function (r) {
      if (!want[r.entity]) return;
      var k = keyCols.map(function (c) { return String(r[c]); }).join('\u0001');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    var out = order.map(function (k) { return sumAcrossEntities(groups[k], meta, keyCols); });
    // a breakdown's coverage (doj_leaving): the known groups' summed departures over all groups' summed departures, per dimension
    if (out.length && 'coverage' in out[0] && 'dimension' in out[0]) {
      var dims = {};
      out.forEach(function (r) { var k = r.grain + '\u0001' + r.period + '\u0001' + r.dimension + '\u0001' + (r.series_group || ''); (dims[k] = dims[k] || []).push(r); });
      Object.keys(dims).forEach(function (k) {
        var all = dims[k], known = all.filter(function (r) { return r.is_unknown !== true; });
        var cov = divide(sumAcrossValues(known, 'departures'), sumAcrossValues(all, 'departures'));
        all.forEach(function (r) { r.coverage = cov; });
      });
    }
    return out;
  }

  return {
    sumAcrossEntities: sumAcrossEntities, combineEntities: combineEntities, combinePlan: combinePlan, SMALL_BASE: SMALL_BASE,
    fromCube: fromCube, value: value, kindOf: kindOf, sumAcrossValues: sumAcrossValues, sumAcrossPeriods: sumAcrossPeriods, previousRow: previousRow, divide: divide, selectRows: selectRows, sumColumns: sumColumns, sumRows: sumRows,
    ratio: ratio, ratioOfSums: ratioOfSums, rateColumns: rateColumns, rateSeries: rateSeries,
    validateRows: validateRows, monthBounds: monthBounds
  };
});
