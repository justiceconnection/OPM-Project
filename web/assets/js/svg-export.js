/* SVG export for a chart frame. buildSvg() is pure: it takes geometry already laid out by
   the chart (pixel positions of ticks, points and bars) and writes a standalone SVG string.
   fromChart() reads that geometry off a live Chart.js 4 instance. download() saves a file. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.svgExport = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function n(v) { return Math.round(v * 100) / 100; }

  /* Break a point list into runs at nulls, so a missing value is a gap, never a zero. */
  function runs(points) {
    var out = [], cur = [];
    points.forEach(function (p) {
      if (p && isFinite(p.x) && isFinite(p.y)) cur.push(p);
      else if (cur.length) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  }

  /* Legend items laid out left to right, wrapping at the width. Text width is estimated. */
  function legendLayout(series, width, pad, fontSize) {
    var x = pad, y = 0, rows = 1, items = [], charW = fontSize * 0.56;
    series.forEach(function (s) {
      var w = 11 + 6 + String(s.label).length * charW + 16;
      if (x + w > width - pad && x > pad) { x = pad; y += fontSize + 8; rows += 1; }
      items.push({ x: x, y: y, s: s });
      x += w;
    });
    return { items: items, height: rows * (fontSize + 8) };
  }

  /* spec: { width, height, area:{left,top,right,bottom}, title, note, font, colors:{ink,muted,grid,bg,plot},
             xTicks:[{x,label}], yTicks:[{y,label}],
             series:[{label, color, kind:'line'|'bar', points:[{x,y}|null], bars:[{x,y,w,h}], dash:bool}] } */
  function buildSvg(spec) {
    var c = spec.colors || {};
    var ink = c.ink || '#000', muted = c.muted || '#666', grid = c.grid || '#ddd';
    var font = spec.font || 'sans-serif', pad = 12;
    var titleH = spec.title ? 26 : 0;
    var leg = legendLayout(spec.series, spec.width, pad, 12);
    var top = pad + titleH + leg.height + 4;
    var noteH = spec.note ? 22 : 0;
    var W = spec.width, H = top + spec.height + noteH + pad;
    var a = spec.area, out = [];

    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + n(W) + '" height="' + n(H) + '" viewBox="0 0 ' + n(W) + ' ' + n(H) +
      '" font-family="' + esc(font) + '">');
    if (spec.title) out.push('<title>' + esc(spec.title) + '</title>');
    out.push('<rect width="100%" height="100%" fill="' + esc(c.bg || '#fff') + '"/>');
    if (spec.title) out.push('<text x="' + pad + '" y="' + (pad + 16) + '" font-size="15" font-weight="700" fill="' + esc(ink) + '">' + esc(spec.title) + '</text>');

    out.push('<g class="opm-svg-key" font-size="12" fill="' + esc(muted) + '">');
    leg.items.forEach(function (it) {
      var y = pad + titleH + it.y;
      out.push('<rect x="' + n(it.x) + '" y="' + n(y + 1) + '" width="11" height="11" rx="2" fill="' + esc(it.s.color) + '"/>');
      out.push('<text x="' + n(it.x + 17) + '" y="' + n(y + 11) + '">' + esc(it.s.label) + '</text>');
    });
    out.push('</g>');

    out.push('<g class="opm-svg-plot" transform="translate(0,' + n(top) + ')">');
    if (c.plot) out.push('<rect x="' + n(a.left) + '" y="' + n(a.top) + '" width="' + n(a.right - a.left) + '" height="' + n(a.bottom - a.top) + '" fill="' + esc(c.plot) + '"/>');
    out.push('<g class="opm-svg-y" font-size="11" fill="' + esc(muted) + '" text-anchor="end">');
    (spec.yTicks || []).forEach(function (t) {
      out.push('<line x1="' + n(a.left) + '" x2="' + n(a.right) + '" y1="' + n(t.y) + '" y2="' + n(t.y) + '" stroke="' + esc(grid) + '" stroke-width="1"/>');
      out.push('<text x="' + n(a.left - 6) + '" y="' + n(t.y + 4) + '">' + esc(t.label) + '</text>');
    });
    out.push('</g>');
    out.push('<g class="opm-svg-x" font-size="11" fill="' + esc(muted) + '" text-anchor="middle">');
    (spec.xTicks || []).forEach(function (t) {
      out.push('<text x="' + n(t.x) + '" y="' + n(a.bottom + 16) + '">' + esc(t.label) + '</text>');
    });
    out.push('</g>');

    spec.series.forEach(function (s, i) {
      out.push('<g class="opm-svg-series" data-index="' + i + '">');
      if (s.kind === 'bar') {
        (s.bars || []).forEach(function (b) {
          if (!b || !isFinite(b.h)) return;
          out.push('<rect x="' + n(b.x) + '" y="' + n(b.y) + '" width="' + n(b.w) + '" height="' + n(b.h) + '" fill="' + esc(s.color) + '"/>');
        });
      } else {
        runs(s.points || []).forEach(function (run) {
          var d = run.map(function (p, j) { return (j ? 'L' : 'M') + n(p.x) + ' ' + n(p.y); }).join(' ');
          out.push('<path d="' + d + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="2"' +
            (s.dash ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round"/>');
        });
      }
      out.push('</g>');
    });
    out.push('</g>');

    if (spec.note) out.push('<text x="' + pad + '" y="' + n(top + spec.height + 16) + '" font-size="11" fill="' + esc(muted) + '">' + esc(spec.note) + '</text>');
    out.push('</svg>');
    return out.join('\n');
  }

  function tickLabel(l) { return Array.isArray(l) ? l.join(' ') : String(l); }

  /* Geometry from a live Chart.js 4 chart. Hidden datasets are left out. */
  function fromChart(chart, extra) {
    var xs = chart.scales.x, ys = chart.scales.y;
    var spec = {
      width: chart.width, height: chart.height,
      area: { left: chart.chartArea.left, top: chart.chartArea.top, right: chart.chartArea.right, bottom: chart.chartArea.bottom },
      xTicks: xs.ticks.map(function (t, i) { return { x: xs.getPixelForTick(i), label: tickLabel(t.label) }; }),
      yTicks: ys.ticks.map(function (t, i) { return { y: ys.getPixelForTick(i), label: tickLabel(t.label) }; }),
      series: []
    };
    chart.data.datasets.forEach(function (ds, i) {
      if (!chart.isDatasetVisible(i)) return;
      var meta = chart.getDatasetMeta(i);
      var kind = (ds.type || chart.config.type) === 'bar' ? 'bar' : 'line';
      var s = { label: ds.label, color: ds.borderColor, kind: kind };
      if (kind === 'bar') {
        s.color = ds.backgroundColor;
        s.bars = meta.data.map(function (el, j) {
          if (ds.data[j] === null || ds.data[j] === undefined) return null;
          var p = el.getProps(['x', 'y', 'base', 'width'], true);
          return { x: p.x - p.width / 2, y: Math.min(p.y, p.base), w: p.width, h: Math.abs(p.base - p.y) };
        });
      } else {
        s.points = meta.data.map(function (el, j) {
          if (ds.data[j] === null || ds.data[j] === undefined) return null;
          var p = el.getProps(['x', 'y'], true);
          return { x: p.x, y: p.y };
        });
      }
      spec.series.push(s);
    });
    Object.keys(extra || {}).forEach(function (k) { spec[k] = extra[k]; });
    return spec;
  }

  function download(svg, filename) {
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { buildSvg: buildSvg, fromChart: fromChart, download: download, runs: runs, esc: esc };
});
