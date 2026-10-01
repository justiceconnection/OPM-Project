/* Hiring and departures page (docs/pages/hiring-and-departures.md; container D-037, contents and
   copy D-040). Reads data/doj_core.json and its meta (via OPM.pageKit). The browser picks rows,
   sums flow columns over periods (sumAcrossPeriods) and divides picked numerators by denominators.
   Panels: 1 tiles, 2 hires vs departures, 3 why people left (DRP overlay), 4 rates (method in the
   panel), 5 hires by type.
   Job series filter (docs/pages/job-series-filter.md, D-061 to D-063): "All job series" reads doj_core as before; a
   series reads the selected component's doj_core_series file and picks that group's rows.
   Administrations (docs/pages/administrations.md, D-065 to D-068): presets under the date range, and the Compare
   administrations panel (admin-panel.js) below panel 5. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var fmtInt = K.fmt.int, fmtRate = K.fmt.rate;
  var REASON_COLORS = ['--chart-2', '--chart-3', '--chart-4', '--chart-6', '--chart-5', '--chart-11'];
  var HIRE_COLORS = ['--chart-7', '--chart-9'];
  var RATE_COLORS = { attrition: '--chart-1', quit: '--chart-3', retirement: '--chart-4' };

  K.load('Hiring and departures', build, ['data/doj_core.json', 'data/doj_core.meta.json']);

  function build(copy, cube, meta) {
    var h = OPM.dom.h, D = OPM.data, HD = OPM.hiring;
    var SR = OPM.series, SD = OPM.seriesData.create({ doj_core_series: 'data/doj_core_series.meta.json' });
    var coreRows = D.fromCube(cube), coreMeta = meta;
    var rows = coreRows, curMeta = coreMeta, curSeries = SR.ALL; // the figures in view
    var problems = D.validateRows(coreRows);
    if (problems.length) console.warn('doj_core rows disagree with their period keys', problems.slice(0, 5));
    var L = K.labels(copy), label = L.label, periodText = L.periodText;
    var none = copy.t('shell:num.none');
    function seriesLabel(col) { return copy.t('series:' + col); } // copy-audit: series:sep_transfer_out series:sep_quit series:sep_retirement series:sep_rif series:sep_termination series:sep_other series:acc_new_hire series:acc_transfer_in
    var rateLabel = { attrition: copy.t('page:chart.rates.series.attrition'), quit: copy.t('page:chart.rates.series.quit'), retirement: copy.t('page:chart.rates.series.retirement') };

    var bounds = { start: meta.range.first_month, end: meta.range.last_month };
    var state = { entity: 'DOJ', grain: OPM.controls.grain.DEFAULT, range: OPM.controls.range.defaultRange(bounds), method: OPM.controls.rateMethod.DEFAULT };
    var body = document.getElementById('page-body');
    var bar = OPM.componentBar.render(body, copy, meta, state, L, { entity: function (v) { state.entity = v; loadSeries(); } });
    var seriesCtl = OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: SR.ALL, onChange: function (v) { state.series = v; loadSeries(); } }));
    OPM.pageControls.viewAndRange(bar, copy, meta, state, L, { view: function (g) { state.grain = g; drawAll(); }, range: function (r) { state.range = r; drawAll(); } });

    /* panel 1: tiles */
    var tiles = h('section', { class: 'opm-tiles', 'aria-label': copy.t('page:page.title') });
    body.appendChild(tiles);
    var tHires = h('div', { class: 'opm-tile opm-tile--hires' }), tDeps = h('div', { class: 'opm-tile opm-tile--departures' }), tRate = h('div', { class: 'opm-tile opm-tile--rate' });
    [tHires, tDeps, tRate].forEach(function (t) { tiles.appendChild(t); });
    var tilesNotes = h('div', { class: 'opm-chart__notes opm-tiles__notes' });
    body.appendChild(tilesNotes);

    function prior(v, f) { return copy.t('page:tile.prior', { value: v === null ? none : f(v) }); }
    function drawTiles() {
      var t = HD.tiles(rows, state.entity, curMeta);
      var badge = t && t.provisional ? [K.provisionalBadge(copy)] : [];
      K.fillTile(tHires, { name: copy.t('page:tile.hires'), badges: badge.slice(), value: t && t.hires !== null ? fmtInt(t.hires) : none, subs: [prior(t ? t.hiresPrior : null, fmtInt)] });
      K.fillTile(tDeps, { name: copy.t('page:tile.departures'), badges: t && t.provisional ? [K.provisionalBadge(copy)] : [], value: t && t.departures !== null ? fmtInt(t.departures) : none, subs: [prior(t ? t.departuresPrior : null, fmtInt)] });
      K.fillTile(tRate, {
        name: copy.t('page:tile.rate'), badges: t && t.provisional ? [K.provisionalBadge(copy)] : [],
        value: t && t.rate !== null ? fmtRate(t.rate) : none,
        subs: [prior(t ? t.ratePrior : null, fmtRate), t && t.smallBase ? { text: copy.t('shell:flag.smallBase'), cls: 'opm-tile__flag' } : '']
      });
      tilesNotes.textContent = '';
      if (t && t.provisional) tilesNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--provisional', text: copy.t('shell:flag.provisional') }));
    }

    /* panel 2: hires vs departures */
    var fFlows = OPM.chartFrame.create(body, { id: 'hires-vs-departures', title: copy.t('page:chart.flows.title'), copy: copy, type: 'bar', format: fmtInt });

    /* panel 3: why people left (stacked categories; DRP line overlay, on by default, toggled in the legend) */
    var fReasons = OPM.chartFrame.create(body, {
      id: 'why-people-left', title: copy.t('page:chart.reasons.title'), copy: copy, type: 'bar', format: fmtInt,
      options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    /* panel 4: rates, with the method chosen in this panel */
    var fRates = OPM.chartFrame.create(body, {
      id: 'rates', title: copy.t('page:chart.rates.title'), copy: copy, type: 'line', format: fmtRate, tools: true,
      options: { scales: { y: { beginAtZero: true } } }
    });
    OPM.controls.rateMethod.render(fRates.tools, {
      copy: {
        label: copy.t('shell:ctl.rate'),
        options: { a: copy.t('shell:ctl.rate.a'), b: copy.t('shell:ctl.rate.b'), c: copy.t('shell:ctl.rate.c') },
        help: { a: copy.t('shell:ctl.rate.help.a'), b: copy.t('shell:ctl.rate.help.b'), c: copy.t('shell:ctl.rate.help.c') }
      },
      value: state.method, onChange: function (m) { state.method = m; drawRates(); }
    });

    /* panel 5: hires by type */
    var fTypes = OPM.chartFrame.create(body, {
      id: 'hires-by-type', title: copy.t('page:chart.hireTypes.title'), copy: copy, type: 'bar', format: fmtInt,
      options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
    });

    var picked = [];
    function col(name) { return picked.map(function (r) { return D.value(r, name); }); }

    function drawRates() {
      var R = HD.rates(picked, state.method);
      var dashIn = picked.map(function (r) { return r.provisional === true; });
      var anySmall = false;
      fRates.setData({
        labels: picked.map(periodText),
        datasets: HD.RATES.map(function (measure) {
          anySmall = anySmall || R[measure].smallBase.some(Boolean);
          return K.lineDataset(R[measure].values, RATE_COLORS[measure], rateLabel[measure], dashIn, K.pointMarkers(picked, R[measure].smallBase));
        }),
        fileSuffix: state.entity + '-' + state.grain + '-' + state.method
      });
      var notes = [{ text: copy.t('page:chart.rates.note') }];
      if (!OPM.controls.rateMethod.availableAt(state.method, state.grain)) notes.push({ text: copy.t('shell:chart.noRateAtGrain'), flag: 'norate' });
      if (anySmall) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      HD.ytdRows(picked, state.method).forEach(function (r) { notes.push({ text: copy.t('shell:flag.ytd', { period: label(r.period) }), flag: 'ytd' }); });
      fRates.setNotes(notes.concat(K.flagNotes(copy, picked)));
      OPM.shell.refreshDraft();
    }

    var seriesNote = h('p', { class: 'opm-series-none', role: 'status', hidden: true });
    tiles.parentNode.insertBefore(seriesNote, tiles);
    function drawAll() {
      seriesNote.textContent = copy.t('shell:series.none');
      seriesNote.hidden = !(curSeries !== SR.ALL && !SR.present(curMeta, state.entity, curSeries));
      drawTiles();
      picked = D.selectRows(rows, { entity: state.entity, grain: state.grain, range: state.range });
      var labels = picked.map(periodText), suffix = state.entity + '-' + state.grain + (curSeries !== SR.ALL ? '-series-' + curSeries : '');
      var prov = picked.map(function (r) { return r.provisional === true; });
      var flagNotes = K.flagNotes(copy, picked);

      fFlows.setData({
        labels: labels, fileSuffix: suffix,
        datasets: [K.barDataset(col('hires'), prov, '--chart-2', copy.t('page:chart.flows.series.hires')),
          K.barDataset(col('departures'), prov, '--chart-3', copy.t('page:chart.flows.series.departures'))]
      });
      fFlows.setNotes(flagNotes);

      // DRP flags begin in Mar 2025: before the first period with any DRP departure the line is a gap, not zeros (data unchanged)
      var drpValues = col('sep_drp'), firstDrp = drpValues.findIndex(function (v) { return v !== null && v > 0; });
      drpValues = drpValues.map(function (v, i) { return firstDrp >= 0 && i >= firstDrp ? v : null; });
      var drp = K.lineDataset(drpValues, '--chart-1', copy.t('page:chart.reasons.drp'), prov, K.pointMarkers(picked));
      drp.stack = 'drp'; drp.order = -1; drp.pointRadius = drp.pointRadius.map(function (r) { return r || 2; });
      fReasons.setData({
        labels: labels, fileSuffix: suffix,
        datasets: HD.REASONS.map(function (c, i) { return K.barDataset(col(c), prov, REASON_COLORS[i], seriesLabel(c), { stack: 'reasons' }); }).concat([drp])
      });
      fReasons.setNotes([{ text: copy.t('page:chart.reasons.drpNote') }].concat(flagNotes));

      fTypes.setData({
        labels: labels, fileSuffix: suffix,
        datasets: HD.HIRE_TYPES.map(function (c, i) { return K.barDataset(col(c), prov, HIRE_COLORS[i], seriesLabel(c), { stack: 'hires' }); })
      });
      fTypes.setNotes(flagNotes);
      drawRates();
    }

    /* the figures for the selected series: doj_core for all job series; otherwise the component's series file */
    var ticket = 0;
    function loadSeries() {
      var t = ++ticket, g = state.series;
      adminPanel.update(state.entity, g);
      if (g === SR.ALL) { rows = coreRows; curMeta = coreMeta; curSeries = g; drawAll(); OPM.page.shown = state.entity + ':' + g; return; }
      SD.group('doj_core_series', [state.entity], g).then(function (d) {
        if (t !== ticket) return;
        rows = d.rows; curMeta = d.meta; curSeries = g; drawAll(); OPM.page.shown = state.entity + ':' + g;
      }, function (e) {
        if (t !== ticket) return;
        console.info('Hiring and departures: job series data not available (' + e.message + ')');
        // back to all job series (never series labels on all-series figures)
        state.series = SR.ALL; seriesCtl.set(SR.ALL); loadSeries();
        seriesNote.hidden = false; seriesNote.textContent = copy.t('shell:data.unavailable');
      });
    }

    state.series = SR.ALL;
    drawAll();
    /* panel 6: Compare administrations (docs/pages/administrations.md section 3), following the component and job series */
    var adminPanel = OPM.adminPanel.create(body, { copy: copy, L: L, entity: state.entity, series: state.series });
    OPM.page = { state: state, meta: meta, frames: { flows: fFlows, reasons: fReasons, rates: fRates, types: fTypes }, drawAll: drawAll, admin: adminPanel,
      data: function () { return { rows: rows, meta: curMeta, series: curSeries }; }, shown: 'DOJ:' + SR.ALL };
  }
})(typeof self !== 'undefined' ? self : this);
