/* Who is leaving page (docs/pages/who-is-leaving.md; container D-042, contents and copy D-044,
   occupation order D-043). Reads data/doj_core.json and its meta (tiles), data/doj_leaving.meta.json,
   and one per-entity file, data/doj_leaving/<entity>.json, located through the meta's files map; only
   the selected component's file is loaded. Views: fiscal year or trailing 12 months only (D-031).
   Job series filter (docs/pages/job-series-filter.md, D-061 to D-063): with a series, the component's doj_leaving_series
   file (fiscal years only, so the View is Yearly) and its doj_core_series file (years lost) are read and that group's
   rows picked; the occupation panel is hidden. "All job series" reads doj_leaving and doj_core as before. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var LEAVING_META = 'data/doj_leaving.meta.json';
  var NUM = new Intl.NumberFormat('en-US');
  var GROUP_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8', '--chart-9', '--chart-10'];

  function rateText(v) { return (v * 100).toFixed(1) + '%'; }
  /* Coverage below 100% is never shown as "100.0%": truncated to one decimal. */
  function coverageText(v) { return (Math.floor(v * 1000) / 10).toFixed(1) + '%'; }

  K.load('Who is leaving', build, ['data/doj_core.json', 'data/doj_core.meta.json', LEAVING_META]);

  function build(copy, cube, coreMeta, extras) {
    var h = OPM.dom.h, D = OPM.data, LV = OPM.leaving, token = OPM.chartFrame.token;
    var lmeta = extras[0];
    var coreRows = D.fromCube(cube);
    var L = K.labels(copy), label = L.label;
    var none = copy.t('shell:num.none');
    var files = {}; // entity -> rows, loaded on demand

    function entityUrl(entity) {
      var f = lmeta.files && lmeta.files[entity];
      if (!f || !f.path) throw new Error('doj_leaving.meta.json lists no file for ' + entity);
      return 'data/' + f.path;
    }
    function loadEntity(entity) {
      if (files[entity]) return Promise.resolve(files[entity]);
      var url;
      try { url = entityUrl(entity); } catch (e) { return Promise.reject(e); }
      return K.getJson(url).then(function (file) {
        if (file.entity !== entity) throw new Error(url + ' holds entity ' + file.entity);
        files[entity] = D.fromCube(file);
        return files[entity];
      });
    }

    var state = { entity: 'DOJ', grain: 't12', period: null };
    var rows = [];
    var SR = OPM.series, SD = OPM.seriesData.create({ doj_core_series: 'data/doj_core_series.meta.json', doj_leaving_series: 'data/doj_leaving_series.meta.json' });
    var core = { rows: coreRows, meta: coreMeta }; // the years-lost source in view
    state.series = SR.ALL;
    var body = document.getElementById('page-body');

    function groupName(dim, value) { var g = LV.groupLabel(dim, value); return copy.t(g.ref, g.vars); } // copy-audit: page:group.los.lt1 page:group.los.1_4 page:group.los.5_9 page:group.los.10_19 page:group.los.20_24 page:group.los.25_29 page:group.los.30plus page:group.age.under25 page:group.age.65plus page:group.age.range page:group.sup.supervisor page:group.sup.other page:group.occ.0905 page:group.occ.1811 page:group.occ.0007 page:group.occ.other
    var panelTitle = { los: copy.t('page:panel.los.title'), age: copy.t('page:panel.age.title'), sup: copy.t('page:panel.sup.title'), occ: copy.t('page:panel.occ.title') };
    var dimText = { los: copy.t('page:dim.los'), age: copy.t('page:dim.age'), sup: copy.t('page:dim.sup') };
    function periodLabel(grain, period, partial) {
      if (grain === 't12') return copy.t('page:ctl.period.t12', { month: label(period) });
      return partial ? copy.t('shell:flag.partial.label', { period: label(period) }) : label(period);
    }

    /* controls: component (shared), View (Yearly, Last 12 months), Period */
    var bar = OPM.componentBar.render(body, copy, lmeta, state, L, { entity: function (v) { state.entity = v; switchEntity(); } });
    var seriesCtl = OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: SR.ALL, onChange: function (v) { state.series = v; switchEntity(); } }));
    var grainCtl = OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), t12: copy.t('page:ctl.view.t12') }, note: copy.t('shell:ctl.grain.note') }, // D-033: the note is part of the control
      values: ['fy', 't12'], value: state.grain,
      onChange: function (g) { state.grain = g; state.period = null; fillPeriods(); drawAll(); }
    });
    var ytdNote = h('p', { class: 'opm-field__note opm-field__note--wide opm-series-ytd', hidden: true, text: copy.t('shell:series.ytdOnly') });
    grainCtl.el.appendChild(ytdNote);
    var seriesNote = h('p', { class: 'opm-series-none', role: 'status', hidden: true });
    var periodId = OPM.dom.id('period');
    var periodSel = h('select', { id: periodId });
    bar.appendChild(h('div', { class: 'opm-field opm-field--period' }, [h('label', { for: periodId, class: 'opm-field__name', text: copy.t('page:ctl.period') }), periodSel]));
    periodSel.addEventListener('change', function () { state.period = periodSel.value; drawAll(); });

    function fillPeriods() {
      var list = LV.periodsOf(rows, state.grain);
      var partial = {};
      rows.forEach(function (r) { if (r.grain === state.grain && r.partial) partial[r.period] = true; });
      periodSel.textContent = '';
      list.forEach(function (p) { periodSel.appendChild(h('option', { value: p, text: periodLabel(state.grain, p, partial[p]) })); });
      if (!state.period || list.indexOf(state.period) < 0) state.period = list[list.length - 1];
      periodSel.value = state.period;
    }

    /* panel 1: tiles */
    body.appendChild(seriesNote);
    var tiles = h('section', { class: 'opm-tiles', 'aria-label': copy.t('page:page.title') });
    body.appendChild(tiles);
    var tDeps = h('div', { class: 'opm-tile opm-tile--departures' }), tLost = h('div', { class: 'opm-tile opm-tile--years-lost' }), tAvg = h('div', { class: 'opm-tile opm-tile--avg-years' });
    [tDeps, tLost, tAvg].forEach(function (t) { tiles.appendChild(t); });
    var tilesNotes = h('div', { class: 'opm-chart__notes opm-tiles__notes' });
    body.appendChild(tilesNotes);

    function drawTiles(snap) {
      var deps = LV.departures(rows, state.grain, state.period);
      var prior = LV.departures(rows, state.grain, LV.priorPeriod(state.grain, state.period));
      var y = LV.yearsLost(core.rows, state.entity, state.grain, state.period, core.meta);
      var badges = function () { return snap.provisional ? [K.provisionalBadge(copy)] : []; };
      K.fillTile(tDeps, { name: copy.t('page:tile.departures'), badges: badges(), value: deps === null ? none : NUM.format(deps),
        subs: [copy.t('page:tile.prior', { value: prior === null ? none : NUM.format(prior) })] });
      K.fillTile(tLost, { name: copy.t('page:tile.yearsLost'), badges: badges(), value: y && y.lost !== null ? NUM.format(Math.round(y.lost)) : none,
        subs: [y && y.coverage !== null && y.coverage < 1 ? copy.t('page:tile.coverage', { pct: coverageText(y.coverage) }) : ''] });
      // coverage is stated on the years-lost tile and under the length-of-service panel, not here (Cary, L-055)
      K.fillTile(tAvg, { name: copy.t('page:tile.avgYears'), badges: badges(), value: y && y.average !== null ? y.average.toFixed(1) : none });
      tilesNotes.textContent = '';
      if (snap.provisional) tilesNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--provisional', text: copy.t('shell:flag.provisional') }));
      if (state.grain === 'fy' && snap.partial) tilesNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--ytd', text: copy.t('shell:flag.ytd', { period: label(state.period) }) }));
      return { departures: deps, prior: prior, years: y };
    }

    /* panels 2 to 5: snapshot and trend per dimension */
    var panels = LV.DIMS.map(function (dim) {
      var labelsNow = [];
      var snapFrame = OPM.chartFrame.create(body, {
        id: 'leaving-' + dim.key, title: panelTitle[dim.key], copy: copy, type: 'bar', format: rateText,
        plotClass: 'opm-chart__plot opm-chart__plot--snapshot',
        options: {
          indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 128 } },
          scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return rateText(v); } } },
            // the category axis names the groups (the base formatter is for values)
            y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
          plugins: { opmValueLabels: { mode: 'barEnd', color: token('--color-ink'), font: token('--font-sans') } }
        },
        exportExtra: function () {
          var m0 = snapFrame.chart.getDatasetMeta(0), xs = snapFrame.chart.scales.x, d0 = snapFrame.chart.data.datasets[0].data;
          return { labels: m0.data.map(function (el, j) { return labelsNow[j] ? { x: (d0[j] == null ? xs.getPixelForValue(0) : el.x) + 4, y: el.y + 4, text: labelsNow[j] } : null; }).filter(Boolean) };
        }
      });
      var ruleFlags = [];
      var trendFrame = OPM.chartFrame.create(snapFrame.el, {
        id: 'leaving-' + dim.key + '-trend', title: copy.t('page:chart.trend.title'), copy: copy, type: 'line', format: rateText, sub: true,
        options: { scales: { y: { beginAtZero: true } }, plugins: { opmMarkers: { flags: [], glyph: '', color: token('--color-ink'), font: token('--font-sans'), width: 1.5, dash: [] } } },
        exportExtra: function () {
          var xs = trendFrame.chart.scales.x;
          return { markers: ruleFlags.map(function (on, i) { return on ? { x: xs.getPixelForValue(i), kind: 'rule' } : null; }).filter(Boolean) };
        }
      });
      return {
        dim: dim, snap: snapFrame, trend: trendFrame,
        setLabels: function (l) { labelsNow = l; }, labels: function () { return labelsNow.slice(); }, setRule: function (f) { ruleFlags = f; trendFrame.chart.options.plugins.opmMarkers.flags = f; }
      };
    });

    function drawPanel(p) {
      var dim = p.dim, snap = LV.snapshot(rows, state.grain, state.period, dim.id);
      var c = token('--chart-2'), cPrior = token('--color-line-strong');
      var now = snap.groups.map(function (g) { return g.na ? null : g.rate; });
      var before = snap.groups.map(function (g) { return g.prior && !g.prior.na ? g.prior.rate : null; });
      p.setLabels(snap.groups.map(function (g) {
        if (g.na) return copy.t('page:notApplicable');
        return g.rate === null ? '' : copy.t('page:bar.label', { rate: rateText(g.rate), count: NUM.format(g.departures) });
      }));
      p.snap.plot.style.height = (snap.groups.length * 40 + 40) + 'px';
      p.snap.setData({
        labels: snap.groups.map(function (g) { return groupName(dim.id, g.value); }),
        datasets: [
          { type: 'bar', label: periodLabel(state.grain, state.period, snap.partial), data: now, _color: c, borderColor: c, barThickness: 14, _labels: p.labels(),
            _faded: snap.groups.map(function (g) { return g.smallBase; }),
            backgroundColor: snap.groups.map(function (g) { return g.smallBase ? OPM.chartFrame.hatch(c) : c; }), borderWidth: snap.groups.map(function (g) { return g.smallBase ? 1 : 0; }) },
          { type: 'bar', label: copy.t('page:bar.prior'), data: before, _color: cPrior, borderColor: cPrior, barThickness: 8, _labels: before.map(function () { return null; }),
            _faded: snap.groups.map(function (g) { return !!(g.prior && g.prior.smallBase); }),
            backgroundColor: snap.groups.map(function (g) { return g.prior && g.prior.smallBase ? OPM.chartFrame.hatch(cPrior) : cPrior; }), borderWidth: 0 }
        ],
        fileSuffix: state.entity + '-' + state.grain + '-' + state.period
      });
      var notes = [{ text: copy.t('page:chart.snapshot.note') }];
      if (dim.unknownLine === 'always' || (dim.unknownLine === 'nonzero' && snap.unknown)) {
        notes.push({ text: copy.t('page:unknown.line', { count: snap.unknown === null ? none : NUM.format(snap.unknown), dimension: dimText[dim.key] }), flag: 'unknown' });
      }
      if (dim.id === 'los' && snap.coverage !== null && snap.coverage < 1) notes.push({ text: copy.t('page:tile.coverage', { pct: coverageText(snap.coverage) }), flag: 'coverage' });
      if (snap.groups.some(function (g) { return g.smallBase || (g.prior && g.prior.smallBase); })) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      p.snap.setNotes(notes);

      var t = LV.trend(rows, state.grain, dim.id);
      var dashIn = t.flags.map(function (f) { return f.provisional; });
      var anySmall = false;
      p.setRule(t.periods.map(function (per) { return per === state.period; }));
      p.trend.setData({
        labels: t.periods.map(function (per, i) { return state.grain === 't12' ? label(per) : periodLabel('fy', per, t.flags[i].partial); }),
        datasets: t.series.map(function (s, i) {
          anySmall = anySmall || s.smallBase.some(Boolean);
          var ds = K.lineDataset(s.rates, GROUP_COLORS[i % GROUP_COLORS.length], groupName(dim.id, s.value), dashIn,
            t.flags.map(function (f, j) { return s.smallBase[j] ? 'smallBase' : f.partial ? 'partial' : f.provisional ? 'provisional' : null; }));
          ds.borderWidth = 1.75;
          return ds;
        }),
        fileSuffix: state.entity + '-' + state.grain
      });
      var tnotes = [];
      if (t.flags.some(function (f) { return f.provisional; })) tnotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      if (state.grain === 'fy') t.periods.forEach(function (per, i) { if (t.flags[i].partial) tnotes.push({ text: copy.t('shell:flag.ytd', { period: label(per) }), flag: 'ytd' }); });
      if (anySmall) tnotes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      p.trend.setNotes(tnotes);
      return snap;
    }

    var last = {};
    function drawAll() {
      var bySeries = state.series !== SR.ALL;
      var empty = bySeries && !rows.length; // no one in this job series at this component
      seriesNote.hidden = !empty;
      tiles.hidden = empty; tilesNotes.hidden = empty;
      panels.forEach(function (p) { p.snap.el.hidden = empty || (bySeries && p.dim.id === 'occupation'); }); // occupation: hidden with a series
      if (empty) { last.snaps = []; last.tiles = null; OPM.shell.refreshDraft(); return; }
      var snaps = panels.filter(function (p) { return !p.snap.el.hidden; }).map(drawPanel);
      last.tiles = drawTiles(snaps[0]);
      last.snaps = snaps;
      OPM.shell.refreshDraft();
    }

    /* the rows for the chosen component and series: doj_leaving and doj_core for all job series; otherwise that
       component's doj_leaving_series and doj_core_series files, fiscal years only (D-062, addendum) */
    var ticket = 0;
    function switchEntity() {
      var t = ++ticket, wanted = state.entity, g = state.series;
      var bySeries = g !== SR.ALL;
      grainCtl.disable('t12', bySeries);
      ytdNote.hidden = !bySeries;
      if (bySeries && state.grain !== 'fy') { state.grain = 'fy'; state.period = null; grainCtl.set('fy'); }
      var p = bySeries
        ? Promise.all([SD.group('doj_leaving_series', [wanted], g), SD.group('doj_core_series', [wanted], g)]).then(function (d) { return { rows: d[0].rows, core: { rows: d[1].rows, meta: d[1].meta } }; })
        : loadEntity(wanted).then(function (r) { return { rows: r, core: { rows: coreRows, meta: coreMeta } }; });
      p.then(function (d) {
        if (t !== ticket) return;
        rows = d.rows; core = d.core;
        seriesNote.textContent = copy.t('shell:series.none');
        if (rows.length) fillPeriods();
        drawAll(); OPM.page.shown = wanted + ':' + g;
      }, function (e) {
        if (t !== ticket) return;
        console.info('Who is leaving: data not available (' + e.message + ')');
        if (g !== SR.ALL) { // back to all job series (never series labels on all-series figures)
          state.series = SR.ALL; seriesCtl.set(SR.ALL);
          switchEntity();
          setTimeout(function () { seriesNote.textContent = copy.t('shell:data.unavailable'); seriesNote.hidden = false; }, 0);
        }
      });
    }

    OPM.page = { state: state, frames: {}, panels: panels, last: last, loadEntity: loadEntity, data: function () { return { rows: rows, core: core }; } };
    panels.forEach(function (p) { OPM.page.frames[p.dim.key] = p.snap; OPM.page.frames[p.dim.key + 'Trend'] = p.trend; });
    loadEntity('DOJ').then(function (r) { rows = r; fillPeriods(); drawAll(); OPM.page.shown = 'DOJ:' + SR.ALL; OPM.page.ready = true; },
      function (e) { K.unavailable(copy, 'Who is leaving', e); });
  }
})(typeof self !== 'undefined' ? self : this);
