/* Components compared page (docs/pages/components-compared.md; container D-046, contents and copy
   D-047). Reads data/doj_core.json and its meta (via OPM.pageKit). No component selector: every panel
   shows all components, with DOJ overall as the reference. Panels: 1 table, 2 ranking, 3 growth,
   4 why people left by component. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var NUM = new Intl.NumberFormat('en-US');
  var REASON_COLORS = ['--chart-2', '--chart-3', '--chart-4', '--chart-6', '--chart-5', '--chart-11']; // as on Hiring and departures
  // 12 distinct hues for the component lines (DOJ is the thick ink line). --chart-7 (teal), -9, -12, -13 and
  // -14 are left out: each sits too close to the green, blue or orange already used here.
  var LINE_COLORS = ['--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-18', '--chart-8', '--chart-10', '--chart-11', '--chart-15', '--chart-16', '--chart-17'];
  function rateText(v) { return (v * 100).toFixed(1) + '%'; }
  function indexText(v) { return (v * 100).toFixed(0); } // growth is a ratio, shown as an index (start = 100)

  K.load('Components compared', build);

  function build(copy, cube, meta) {
    var h = OPM.dom.h, D = OPM.data, CC = OPM.compare, token = OPM.chartFrame.token;
    var rows = D.fromCube(cube);
    var L = K.labels(copy), label = L.label, periodText = L.periodText;
    var none = copy.t('shell:num.none');
    var body = document.getElementById('page-body');
    var state = { grain: OPM.controls.grain.DEFAULT, period: null, method: OPM.controls.rateMethod.DEFAULT, startFy: 'FY2012', sort: null };
    var methodName = { a: copy.t('shell:ctl.rate.a'), b: copy.t('shell:ctl.rate.b'), c: copy.t('shell:ctl.rate.c') };

    function compName(c) { // CRS is labeled with its end month
      var n = copy.t('components:' + c.entity); // copy-audit: components:*
      return c.ended ? copy.t('shell:ctl.component.ended', { name: n, month: label(c.endMonth) }) : n;
    }
    var dojName = copy.t('page:row.doj');

    /* controls: View (with the D-033 note), Period, Rate based on */
    var bar = h('div', { class: 'opm-settings', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: function (g) { state.grain = g; state.period = null; fillPeriods(); drawAll(); }
    });
    var periodId = OPM.dom.id('period'), periodSel = h('select', { id: periodId });
    bar.appendChild(h('div', { class: 'opm-field opm-field--period' }, [h('label', { for: periodId, class: 'opm-field__name', text: copy.t('page:ctl.period') }), periodSel]));
    periodSel.addEventListener('change', function () { state.period = periodSel.value; drawAll(); });
    OPM.controls.rateMethod.render(bar, {
      copy: { label: copy.t('shell:ctl.rate'), options: methodName,
        help: { a: copy.t('shell:ctl.rate.help.a'), b: copy.t('shell:ctl.rate.help.b'), c: copy.t('shell:ctl.rate.help.c') } },
      value: state.method, onChange: function (m) { state.method = m; drawAll(); }
    });

    function fillPeriods() {
      var list = CC.periods(rows, state.grain);
      periodSel.textContent = '';
      list.forEach(function (p) {
        var r = CC.rowFor(rows, 'DOJ', state.grain, p);
        periodSel.appendChild(h('option', { value: p, text: periodText(r) }));
      });
      if (!state.period || list.indexOf(state.period) < 0) state.period = list[0]; // latest first
      periodSel.value = state.period;
    }

    /* panel 1: the comparison table */
    var tablePanel = h('section', { class: 'opm-panel opm-compare', 'aria-labelledby': 'cc-table-title', 'data-chart': 'table' });
    body.appendChild(tablePanel);
    tablePanel.appendChild(h('div', { class: 'opm-panel__head' }, [h('h2', { id: 'cc-table-title', text: copy.t('page:table.title') })]));
    var caption = h('p', { class: 'opm-compare__caption' });
    var hint = h('p', { class: 'opm-field__note', text: copy.t('page:sort.hint') });
    var scroller = h('div', { class: 'opm-compare__scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'cc-table-title' });
    var table = h('table', { class: 'opm-compare__table' });
    scroller.appendChild(table);
    var tableNotes = h('div', { class: 'opm-chart__notes' });
    [caption, hint, scroller, tableNotes].forEach(function (e) { tablePanel.appendChild(e); });
    var COLS = ['component', 'employees', 'change', 'hires', 'departures', 'attrition', 'quit', 'retirement'].map(function (k) { return { key: k }; });
    var colLabel = { component: copy.t('page:col.component'), employees: copy.t('page:col.employees'), change: copy.t('page:col.change'), hires: copy.t('page:col.hires'),
      departures: copy.t('page:col.departures'), attrition: copy.t('page:col.rate'), quit: copy.t('page:col.quit'), retirement: copy.t('page:col.retirement') };

    function cellText(key, cells) {
      if (!cells) return none;
      if (key === 'change') {
        if (cells.change === null) return none;
        return K.fmt.signed(cells.change) + (cells.changePct === null ? '' : ' (' + K.fmt.pctChange(cells.changePct) + ')');
      }
      if (key === 'attrition' || key === 'quit' || key === 'retirement') return cells[key] === null ? none : rateText(cells[key]);
      return cells[key] === null ? none : NUM.format(cells[key]);
    }

    function drawTable(comps, dojCells) {
      var avail = OPM.controls.rateMethod.availableAt(state.method, state.grain);
      var list = comps.map(function (c) { return { entity: c.entity, comp: c, cells: CC.tableRow(rows, c.row, state.method) }; });
      if (!avail) list.forEach(function (r) { if (r.cells) CC.RATES.forEach(function (m) { r.cells[m] = null; }); });
      if (state.sort) list = CC.sortRows(list, state.sort.key, state.sort.dir, function (e) { return compName(list.filter(function (x) { return x.entity === e; })[0].comp); });
      if (!avail && dojCells) CC.RATES.forEach(function (m) { dojCells[m] = null; });

      table.textContent = '';
      var headRow = h('tr');
      COLS.forEach(function (col) {
        var sorted = state.sort && state.sort.key === col.key;
        var btn = h('button', { type: 'button', class: 'opm-compare__sort', 'data-col': col.key, text: colLabel[col.key] });
        btn.addEventListener('click', function () {
          // numbers sort descending first; the component names A to Z first (L-058); a second click reverses
          var first = col.key === 'component' ? 'asc' : 'desc';
          state.sort = { key: col.key, dir: sorted ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : first };
          drawAll();
        });
        headRow.appendChild(h('th', { scope: 'col', class: col.key === 'component' ? 'opm-compare__name' : null, 'aria-sort': sorted ? (state.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none' }, [btn]));
      });
      table.appendChild(h('thead', null, [headRow]));
      var tbody = h('tbody');
      function tr(name, cells, cls, entity) {
        var row = h('tr', { class: cls || null, 'data-entity': entity });
        row.appendChild(h('th', { scope: 'row', class: 'opm-compare__name', text: name }));
        COLS.slice(1).forEach(function (col) {
          var td = h('td', { text: cellText(col.key, cells) });
          if (cells && cells.smallBase && (col.key === 'attrition' || col.key === 'quit' || col.key === 'retirement') && cells[col.key] !== null) {
            td.appendChild(h('span', { class: 'opm-compare__small', role: 'img', 'aria-label': copy.t('shell:flag.smallBase'), title: copy.t('shell:flag.smallBase') }));
          }
          row.appendChild(td);
        });
        tbody.appendChild(row);
      }
      tr(dojName, dojCells, 'opm-compare__doj', 'DOJ');
      list.forEach(function (r) { tr(compName(r.comp), r.cells, null, r.entity); });
      table.appendChild(tbody);

      var dojRow = CC.rowFor(rows, 'DOJ', state.grain, state.period);
      caption.textContent = '';
      if (dojRow && dojRow.provisional) caption.appendChild(K.provisionalBadge(copy));
      caption.appendChild(document.createTextNode(copy.t('page:table.caption', { period: periodText(dojRow), method: methodName[state.method] })));
      var notes = [];
      if (!avail) notes.push({ text: copy.t('shell:chart.noRateAtGrain'), flag: 'norate' });
      if (dojRow && dojRow.provisional) notes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      if (avail && state.method === 'b' && dojRow && dojRow.partial && state.grain === 'fy') notes.push({ text: copy.t('shell:flag.ytd', { period: label(state.period) }), flag: 'ytd' });
      if (avail && list.some(function (r) { return r.cells && r.cells.smallBase && r.cells.attrition !== null; })) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      tableNotes.textContent = '';
      notes.forEach(function (n) { tableNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--' + n.flag, text: n.text })); });
      return list;
    }

    /* panel 2: departure rate ranking with DOJ overall as a reference line */
    var refValue = null;
    var fRank = OPM.chartFrame.create(body, {
      id: 'departure-rate-ranking', title: copy.t('page:chart.ranking.title'), copy: copy, type: 'bar', format: rateText, legend: false,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 56 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return rateText(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', format: rateText, color: token('--color-ink'), font: token('--font-sans') }, opmRefLine: { value: null, color: token('--color-ink') } }
      },
      exportExtra: function () {
        var xs = fRank.chart.scales.x, m0 = fRank.chart.getDatasetMeta(0), ds = fRank.chart.data.datasets[0];
        return {
          markers: refValue === null ? [] : [{ x: xs.getPixelForValue(refValue), kind: 'rule', label: copy.t('page:chart.ranking.reference', { rate: rateText(refValue) }) }],
          labels: m0.data.map(function (el, j) { return ds.data[j] === null ? null : { x: el.x + 4, y: el.y + 4, text: rateText(ds.data[j]) }; }).filter(Boolean)
        };
      }
    });

    function drawRanking(comps, dojCells) {
      var avail = OPM.controls.rateMethod.availableAt(state.method, state.grain);
      var items = comps.map(function (c) { var t = CC.tableRow(rows, c.row, state.method); return { comp: c, rate: avail && t ? t.attrition : null, small: !!(t && t.smallBase) }; })
        .filter(function (x) { return x.rate !== null; }).sort(function (a, b) { return b.rate - a.rate; });
      refValue = avail && dojCells ? dojCells.attrition : null;
      fRank.chart.options.plugins.opmRefLine.value = refValue;
      fRank.plot.style.height = (Math.max(items.length, 1) * K.barRowHeight() + 40) + 'px';
      var c = token('--chart-3');
      fRank.setData({
        labels: items.map(function (x) { return compName(x.comp); }),
        datasets: [{ type: 'bar', label: copy.t('page:col.rate'), data: items.map(function (x) { return x.rate; }), _color: c, borderColor: c, barThickness: 16,
          _faded: items.map(function (x) { return x.small; }),
          backgroundColor: items.map(function (x) { return x.small ? OPM.chartFrame.hatch(c) : c; }), borderWidth: items.map(function (x) { return x.small ? 1 : 0; }) }],
        fileSuffix: state.grain + '-' + state.period + '-' + state.method
      });
      var notes = [];
      if (!avail) notes.push({ text: copy.t('shell:chart.noRateAtGrain'), flag: 'norate' });
      if (refValue !== null) notes.push({ text: copy.t('page:chart.ranking.reference', { rate: rateText(refValue) }), flag: 'reference' });
      if (items.some(function (x) { return x.small; })) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      fRank.setNotes(notes);
      return items;
    }

    /* panel 3: growth since a start year (start = 100), with the start year chosen in the panel */
    var fGrowth = OPM.chartFrame.create(body, {
      id: 'growth', title: '', copy: copy, type: 'line', format: indexText, tools: true,
      options: { scales: { y: { beginAtZero: false } } }
    });
    var growthTitle = fGrowth.el.querySelector('h2');
    var startId = OPM.dom.id('start'), startSel = h('select', { id: startId });
    fGrowth.tools.appendChild(h('div', { class: 'opm-field opm-field--start' }, [h('label', { for: startId, class: 'opm-field__name', text: copy.t('page:ctl.startYear') }), startSel]));
    var fys = CC.periods(rows, 'fy').slice().reverse(); // FY2012 ... latest
    fys.slice(0, -1).forEach(function (p) { startSel.appendChild(h('option', { value: p, text: label(p) })); }); // to the year before the latest
    startSel.value = state.startFy;
    startSel.addEventListener('change', function () { state.startFy = startSel.value; drawGrowth(); OPM.shell.refreshDraft(); });

    function drawGrowth() {
      var comps;
      var yearText = label(state.startFy);
      growthTitle.textContent = copy.t('page:chart.growth.title', { year: yearText });
      var doj = CC.growth(rows, 'DOJ', state.grain, state.startFy);
      var labels = doj.rows.map(periodText), keys = doj.rows.map(function (r) { return r.period; });
      var dashIn = doj.rows.map(function (r) { return r.provisional === true; });
      comps = CC.allComponents(rows, meta); // every component; CRS stops at Apr 2026
      var datasets = [];
      var dojDs = K.lineDataset(doj.values, '--chart-1', copy.t('page:chart.growth.doj'), dashIn, doj.rows.map(function () { return null; }));
      dojDs.borderWidth = 3.5;
      datasets.push(dojDs);
      comps.forEach(function (c, i) {
        var g = CC.growth(rows, c.entity, state.grain, state.startFy);
        var byKey = {}; g.rows.forEach(function (r, j) { byKey[r.period] = g.values[j]; });
        var ds = K.lineDataset(keys.map(function (k) { return byKey[k] === undefined ? null : byKey[k]; }), LINE_COLORS[i % LINE_COLORS.length], compName(c), dashIn, keys.map(function () { return null; }));
        ds.borderWidth = 1.5;
        datasets.push(ds);
      });
      fGrowth.setData({ labels: labels, datasets: datasets, fileSuffix: state.grain + '-from-' + state.startFy });
      var notes = [{ text: copy.t('page:chart.growth.note', { year: yearText }) }];
      if (dashIn.some(Boolean)) notes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fGrowth.setNotes(notes);
    }

    /* panel 4: why people left, by component (100% bars of reason / departures) */
    var noneRows = [];
    var fReasons = OPM.chartFrame.create(body, {
      id: 'reasons-by-component', title: copy.t('page:chart.reasons.title'), copy: copy, type: 'bar', format: rateText,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 8 } },
        scales: { x: { stacked: true, min: 0, max: 1, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return (v * 100).toFixed(0) + '%'; } } },
          y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', color: token('--color-ink'), font: token('--font-sans') } }
      }
    });
    function drawReasons(comps) {
      var entries = [{ name: dojName, row: CC.rowFor(rows, 'DOJ', state.grain, state.period) }].concat(comps.map(function (c) { return { name: compName(c), row: c.row }; }));
      var shares = entries.map(function (e) { return CC.reasonShares(e.row); });
      noneRows = shares.map(function (s) { return s.none; });
      fReasons.plot.style.height = (entries.length * K.barRowHeight() + 40) + 'px';
      fReasons.setData({
        labels: entries.map(function (e) { return e.name; }),
        datasets: CC.REASONS.map(function (col, i) {
          var c = token(REASON_COLORS[i]);
          return { type: 'bar', label: copy.t('series:' + col), data: shares.map(function (s) { return s.shares[i]; }), backgroundColor: c, borderColor: c, _color: c, stack: 'r', barThickness: 16, // copy-audit: series:sep_transfer_out series:sep_quit series:sep_retirement series:sep_rif series:sep_termination series:sep_other
            _labels: i === 0 ? noneRows.map(function (n) { return n ? copy.t('page:chart.reasons.none') : null; }) : null };
        }),
        fileSuffix: state.grain + '-' + state.period
      });
      var dojRow = entries[0].row;
      var notes = [{ text: copy.t('page:chart.reasons.note', { period: periodText(dojRow) }) }];
      if (dojRow && dojRow.provisional) notes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fReasons.setNotes(notes);
      return entries.map(function (e, j) { return { name: e.name, none: noneRows[j], shares: shares[j].shares }; });
    }

    var last = {};
    function drawAll() {
      var comps = CC.components(rows, meta, state.grain, state.period);
      var dojCells = CC.tableRow(rows, CC.rowFor(rows, 'DOJ', state.grain, state.period), state.method);
      last.table = drawTable(comps, dojCells);
      last.dojCells = dojCells;
      last.ranking = drawRanking(comps, dojCells);
      drawGrowth();
      last.reasons = drawReasons(comps);
      OPM.shell.refreshDraft();
    }

    fillPeriods();
    drawAll();
    OPM.page = { state: state, rows: rows, meta: meta, frames: { ranking: fRank, growth: fGrowth, reasons: fReasons }, last: last, drawAll: drawAll, ready: true };
  }
})(typeof self !== 'undefined' ? self : this);
