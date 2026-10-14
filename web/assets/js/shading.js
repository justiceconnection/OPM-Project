/* Administration shading on calendar timelines (docs/pages/redesign.md section 3, D-072). Our own Chart.js plugin
   and tokens (D-022: LIONS's administration bands were looked at for the look only; no LIONS code). One band per
   administration, its name at the top: Obama II, Trump I and Biden in alternating light neutral tints, Trump II a
   little stronger; nothing before Jan 2013. Bands sit behind the data, never change it, and go into the SVG export.

   bands() is pure: from the categories of a chart (each a run of calendar months, as a cube row gives them) it
   returns where each administration starts and ends in category units, to the month: on a yearly or quarterly axis
   a boundary that falls inside a period is placed proportionally inside it. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./admin.js') : root.OPM.admin);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.shading = api; }
})(typeof self !== 'undefined' ? self : this, function (P, A) {
  'use strict';

  var FILL = { obama2: '--shade-1', trump1: '--shade-2', biden: '--shade-1', trump2: '--shade-strong' };

  /* periods: [{ first: 'YYYY-MM', last: 'YYYY-MM' }] in axis order; latest: the newest month (Trump II's open end).
     Returns [{ id, x0, x1, strong }], x in category units: category i spans i - 0.5 to i + 0.5. */
  function bands(periods, latest) {
    var n = periods.length;
    if (!n) return [];
    var months = periods.map(function (p) { return P.listMonths(p.first, p.last); });
    function edge(m, after) { // the x of the start of month m (or of its end, after = true); null when off the axis
      for (var i = 0; i < n; i++) {
        var j = months[i].indexOf(m);
        if (j >= 0) return i - 0.5 + (j + (after ? 1 : 0)) / months[i].length;
      }
      return null;
    }
    var axisFirst = periods[0].first, axisLast = periods[n - 1].last;
    var out = [];
    A.LIST.forEach(function (a) {
      var first = a.first, last = a.last || latest;
      if (last < axisFirst || first > axisLast) return;
      var x0 = first < axisFirst ? -0.5 : edge(first, false);
      var x1 = last > axisLast ? n - 0.5 : edge(last, true);
      if (x0 === null || x1 === null || x1 <= x0) return;
      out.push({ id: a.id, x0: x0, x1: x1, strong: a.last === null });
    });
    return out;
  }

  /* The categories of cube rows: each row's months (a partial period runs to its last published month). */
  function periodsOf(rows) { return rows.map(function (r) { return { first: r.period_first_month, last: r.period_last_month }; }); }

  /* 'rgba(r, g, b, a)' -> { color: '#rrggbb', opacity } for SVG; anything else is returned as an opaque color. */
  function svgFill(css) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(css || '');
    if (!m) return { color: css || '#000', opacity: 1 };
    var hex = '#' + [m[1], m[2], m[3]].map(function (v) { return ('0' + (+v).toString(16)).slice(-2); }).join('');
    return { color: hex, opacity: m[4] === undefined ? 1 : +m[4] };
  }

  /* Where each band's name goes in the strip above the plot (L-103): left-aligned at its band's start when it fits
     inside the band, otherwise left out; the last band (Trump II, open) is always named, right-aligned at its end,
     reaching left past a narrow band if it must. bands: [{ x0, x1, w (text width), strong }] in pixels; returns
     [{ x, anchor: 'start' | 'end' } | null] per band. Pure. */
  function labelPlacement(bands, left, right) {
    var out = bands.map(function (b, i) {
      var x0 = Math.max(left, b.x0), x1 = Math.min(right, b.x1);
      if (i === bands.length - 1 && b.strong) return { x: x1 - 2, anchor: 'end', from: x1 - 2 - b.w };
      return b.w + 8 <= x1 - x0 ? { x: x0 + 4, anchor: 'start', from: x0 + 4, to: x0 + 4 + b.w } : null;
    });
    // the always-named last band wins over a neighbour it would overlap
    var lastI = out.length - 1, last = out[lastI];
    if (last && last.anchor === 'end') for (var i = 0; i < lastI; i++) if (out[i] && out[i].to + 4 > last.from) out[i] = null;
    return out;
  }

  /* Browser only: the plugin. options: { bands: [{ x0, x1, label, fill, strong }], color, font }. Bands are drawn behind
     the data; their names in a strip above the plot area (the chart reserves it with layout.padding.top). */
  var registered = false;
  function register(Chart) {
    if (registered) return;
    registered = true;
    Chart.register({
      id: 'opmAdminBands',
      beforeDatasetsDraw: function (chart, args, opts) {
        chart._opmBandLabels = [];
        if (!opts || !opts.bands || !opts.bands.length) return;
        var xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 11px ' + opts.font;
        var px = opts.bands.map(function (b) {
          return { x0: xs.getPixelForValue(b.x0), x1: xs.getPixelForValue(b.x1), w: ctx.measureText(b.label).width, strong: !!b.strong, label: b.label, fill: b.fill };
        });
        ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
        px.forEach(function (b) {
          var x0 = Math.max(area.left, b.x0), x1 = Math.min(area.right, b.x1);
          if (x1 > x0) { ctx.fillStyle = b.fill; ctx.fillRect(x0, area.top, x1 - x0, area.bottom - area.top); }
        });
        ctx.restore();
        ctx.save();
        ctx.font = '600 11px ' + opts.font; ctx.fillStyle = opts.color; ctx.textBaseline = 'bottom';
        labelPlacement(px, area.left, area.right).forEach(function (p, i) {
          if (!p) return;
          ctx.textAlign = p.anchor === 'end' ? 'right' : 'left';
          ctx.fillText(px[i].label, p.x, area.top - 4);
          chart._opmBandLabels.push({ label: px[i].label, x: p.x, anchor: p.anchor, y: area.top - 4 });
        });
        ctx.restore();
      }
    });
  }

  /* Browser only: the bands in pixels and their names as placed, for the SVG export. */
  function exportBands(chart) {
    var o = chart.options.plugins && chart.options.plugins.opmAdminBands;
    if (!o || !o.bands) return [];
    // placed afresh from the chart's current bands (the same placement the screen uses), never from a cache (L-107)
    var xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
    ctx.save(); ctx.font = '600 11px ' + o.font;
    var px = o.bands.map(function (b) { return { x0: xs.getPixelForValue(b.x0), x1: xs.getPixelForValue(b.x1), w: ctx.measureText(b.label).width, strong: !!b.strong }; });
    ctx.restore();
    var placed = labelPlacement(px, area.left, area.right);
    return o.bands.map(function (b, i) {
      var x0 = Math.max(area.left, px[i].x0), x1 = Math.min(area.right, px[i].x1), f = svgFill(b.fill), lab = placed[i];
      return { x0: x0, x1: x1, label: lab ? b.label : '', labelX: lab ? lab.x : null, anchor: lab ? lab.anchor : null, color: f.color, opacity: f.opacity };
    }).filter(function (b) { return b.x1 > b.x0; });
  }

  return { FILL: FILL, bands: bands, periodsOf: periodsOf, svgFill: svgFill, labelPlacement: labelPlacement, register: register, exportBands: exportBands };
});
