/* Shared parts of the data pages (Workforce size, Hiring and departures): number formats,
   loading the cube, the "data not available" state, the standard controls (component, view,
   range), period labels, dataset builders and flag notes. Browser only. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  var NUM = new Intl.NumberFormat('en-US');

  var fmt = {
    int: function (v) { return NUM.format(v); },
    signed: function (v) { return (v > 0 ? '+' : '') + NUM.format(v); },
    pctChange: function (v) { return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; },
    rate: function (v) { return (v * 100).toFixed(1) + '%'; }
  };

  function getJson(url) {
    return fetch(OPM.shell.asset(url)).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  function unavailable(copy, pageName, err) {
    console.info(pageName + ': data not available (' + (err && err.message) + ')');
    document.getElementById('page-body').appendChild(OPM.dom.h('p', { class: 'opm-unavailable', role: 'status', text: copy.t('shell:data.unavailable') }));
    OPM.shell.refreshDraft();
    OPM.page = { unavailable: true };
  }

  /* Load the core cube and its meta, plus any extra files (urls under data/); on failure show the
     signed "data not available" state. build(copy, cube, meta, extras) */
  function load(pageName, build, extraUrls) {
    OPM.shell.ready.then(function (ctx) {
      var urls = ['data/doj_core.json', 'data/doj_core.meta.json'].concat(extraUrls || []);
      return Promise.all(urls.map(getJson)).then(function (res) {
        build(ctx.copy, res[0], res[1], res.slice(2));
      }, function (err) { unavailable(ctx.copy, pageName, err); });
    }).catch(function (e) { console.error(e); });
  }

  /* Period labels from the signed formats. */
  function labels(copy) {
    var P = OPM.periods;
    var f = {
      months: copy.raw('shell:period.months'), month: copy.raw('shell:period.month'),
      fiscalQuarter: copy.raw('shell:period.quarter'), fiscalYear: copy.raw('shell:period.fy')
    };
    function label(period) { return P.periodLabel(period, f); }
    return {
      fmt: f, label: label,
      periodText: function (row) { return row.partial ? copy.t('shell:flag.partial.label', { period: label(row.period) }) : label(row.period); }
    };
  }

  /* A line dataset. markers[i]: 'smallBase' (hollow circle), 'partial' (diamond), 'provisional'
     (small hollow circle) or null; dashIn[i]: the segment ending at i is dashed (provisional). */
  function lineDataset(values, color, label, dashIn, markers) {
    var c = OPM.chartFrame.token(color), bg = OPM.chartFrame.token('--color-panel');
    return {
      type: 'line', label: label, data: values, _color: c, _dashIn: dashIn, _markers: markers,
      borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0, spanGaps: false, // straight segments: no values implied between points
      pointStyle: markers.map(function (m) { return m === 'partial' ? 'rectRot' : 'circle'; }),
      pointRadius: markers.map(function (m) { return m === 'partial' ? 5 : m === 'smallBase' ? 4 : m === 'provisional' ? 3 : 0; }),
      pointBackgroundColor: markers.map(function (m) { return m ? bg : c; }), pointBorderColor: c,
      pointBorderWidth: markers.map(function (m) { return m === 'smallBase' ? 2 : 1.5; }), pointHoverRadius: 4,
      segment: { borderDash: function (ctx) { return dashIn[ctx.p1DataIndex] ? [5, 4] : undefined; } }
    };
  }

  function pointMarkers(rows, smallBase) {
    return rows.map(function (r, i) { return smallBase && smallBase[i] ? 'smallBase' : r.partial ? 'partial' : r.provisional ? 'provisional' : null; });
  }

  /* A bar dataset; provisional bars are hatched. */
  function barDataset(values, provisional, color, label, extra) {
    var c = OPM.chartFrame.token(color);
    return Object.assign({
      type: 'bar', label: label, data: values, _color: c, _faded: provisional,
      backgroundColor: provisional.map(function (f) { return f ? OPM.chartFrame.hatch(c) : c; }), borderColor: c,
      borderWidth: provisional.map(function (f) { return f ? 1 : 0; })
    }, extra || {});
  }

  /* The provisional note, and a partial note per partial row when the page has one (partialText). */
  function flagNotes(copy, rows, partialText) {
    var out = [];
    if (rows.some(function (r) { return r.provisional; })) out.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
    if (partialText) rows.filter(function (r) { return r.partial; }).forEach(function (r) { out.push({ text: partialText(r), flag: 'partial' }); });
    return out;
  }

  /* A long axis name wraps onto lines of at most max characters instead of being clipped. */
  function wrapLabel(text, max) {
    if (text.length <= max) return text;
    var lines = [''];
    text.split(' ').forEach(function (w) {
      var cur = lines[lines.length - 1];
      if (cur && (cur + ' ' + w).length > max) lines.push(w); else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
    });
    return lines;
  }
  /* The category-axis tick callback for horizontal bar charts: group names, wrapped on narrow charts. */
  function categoryTicks(v, i) { return wrapLabel(this.getLabelForValue(i), this.chart.width < 520 ? 20 : 40); }
  /* Row height for horizontal bar charts: taller on narrow screens, where names wrap onto three lines. */
  function barRowHeight() { return root.innerWidth < 600 ? 46 : 30; }

  /* A headline tile: name (with an optional badge), value, then sub lines. */
  function fillTile(el, parts) {
    var h = OPM.dom.h;
    el.textContent = '';
    el.appendChild(h('p', { class: 'opm-tile__name' }, [parts.name].concat(parts.badges || [])));
    el.appendChild(h('p', { class: 'opm-tile__value', text: parts.value }));
    (parts.subs || []).forEach(function (s) { if (s) el.appendChild(h('p', { class: 'opm-tile__sub' + (s.cls ? ' ' + s.cls : ''), text: s.text || s })); });
  }

  function provisionalBadge(copy) {
    var t = copy.t('shell:flag.provisional');
    return OPM.dom.h('span', { class: 'opm-tile__prov', role: 'img', 'aria-label': t, title: t });
  }

  OPM.pageKit = { fmt: fmt, load: load, getJson: getJson, unavailable: unavailable, wrapLabel: wrapLabel, categoryTicks: categoryTicks, barRowHeight: barRowHeight, labels: labels, lineDataset: lineDataset, pointMarkers: pointMarkers,
    barDataset: barDataset, flagNotes: flagNotes, fillTile: fillTile, provisionalBadge: provisionalBadge };
})(typeof self !== 'undefined' ? self : this);
