/* Chart-page helpers (Workforce size, Hiring and departures, Who is leaving, Components compared):
   period labels with "(partial)", dataset builders, flag notes and headline tiles. They extend
   OPM.pageKit. Pages without charts (Reading the data, Workforce Look-Up) do not load this file, so
   their copy audit lists only what they draw. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;

  var baseLabels = K.labels;
  function labels(copy) {
    var L = baseLabels(copy);
    L.periodText = function (row) { return row.partial ? copy.t('shell:flag.partial.label', { period: L.label(row.period) }) : L.label(row.period); };
    return L;
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

  Object.assign(K, { labels: labels, lineDataset: lineDataset, pointMarkers: pointMarkers, barDataset: barDataset, flagNotes: flagNotes,
    fillTile: fillTile, provisionalBadge: provisionalBadge });
})(typeof self !== 'undefined' ? self : this);
