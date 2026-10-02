/* Chart frame for Chart.js 4: a panel with a title, a legend that toggles series, the plot,
   a notes area, and SVG export. Pages supply the
   datasets; colors come from the CSS tokens (--chart-N etc.), read at draw time.
   Also registers two small plugins of our own: opmMarkers (known-break markers on chosen
   category indices) and opmValueLabels (value at a bar's end, or at a line's last point). */
(function (root) {
  'use strict';
  var h = function () { return root.OPM.dom.h.apply(null, arguments); };

  function token(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* A diagonal-hatch fill for provisional bars: the series color, lighter, with stripes. */
  function hatch(color) {
    var c = document.createElement('canvas'); c.width = 6; c.height = 6;
    var x = c.getContext('2d');
    x.fillStyle = color; x.globalAlpha = 0.35; x.fillRect(0, 0, 6, 6);
    x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(-1, 7); x.lineTo(7, -1); x.stroke();
    return x.createPattern(c, 'repeat');
  }

  var registered = false;
  function registerPlugins() {
    if (registered) return;
    registered = true;
    root.Chart.register({
      id: 'opmMarkers',
      afterDatasetsDraw: function (chart, args, opts) {
        chart._opmRuleLabel = null; // reset on every draw (L-107)
        if (!opts || !opts.flags) return;
        var xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        var glyph = opts.glyph === undefined ? '!' : opts.glyph; // '' draws the rule alone (a chosen period)
        opts.flags.forEach(function (on, i) {
          if (!on) return;
          var x = xs.getPixelForValue(i);
          ctx.strokeStyle = opts.color; ctx.lineWidth = opts.width || 1; ctx.setLineDash(opts.dash || [2, 3]);
          ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
          ctx.setLineDash([]);
          if (glyph) { ctx.fillStyle = opts.color; ctx.font = '700 12px ' + opts.font; ctx.textAlign = 'center'; ctx.fillText(glyph, x, area.top + 11); }
          // an optional label at the top of the rule (the month-N rule's "Trump II so far (month {n})"): on its right, or its left near the edge
          if (opts.label) {
            ctx.font = '600 11px ' + opts.font; ctx.fillStyle = opts.color; ctx.textBaseline = 'top';
            var w = ctx.measureText(opts.label).width, right = x + 6 + w <= area.right;
            ctx.textAlign = right ? 'left' : 'right';
            ctx.fillText(opts.label, right ? x + 6 : x - 6, area.top + 4);
            chart._opmRuleLabel = { text: opts.label, x: right ? x + 6 : x - 6, anchor: right ? 'start' : 'end' };
          }
        });
        ctx.restore();
      }
    });
    /* opmRefLine: a vertical rule at a value on the x (value) axis, with a label (a reference such as DOJ overall). */
    root.Chart.register({
      id: 'opmRefLine',
      afterDatasetsDraw: function (chart, args, opts) {
        if (!opts || opts.value === null || opts.value === undefined || !isFinite(opts.value)) return;
        var x = chart.scales.x.getPixelForValue(opts.value), area = chart.chartArea, ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = opts.color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
        ctx.restore();
      }
    });
    root.Chart.register({
      id: 'opmValueLabels',
      beforeDatasetsDraw: function (chart) { chart._opmDrawnLabels = []; },
      afterDatasetsDraw: function (chart, args, opts) {
        if (!opts || !(opts.format || opts.mode === 'barEnd')) return;
        var ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = opts.color; ctx.font = '11px ' + opts.font; ctx.textBaseline = 'middle';
        chart.data.datasets.forEach(function (ds, i) {
          if (!chart.isDatasetVisible(i)) return;
          var meta = chart.getDatasetMeta(i);
          if (opts.mode === 'barEnd') {
            meta.data.forEach(function (el, j) {
              // a dataset may carry its own label per bar (ds._labels), even for an empty bar; datasets
              // without it are labeled with their formatted value. (Kept on the dataset, not in plugin
              // options, because Chart.js resolves functions in options as scriptable.)
              var t = ds._labels ? ds._labels[j] : (ds.data[j] == null || !opts.format ? null : opts.format(ds.data[j]));
              if (t == null || t === '') return;
              var x = ds.data[j] == null ? chart.scales.x.getPixelForValue(0) : el.x;
              ctx.textAlign = 'left';
              ctx.fillText(t, x + 4, el.y);
              if (!chart._opmDrawnLabels) chart._opmDrawnLabels = [];
              chart._opmDrawnLabels.push(t);
            });
          } else if (opts.mode === 'last') {
            for (var j = ds.data.length - 1; j >= 0; j--) {
              if (ds.data[j] == null) continue;
              var el = meta.data[j];
              ctx.textAlign = 'right';
              ctx.fillText(opts.format(ds.data[j]), el.x - 4, el.y - 9);
              break;
            }
          }
        });
        ctx.restore();
      }
    });
  }

  function baseOptions(format) {
    var font = token('--font-sans');
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      font: { family: font },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: token('--color-tooltip-bg'), titleFont: { family: font }, bodyFont: { family: font },
          filter: function (item) { return item.raw !== null && item.raw !== undefined; }, // a gap is never shown as a value
          callbacks: {
            label: function (c) { return c.dataset.label + ': ' + (c.raw === null ? '' : format(c.raw)); },
            // the swatch is the series color (never a white point fill)
            labelColor: function (c) { var col = c.dataset._color || (typeof c.dataset.borderColor === 'string' ? c.dataset.borderColor : null) || '#000'; return { borderColor: col, backgroundColor: col }; }
          }
        }
      },
      scales: {
        x: { grid: { display: false, drawTicks: false }, ticks: { color: token('--color-muted'), font: { size: 11, family: font }, maxRotation: 0, autoSkip: true, padding: 6 } },
        y: { grid: { color: token('--color-grid') }, ticks: { color: token('--color-muted'), font: { size: 11, family: font }, callback: function (v) { return format(v); } } }
      }
    };
  }

  /* opts: { id, title, copy (OPM.copy accessor), type ('line'|'bar'|null for a custom body),
             options (Chart.js options, merged over the base), format, plotClass, legend (default true),
             exportExtra: function () -> extra spec fields, exportSvg: function () -> svg string,
             tools: true to show a controls row between the title and the legend (frame.tools) } */
  function create(container, opts) {
    registerPlugins();
    var headId = root.OPM.dom.id('chart');
    var exportBtn = h('button', { type: 'button', class: 'opm-mini-btn', text: opts.copy.t('shell:chart.exportSvg') });
    var legend = h('div', { class: 'opm-key', role: 'group', 'aria-label': opts.copy.t('shell:chart.legendLabel'), hidden: opts.legend === false });
    var tools = h('div', { class: 'opm-chart__tools', hidden: !opts.tools });
    var plot = h('div', { class: opts.plotClass || 'opm-chart__plot' });
    var notes = h('div', { class: 'opm-chart__notes' });
    // opts.sub: a second chart inside an existing panel (container), headed by an h3
    var panel = h(opts.sub ? 'div' : 'section', { class: opts.sub ? 'opm-chart opm-chart--sub' : 'opm-panel opm-chart', 'aria-labelledby': headId, 'data-chart': opts.id }, [
      h('div', { class: 'opm-panel__head' + (opts.sub ? ' opm-panel__head--sub' : '') }, [h(opts.sub ? 'h3' : 'h2', { id: headId, text: opts.title }), exportBtn]),
      tools, legend, plot, notes
    ]);
    container.appendChild(panel);
    var frame = { el: panel, tools: tools, plot: plot, notes: notes, chart: null, fileSuffix: '' };

    if (opts.type) {
      var canvas = h('canvas', { role: 'img', 'aria-labelledby': headId });
      plot.appendChild(canvas);
      var o = baseOptions(opts.format);
      Object.keys(opts.options || {}).forEach(function (k) {
        if (k === 'scales' || k === 'plugins') Object.keys(opts.options[k]).forEach(function (s) {
          var baseS = o[k][s] || {}, over = opts.options[k][s], merged = Object.assign({}, baseS, over);
          // one level deeper for an axis's ticks and grid, so an override keeps the token font and colors
          ['ticks', 'grid', 'callbacks'].forEach(function (sub) { if (baseS[sub] && over[sub]) merged[sub] = Object.assign({}, baseS[sub], over[sub]); }); // a tooltip title added keeps the label and swatch callbacks
          o[k][s] = merged;
        });
        else o[k] = opts.options[k];
      });
      frame.chart = new root.Chart(canvas, { type: opts.type, data: { labels: [], datasets: [] }, options: o });
      // Canvas text does not re-render when a web font arrives; redraw once fonts are ready.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { frame.chart.update(); });
    }

    function drawLegend(items) {
      legend.textContent = '';
      items.forEach(function (it, i) {
        var b = h('button', { type: 'button', class: 'opm-key__item', 'aria-pressed': 'true' }, [
          h('span', { class: 'opm-key__swatch', style: 'background:' + it.color, 'aria-hidden': 'true' }), it.label
        ]);
        b.addEventListener('click', function () {
          var vis = !frame.chart.isDatasetVisible(i);
          frame.chart.setDatasetVisibility(i, vis);
          b.setAttribute('aria-pressed', vis ? 'true' : 'false');
          frame.chart.update();
        });
        legend.appendChild(b);
      });
    }

    /* data: { labels, datasets (Chart.js datasets; _color names the legend swatch), fileSuffix } */
    frame.setData = function (data) {
      frame.chart.data.labels = data.labels;
      frame.chart.data.datasets = data.datasets;
      frame.chart.update();
      if (opts.legend !== false) drawLegend(data.datasets.map(function (d) { return { label: d.label, color: d._color || d.borderColor }; }));
      frame.fileSuffix = data.fileSuffix || '';
    };
    /* notes: [{ text, href }] drawn under the plot, in order */
    frame.setNotes = function (list) {
      notes.textContent = '';
      list.forEach(function (n) {
        var p = h('p', { class: 'opm-chart__note' + (n.flag ? ' opm-chart__note--' + n.flag : '') });
        if (n.href) p.appendChild(h('a', { href: n.href, text: n.text })); else p.textContent = n.text;
        notes.appendChild(p);
      });
    };
    frame.svg = function () {
      if (opts.exportSvg) return opts.exportSvg();
      var ex = root.OPM.svgExport;
      var extra = Object.assign({
        title: opts.title, font: token('--font-sans'),
        colors: { ink: token('--color-ink'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg') }
      }, opts.exportExtra ? opts.exportExtra() : {});
      return ex.buildSvg(ex.fromChart(frame.chart, extra));
    };
    frame.fileName = function () { return 'opm-' + opts.id + (frame.fileSuffix ? '-' + frame.fileSuffix : '') + '.svg'; };
    exportBtn.addEventListener('click', function () { root.OPM.svgExport.download(frame.svg(), frame.fileName()); });
    return frame;
  }

  root.OPM = root.OPM || {};
  root.OPM.chartFrame = { create: create, token: token, hatch: hatch, baseOptions: baseOptions };
})(typeof self !== 'undefined' ? self : this);
