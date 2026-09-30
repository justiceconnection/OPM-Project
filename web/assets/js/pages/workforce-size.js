/* Workforce size page (docs/pages/workforce-size.md; container D-029, contents and copy D-030).
   Reads data/doj_core.json and data/doj_core.meta.json. The browser picks rows, sums columns
   and divides; tiles sum headcount_change (OPM.workforce), never subtracting rows.
   Panels: 1 tiles, 2 headcount over time, 3 headcount change vs net flow, 4 by component. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  var CUBE_URL = 'data/doj_core.json', META_URL = 'data/doj_core.meta.json';
  var BREAK_HREF = 'reading-the-data.html';

  var NUM = new Intl.NumberFormat('en-US');
  function fmtInt(v) { return NUM.format(v); }
  function fmtSigned(v) { return (v > 0 ? '+' : '') + NUM.format(v); }
  function fmtPct(v) { return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

  function getJson(url) {
    return fetch(OPM.shell.asset(url)).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  OPM.shell.ready.then(function (ctx) {
    return Promise.all([getJson(CUBE_URL), getJson(META_URL)]).then(function (res) {
      build(ctx.copy, res[0], res[1]);
    }, function (err) {
      console.info('Workforce size: data not available (' + err.message + ')');
      unavailable(ctx.copy);
    });
  }).catch(function (e) { console.error(e); });

  function unavailable(copy) {
    var body = document.getElementById('page-body');
    body.appendChild(OPM.dom.h('p', { class: 'opm-unavailable', role: 'status', text: copy.t('shell:data.unavailable') }));
    OPM.shell.refreshDraft();
    OPM.page = { unavailable: true };
  }

  function build(copy, cube, meta) {
    var h = OPM.dom.h, P = OPM.periods, D = OPM.data, W = OPM.workforce, token = OPM.chartFrame.token;
    var rows = D.fromCube(cube);
    var problems = D.validateRows(rows);
    if (problems.length) console.warn('doj_core rows disagree with their period keys', problems.slice(0, 5));

    var fmt = {
      months: copy.raw('shell:period.months'), month: copy.raw('shell:period.month'),
      fiscalQuarter: copy.raw('shell:period.quarter'), fiscalYear: copy.raw('shell:period.fy')
    };
    function label(period) { return P.periodLabel(period, fmt); }
    function periodText(row) { return row.partial ? copy.t('shell:flag.partial.label', { period: label(row.period) }) : label(row.period); }
    // copy-audit: components:*
    function name(entity) { return entity === 'DOJ' ? copy.t('page:ctl.component.all') : copy.t('components:' + entity); }
    var none = copy.t('shell:num.none');
    function wrapLabel(text, max) {
      if (text.length <= max) return text;
      var lines = [''];
      text.split(' ').forEach(function (w) {
        var cur = lines[lines.length - 1];
        if (cur && (cur + ' ' + w).length > max) lines.push(w); else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
      });
      return lines;
    }

    var bounds = { start: meta.range.first_month, end: meta.range.last_month };
    var state = { entity: 'DOJ', grain: OPM.controls.grain.DEFAULT, range: OPM.controls.range.defaultRange(bounds) };

    OPM.shell.setSource(copy.t('page:source', { latest: label(meta.range.last_month) }));
    var body = document.getElementById('page-body');

    /* controls */
    var bar = h('div', { class: 'opm-settings', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    OPM.controls.component.render(bar, {
      label: copy.t('page:ctl.component'), value: state.entity,
      options: W.componentOptions({
        entities: meta.entities, names: meta.entities.reduce(function (o, e) { if (e !== 'DOJ') o[e] = copy.t('components:' + e); return o; }, {}),
        entityLastMonth: meta.entity_last_month, latest: meta.range.last_month, allLabel: copy.t('page:ctl.component.all'),
        endedLabel: function (n, m) { return copy.t('shell:ctl.component.ended', { name: n, month: label(m) }); }
      }),
      onChange: function (v) { state.entity = v; drawEntity(); }
    });
    OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: function (g) { state.grain = g; drawAll(); }
    });
    // Preset strings are read (and so count toward the draft badge) only when there are presets to show.
    // copy-audit: if-nonempty shell:ctl.range.presets then shell:ctl.range.presetsLabel shell:ctl.range.presets
    var hasPresets = (copy.peek('shell:ctl.range.presets') || []).length > 0;
    OPM.controls.range.render(bar, {
      copy: { from: copy.t('shell:ctl.range.from'), to: copy.t('shell:ctl.range.to'),
        presetsLabel: hasPresets ? copy.t('shell:ctl.range.presetsLabel') : '', presets: hasPresets ? copy.raw('shell:ctl.range.presets') : [] },
      fmt: fmt, bounds: bounds, value: state.range, onChange: function (r) { state.range = r; drawAll(); }
    });

    /* panel 1: tiles */
    var tiles = h('section', { class: 'opm-tiles', 'aria-label': copy.t('page:page.title') });
    body.appendChild(tiles);
    function tile(cls) {
      var el = h('div', { class: 'opm-tile ' + cls });
      tiles.appendChild(el);
      return el;
    }
    var tHead = tile('opm-tile--headcount'), t12 = tile('opm-tile--change12'), tRange = tile('opm-tile--range');
    var tilesNote = h('p', { class: 'opm-chart__note opm-chart__note--provisional', hidden: true });
    body.appendChild(tilesNote);

    function fillTile(el, parts) {
      el.textContent = '';
      el.appendChild(h('p', { class: 'opm-tile__name' }, [parts.name, parts.badge || null]));
      el.appendChild(h('p', { class: 'opm-tile__value', text: parts.value }));
      (parts.subs || []).forEach(function (s) { if (s) el.appendChild(h('p', { class: 'opm-tile__sub', text: s })); });
    }

    function drawTiles() {
      var latest = W.latestMonthRow(rows, state.entity);
      var prov = copy.t('page:flag.provisional');
      fillTile(tHead, {
        name: copy.t('page:tile.headcount'),
        badge: latest && latest.provisional ? h('span', { class: 'opm-tile__prov', role: 'img', 'aria-label': prov, title: prov }) : null,
        value: latest ? fmtInt(latest.headcount) : none,
        subs: [latest ? copy.t('page:tile.headcount.asof', { month: label(latest.period) }) : '']
      });
      tilesNote.hidden = !(latest && latest.provisional);
      tilesNote.textContent = prov;

      var c12 = W.change12(rows, state.entity, meta);
      fillTile(t12, {
        name: copy.t('page:tile.change12'),
        value: c12 && c12.sum !== null ? fmtSigned(c12.sum) : none,
        subs: [c12 && c12.pct !== null ? fmtPct(c12.pct) : '']
      });

      var cr = W.changeRange(rows, state.entity, state.grain, state.range, meta);
      fillTile(tRange, {
        name: cr ? copy.t('page:tile.changeRange', { start: periodText(cr.first), end: periodText(cr.last) }) : copy.t('page:tile.changeRange', { start: none, end: none }),
        value: cr && cr.sum !== null ? fmtSigned(cr.sum) : none,
        subs: cr ? [cr.pct !== null ? fmtPct(cr.pct) : '', cr.from ? copy.t('page:tile.changeRange.firstNote', { period: label(cr.from.period) }) : ''] : []
      });
    }

    function flagNotes(picked) {
      var out = [];
      if (picked.some(function (r) { return r.provisional; })) out.push({ text: copy.t('page:flag.provisional'), flag: 'provisional' });
      picked.filter(function (r) { return r.partial; }).forEach(function (r) {
        out.push({ text: copy.t('page:flag.partial', { period: label(r.period), month: label(r.period_last_month) }), flag: 'partial' });
      });
      return out;
    }

    function lineDataset(picked, col, color, seriesLabel) {
      var c = token(color), bg = token('--color-panel');
      var dashIn = picked.map(function (r) { return r.provisional === true; });
      var markers = picked.map(function (r) { return r.partial ? 'partial' : r.provisional ? 'provisional' : null; });
      return {
        label: seriesLabel, data: picked.map(function (r) { return D.value(r, col); }), _color: c, _dashIn: dashIn, _markers: markers,
        borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0.15, spanGaps: false,
        pointStyle: markers.map(function (m) { return m === 'partial' ? 'rectRot' : 'circle'; }),
        pointRadius: markers.map(function (m) { return m === 'partial' ? 5 : m === 'provisional' ? 3 : 0; }),
        pointBackgroundColor: markers.map(function (m) { return m ? bg : c; }), pointBorderColor: c, pointBorderWidth: 1.5,
        pointHoverRadius: 4,
        segment: { borderDash: function (ctx) { return dashIn[ctx.p1DataIndex] ? [5, 4] : undefined; } }
      };
    }

    /* panel 2: headcount over time */
    var fHead = OPM.chartFrame.create(body, {
      id: 'headcount', title: copy.t('page:chart.headcount.title'), copy: copy, type: 'line', format: fmtInt, legend: false,
      options: { scales: { y: { beginAtZero: false } } }
    });

    /* panel 3: headcount change vs net flow */
    var flowFlags = [];
    var fFlow = OPM.chartFrame.create(body, {
      id: 'change-vs-net-flow', title: copy.t('page:chart.flow.title'), copy: copy, type: 'bar', format: fmtSigned,
      options: { plugins: { opmMarkers: { flags: [], color: token('--color-ink'), font: token('--font-sans') } } },
      exportExtra: function () {
        var xs = fFlow.chart.scales.x;
        return { markers: flowFlags.map(function (on, i) { return on ? { x: xs.getPixelForValue(i), kind: 'break' } : null; }).filter(Boolean) };
      }
    });

    /* panel 4: headcount by component (DOJ-wide; ignores the component selector) */
    var rank = W.ranking(rows, meta);
    var fRank = OPM.chartFrame.create(body, {
      id: 'components-ranking', title: copy.t('page:chart.components.title'), copy: copy, type: 'bar', format: fmtInt, legend: false,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
        layout: { padding: { right: 44 } },
        scales: {
          x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return fmtInt(v); } } },
          // on a narrow chart a long name wraps onto two lines instead of being clipped
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: function (v, i) { return wrapLabel(this.getLabelForValue(i), this.chart.width < 520 ? 16 : 40); } } }
        },
        plugins: { opmValueLabels: { mode: 'barEnd', format: fmtInt, color: token('--color-ink'), font: token('--font-sans') } }
      },
      exportExtra: function () {
        var meta0 = fRank.chart.getDatasetMeta(0), ds = fRank.chart.data.datasets[0];
        return { labels: meta0.data.map(function (el, j) { return { x: el.x + 4, y: el.y + 4, text: fmtInt(ds.data[j]) }; }) };
      }
    });
    fRank.plot.style.height = (rank.current.length * 30 + 40) + 'px';
    var c1 = token('--chart-1');
    fRank.setData({
      labels: rank.current.map(function (c) { return name(c.entity); }),
      datasets: [{ label: copy.t('page:tile.headcount'), data: rank.current.map(function (c) { return c.headcount; }), backgroundColor: c1, borderColor: c1, _color: c1, barThickness: 16 }],
      fileSuffix: 'latest'
    });
    fRank.setNotes(rank.ended.map(function (c) {
      return { text: copy.t('page:chart.components.ended', { name: name(c.entity), month: label(c.row.period), count: fmtInt(c.headcount) }), flag: 'ended' };
    }).concat(rank.current.some(function (c) { return c.row.provisional; }) ? [{ text: copy.t('page:flag.provisional'), flag: 'provisional' }] : []));

    // 4b: small multiples, one line per component, each with its own y-axis
    var multiEntities = rank.current.map(function (c) { return c.entity; }).concat(rank.ended.map(function (c) { return c.entity; }));
    var multiHead = h('div', { class: 'opm-panel__head opm-panel__head--sub' }, [h('span'), h('button', { type: 'button', class: 'opm-mini-btn', 'data-export': 'components-trend', text: copy.t('shell:chart.exportSvg') })]);
    var grid = h('div', { class: 'opm-multiples' });
    fRank.el.appendChild(multiHead);
    fRank.el.appendChild(grid);
    var minis = multiEntities.map(function (e) {
      var valueEl = h('span', { class: 'opm-multiple__value' });
      var canvas = h('canvas', { role: 'img', 'aria-label': name(e) });
      var cell = h('div', { class: 'opm-multiple', 'data-entity': e }, [
        h('p', { class: 'opm-multiple__head' }, [h('span', { class: 'opm-multiple__name', text: name(e) }), valueEl]),
        h('div', { class: 'opm-multiple__plot' }, [canvas])
      ]);
      grid.appendChild(cell);
      var o = OPM.chartFrame.baseOptions(fmtInt);
      o.scales.y.beginAtZero = false;
      o.scales.y.ticks.maxTicksLimit = 4;
      o.scales.x.ticks.maxTicksLimit = 3;
      o.layout = { padding: { right: 6 } };
      var ch = new root.Chart(canvas, { type: 'line', data: { labels: [], datasets: [] }, options: o });
      return { entity: e, chart: ch, valueEl: valueEl };
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { minis.forEach(function (m) { m.chart.update(); }); });
    multiHead.querySelector('button').addEventListener('click', function () {
      var ex = OPM.svgExport, colors = { ink: token('--color-ink'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg') };
      var svg = ex.buildGridSvg(minis.map(function (m) {
        return ex.fromChart(m.chart, { title: name(m.entity) + '  ' + m.valueEl.textContent, font: token('--font-sans'), colors: colors });
      }), { cols: 3, title: copy.t('page:chart.components.title'), font: token('--font-sans'), bg: colors.bg, ink: colors.ink, muted: colors.muted });
      ex.download(svg, 'opm-components-trend-' + state.grain + '.svg');
    });

    function drawMultiples() {
      minis.forEach(function (m) {
        var picked = D.selectRows(rows, { entity: m.entity, grain: state.grain, range: state.range });
        var ds = lineDataset(picked, 'headcount', '--chart-1', name(m.entity));
        ds.borderWidth = 1.5;
        m.chart.data.labels = picked.map(periodText);
        m.chart.data.datasets = [ds];
        m.chart.update();
        var last = picked[picked.length - 1];
        m.valueEl.textContent = last ? fmtInt(last.headcount) : none;
      });
    }

    function drawEntity() {
      drawTiles();
      var picked = D.selectRows(rows, { entity: state.entity, grain: state.grain, range: state.range });
      var labels = picked.map(periodText);
      var suffix = state.entity + '-' + state.grain;

      fHead.setData({ labels: labels, datasets: [lineDataset(picked, 'headcount', '--chart-1', copy.t('page:tile.headcount'))], fileSuffix: suffix });
      fHead.setNotes(flagNotes(picked));

      flowFlags = W.breakFlags(picked);
      var cA = token('--chart-2'), cB = token('--chart-3');
      var faded = picked.map(function (r) { return r.provisional === true; });
      fFlow.chart.options.plugins.opmMarkers.flags = flowFlags;
      fFlow.setData({
        labels: labels,
        datasets: [
          { label: copy.t('page:chart.flow.series.change'), data: picked.map(function (r) { return D.value(r, 'headcount_change'); }), _color: cA, _faded: faded,
            backgroundColor: faded.map(function (f) { return f ? OPM.chartFrame.hatch(cA) : cA; }), borderColor: cA, borderWidth: faded.map(function (f) { return f ? 1 : 0; }) },
          { label: copy.t('page:chart.flow.series.net'), data: picked.map(function (r) { return D.value(r, 'net_flow'); }), _color: cB, _faded: faded,
            backgroundColor: faded.map(function (f) { return f ? OPM.chartFrame.hatch(cB) : cB; }), borderColor: cB, borderWidth: faded.map(function (f) { return f ? 1 : 0; }) }
        ],
        fileSuffix: suffix
      });
      var notes = [{ text: copy.t('page:chart.flow.note') }];
      if (flowFlags.some(Boolean)) notes.push({ text: copy.t('page:flag.break'), href: BREAK_HREF, flag: 'break' });
      fFlow.setNotes(notes.concat(flagNotes(picked)));
      OPM.shell.refreshDraft();
    }

    function drawAll() { drawEntity(); drawMultiples(); }
    drawAll();
    OPM.page = { state: state, rows: rows, meta: meta, frames: { headcount: fHead, flow: fFlow, ranking: fRank }, minis: minis, drawAll: drawAll, drawEntity: drawEntity };
  }
})(typeof self !== 'undefined' ? self : this);
