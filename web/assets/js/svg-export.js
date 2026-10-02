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

  /* Split one run into paths by dash state: a segment is dashed when its end point says dashIn. */
  function segments(run) {
    var out = [], cur = null;
    for (var i = 1; i < run.length; i++) {
      var dash = !!run[i].dashIn;
      if (!cur || cur.dash !== dash) { cur = { dash: dash, pts: [run[i - 1]] }; out.push(cur); }
      cur.pts.push(run[i]);
    }
    return out;
  }

  /* spec: { width, height, area:{left,top,right,bottom}, title, note, font, colors:{ink,muted,grid,bg,plot},
             xTicks:[{x,label}], yTicks:[{y,label}],
             series:[{label, color, kind:'line'|'bar', points:[{x,y,dashIn,marker}|null], bars:[{x,y,w,h,faded}]|null}],
             markers:[{x, kind:'break'}], labels:[{x, y, text, anchor}], bands:[{x0, x1, label, color, opacity}] } */
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
    // administration bands (shading.js), behind everything else in the plot, each named at its top
    (spec.bands || []).forEach(function (b) {
      out.push('<g class="opm-svg-band"><rect x="' + n(b.x0) + '" y="' + n(a.top) + '" width="' + n(b.x1 - b.x0) + '" height="' + n(a.bottom - a.top) + '" fill="' + esc(b.color) + '" fill-opacity="' + n(b.opacity) + '"/>' +
        '<text x="' + n(b.x0 + 4) + '" y="' + n(a.top + 14) + '" font-size="11" font-weight="600" fill="' + esc(muted) + '">' + esc(b.label) + '</text></g>');
    });
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
          if (!b || !isFinite(b.h) || !isFinite(b.w)) return;
          out.push('<rect x="' + n(b.x) + '" y="' + n(b.y) + '" width="' + n(b.w) + '" height="' + n(b.h) + '" fill="' + esc(s.color) + '"' +
            (b.faded ? ' fill-opacity="0.45" stroke="' + esc(s.color) + '" stroke-dasharray="3 2"' : '') + '/>');
        });
      } else if (s.pointsOnly) {
        (s.points || []).forEach(function (p) {
          if (p) out.push('<rect class="opm-svg-point" x="' + n(p.x - 4) + '" y="' + n(p.y - 4) + '" width="8" height="8" fill="' + esc(s.color) + '" stroke="' + esc(c.bg || '#fff') + '" stroke-width="1"/>');
        });
      } else {
        runs(s.points || []).forEach(function (run) {
          if (run.length === 1) {
            out.push('<circle cx="' + n(run[0].x) + '" cy="' + n(run[0].y) + '" r="2" fill="' + esc(s.color) + '"/>');
            return;
          }
          segments(run).forEach(function (seg) {
            var d = seg.pts.map(function (p, j) { return (j ? 'L' : 'M') + n(p.x) + ' ' + n(p.y); }).join(' ');
            out.push('<path d="' + d + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="2"' +
              (seg.dash ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round"/>');
          });
        });
        (s.points || []).forEach(function (p) {
          if (!p || !p.marker) return;
          if (p.marker === 'partial') {
            out.push('<path class="opm-svg-partial" d="M' + n(p.x) + ' ' + n(p.y - 5) + ' L' + n(p.x + 5) + ' ' + n(p.y) + ' L' + n(p.x) + ' ' + n(p.y + 5) + ' L' + n(p.x - 5) + ' ' + n(p.y) + ' Z" fill="' + esc(c.bg || '#fff') + '" stroke="' + esc(s.color) + '" stroke-width="1.5"/>');
          } else {
            out.push('<circle class="opm-svg-provisional" cx="' + n(p.x) + '" cy="' + n(p.y) + '" r="3" fill="' + esc(c.bg || '#fff') + '" stroke="' + esc(s.color) + '" stroke-width="1.5"/>');
          }
        });
      }
      out.push('</g>');
    });
    (spec.markers || []).forEach(function (m) {
      // kind 'break': dashed rule and '!'; kind 'rule': the chosen period, a plain rule
      out.push('<g class="opm-svg-marker opm-svg-marker--' + esc(m.kind || 'break') + '"><line x1="' + n(m.x) + '" x2="' + n(m.x) + '" y1="' + n(a.top) + '" y2="' + n(a.bottom) + '" stroke="' + esc(ink) + '" stroke-width="' + (m.kind === 'rule' ? 1.5 : 1) + '"' + (m.kind === 'rule' ? '' : ' stroke-dasharray="2 3"') + '/>' +
        (m.kind === 'rule' ? '' : '<text x="' + n(m.x) + '" y="' + n(a.top + 11) + '" font-size="12" font-weight="700" text-anchor="middle" fill="' + esc(ink) + '">!</text>') +
        (m.label ? '<text x="' + n(m.x + 4) + '" y="' + n(a.top - 4) + '" font-size="11" fill="' + esc(ink) + '">' + esc(m.label) + '</text>' : '') + '</g>');
    });
    (spec.labels || []).forEach(function (l) {
      out.push('<text class="opm-svg-label" x="' + n(l.x) + '" y="' + n(l.y) + '" font-size="11" text-anchor="' + (l.anchor || 'start') + '" fill="' + esc(ink) + '">' + esc(l.text) + '</text>');
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
      var s = { label: ds.label, color: ds.borderColor, kind: kind, pointsOnly: ds.showLine === false };
      if (kind === 'bar') {
        s.color = ds.backgroundColor;
        var horizontal = chart.options.indexAxis === 'y';
        s.bars = meta.data.map(function (el, j) {
          if (ds.data[j] === null || ds.data[j] === undefined) return null;
          var p = el.getProps(['x', 'y', 'base', 'width', 'height'], true);
          var faded = !!(ds._faded && ds._faded[j]);
          if (horizontal) return { x: Math.min(p.x, p.base), y: p.y - p.height / 2, w: Math.abs(p.x - p.base), h: p.height, faded: faded };
          return { x: p.x - p.width / 2, y: Math.min(p.y, p.base), w: p.width, h: Math.abs(p.base - p.y), faded: faded };
        });
        if (typeof ds.backgroundColor !== 'string') s.color = ds.borderColor;
      } else {
        s.points = meta.data.map(function (el, j) {
          if (ds.data[j] === null || ds.data[j] === undefined) return null;
          var p = el.getProps(['x', 'y'], true);
          return { x: p.x, y: p.y, dashIn: !!(ds._dashIn && ds._dashIn[j]), marker: ds._markers ? ds._markers[j] || null : null };
        });
      }
      spec.series.push(s);
    });
    Object.keys(extra || {}).forEach(function (k) { spec[k] = extra[k]; });
    return spec;
  }

  /* Several charts in one SVG, laid out in a grid (the small multiples). Each cell is a
     standalone buildSvg() drawing nested at its offset. */
  function buildGridSvg(specs, opts) {
    var cols = Math.max(1, opts.cols || 1), gap = 12, pad = 12;
    var cells = specs.map(function (sp) {
      var svg = buildSvg(sp);
      var m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
      return { svg: svg, w: +m[1], h: +m[2] };
    });
    var cellW = Math.max.apply(null, cells.map(function (c) { return c.w; }).concat([1]));
    var cellH = Math.max.apply(null, cells.map(function (c) { return c.h; }).concat([1]));
    var rows = Math.ceil(cells.length / cols), titleH = opts.title ? 30 : 0, noteH = opts.note ? 22 : 0;
    var W = pad * 2 + cols * cellW + (cols - 1) * gap, H = pad * 2 + titleH + rows * cellH + (rows - 1) * gap + noteH;
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + n(W) + '" height="' + n(H) + '" viewBox="0 0 ' + n(W) + ' ' + n(H) + '" font-family="' + esc(opts.font || 'sans-serif') + '">'];
    if (opts.title) out.push('<title>' + esc(opts.title) + '</title>');
    out.push('<rect width="100%" height="100%" fill="' + esc(opts.bg || '#fff') + '"/>');
    if (opts.title) out.push('<text x="' + pad + '" y="' + (pad + 16) + '" font-size="15" font-weight="700" fill="' + esc(opts.ink || '#000') + '">' + esc(opts.title) + '</text>');
    cells.forEach(function (c, i) {
      var x = pad + (i % cols) * (cellW + gap), y = pad + titleH + Math.floor(i / cols) * (cellH + gap);
      out.push(c.svg.replace('<svg ', '<svg x="' + n(x) + '" y="' + n(y) + '" '));
    });
    if (opts.note) out.push('<text x="' + pad + '" y="' + n(H - pad) + '" font-size="11" fill="' + esc(opts.muted || '#666') + '">' + esc(opts.note) + '</text>');
    out.push('</svg>');
    return out.join('\n');
  }

  function download(svg, filename) {
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { buildSvg: buildSvg, buildGridSvg: buildGridSvg, fromChart: fromChart, segments: segments, download: download, runs: runs, esc: esc };
});
