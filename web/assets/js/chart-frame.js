/* Chart frame for Chart.js 4: a panel with a title, an HTML legend that toggles series,
   the canvas, a message slot, a FIXTURE badge when fed invented data, and SVG export.
   Colors come from the CSS tokens (--chart-N etc.), read at draw time. */
(function (root) {
  'use strict';
  var h = function () { return root.OPM.dom.h.apply(null, arguments); };

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* opts: { id, title, copy: copy.chart, series: [{ id, label, color: '--chart-2' }],
             format: function(v) -> tick string, kind: 'line' | 'bar' } */
  function createChartFrame(container, opts) {
    var headId = root.OPM.dom.id('chart');
    var exportBtn = h('button', { type: 'button', class: 'opm-mini-btn', text: opts.copy.exportSvg });
    var legend = h('div', { class: 'opm-key', role: 'group', 'aria-label': opts.copy.legendLabel });
    var badge = h('p', { class: 'opm-note opm-note--fixture', hidden: true, text: opts.copy.fixtureBadge });
    var message = h('p', { class: 'opm-chart__msg', role: 'status' });
    var canvas = h('canvas', { role: 'img', 'aria-labelledby': headId });
    var box = h('div', { class: 'opm-chart__plot' }, [canvas]);
    var panel = h('section', { class: 'opm-panel opm-chart', 'aria-labelledby': headId }, [
      h('div', { class: 'opm-panel__head' }, [h('h2', { id: headId, text: opts.title }), exportBtn]),
      badge, legend, box, message
    ]);
    container.appendChild(panel);

    var fontFamily = token('--font-sans');
    var provisional = [];
    var chart = new root.Chart(canvas, {
      type: opts.kind || 'line',
      data: {
        labels: [],
        datasets: opts.series.map(function (s) {
          var col = token(s.color);
          return {
            label: s.label, _id: s.id, data: [], borderColor: col, backgroundColor: col,
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: false,
            segment: {
              borderDash: function (ctx) { return provisional[ctx.p1DataIndex] ? [5, 4] : undefined; }
            }
          };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        font: { family: fontFamily },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: token('--color-tooltip-bg'), titleFont: { family: fontFamily }, bodyFont: { family: fontFamily },
            callbacks: {
              label: function (c) { return c.dataset.label + ': ' + (c.raw === null ? '' : opts.format(c.raw)); }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawTicks: false },
            ticks: { color: token('--color-muted'), font: { size: 11, family: fontFamily }, maxRotation: 0, autoSkip: true, padding: 6 }
          },
          y: {
            beginAtZero: true, grid: { color: token('--color-grid') },
            ticks: { color: token('--color-muted'), font: { size: 11, family: fontFamily }, callback: function (v) { return opts.format(v); } }
          }
        }
      }
    });

    // Canvas text does not re-render when a web font arrives; redraw once fonts are ready.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { chart.update(); });

    var legendButtons = opts.series.map(function (s, i) {
      var b = h('button', { type: 'button', class: 'opm-key__item', 'aria-pressed': 'true' }, [
        h('span', { class: 'opm-key__swatch', style: 'background:' + token(s.color), 'aria-hidden': 'true' }), s.label
      ]);
      b.addEventListener('click', function () {
        var vis = !chart.isDatasetVisible(i);
        chart.setDatasetVisibility(i, vis);
        b.setAttribute('aria-pressed', vis ? 'true' : 'false');
        chart.update();
      });
      legend.appendChild(b);
      return b;
    });

    var state = { fixture: false, grainName: '' };

    /* data: { labels: [], values: { seriesId: [number|null] }, provisional: [bool], fixture: bool,
               grainName: string used in the export file name, message: string or '' } */
    function update(data) {
      provisional = data.provisional || [];
      chart.data.labels = data.labels;
      chart.data.datasets.forEach(function (ds) { ds.data = data.values[ds._id] || []; });
      chart.update();
      state.fixture = !!data.fixture; state.grainName = data.grainName || '';
      badge.hidden = !state.fixture;
      message.textContent = data.message || '';
      message.hidden = !data.message;
    }

    exportBtn.addEventListener('click', function () {
      var ex = root.OPM.svgExport;
      var svg = ex.buildSvg(ex.fromChart(chart, {
        title: opts.title,
        note: state.fixture ? opts.copy.fixtureBadge : '',
        font: fontFamily,
        colors: { ink: token('--color-ink'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg') }
      }));
      ex.download(svg, 'opm-' + opts.id + (state.grainName ? '-' + state.grainName : '') + (state.fixture ? '-FIXTURE' : '') + '.svg');
    });

    return { chart: chart, el: panel, update: update, legendButtons: legendButtons };
  }

  root.OPM = root.OPM || {};
  root.OPM.chartFrame = { create: createChartFrame, token: token };
})(typeof self !== 'undefined' ? self : this);
