/* Workforce Look-Up page (docs/pages/workforce-lookup.md; container D-051, fields D-052, readings D-053,
   reader D-054, contents and copy D-056, Appointment type filter D-095; invariant 10). Reads data/lookup.meta.json and then ONE Parquet file,
   data/lookup/<file>.parquet, for the chosen dataset and snapshot, with the vendored reader (OPMParquet).
   Rows of different files are never held or shown together: switching dataset or snapshot replaces the rows. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit, LU = OPM.lookup;
  var META_URL = 'data/lookup.meta.json';
  var PAGE_SIZE = 50;
  var NUM = new Intl.NumberFormat('en-US');
  var KDI_HREF = 'reading-the-data.html#known-gaps';

  OPM.shell.ready.then(function (ctx) {
    return K.getJson(META_URL).then(function (meta) { build(ctx.copy, meta); }, function (err) { K.unavailable(ctx.copy, 'Workforce Look-Up', err); });
  }).catch(function (e) { console.error(e); });

  function build(copy, meta) {
    var h = OPM.dom.h, L = K.labels(copy), none = copy.t('shell:num.none');
    var body = document.getElementById('page-body');
    var intro = document.querySelector('.opm-intro');
    intro.parentNode.insertBefore(h('p', { class: 'opm-intro opm-intro--privacy', text: copy.t('page:page.privacy') }), intro.nextSibling);

    var colLabel = {
      snapshot: copy.t('page:col.snapshot'), component: copy.t('page:col.component'), effective: copy.t('page:col.effective'), processed: copy.t('page:col.processed'),
      reason: copy.t('page:col.reason'), hireType: copy.t('page:col.hireType'), drp: copy.t('page:col.drp'), occupation: copy.t('page:col.occupation'),
      payPlan: copy.t('page:col.payPlan'), grade: copy.t('page:col.grade'), age: copy.t('page:col.age'), service: copy.t('page:col.service'),
      supervisory: copy.t('page:col.supervisory'), appointment: copy.t('page:col.appointment'), tenure: copy.t('page:col.tenure'), education: copy.t('page:col.education'),
      veteran: copy.t('page:col.veteran'), schedule: copy.t('page:col.schedule'), pay: copy.t('page:col.pay'), state: copy.t('page:col.state')
    };
    var filterLabel = {
      component: copy.t('page:ctl.filter.component'), fy: copy.t('page:ctl.filter.fy'), reason: copy.t('page:ctl.filter.reason'), hireType: copy.t('page:ctl.filter.hireType'),
      occupation: copy.t('page:ctl.filter.occupation'), grade: copy.t('page:ctl.filter.grade'), age: copy.t('page:ctl.filter.age'), supervisory: copy.t('page:ctl.filter.supervisory'),
      appointment: copy.t('page:ctl.filter.appointment')
    };
    /* the Appointments tab's signed group labels (D-086), for the Appointment type list (D-095) */
    var apptGroupLabel = {
      career: copy.t('shell:appt.group.career'), career_conditional: copy.t('shell:appt.group.careerConditional'), excepted: copy.t('shell:appt.group.excepted'),
      temporary: copy.t('shell:appt.group.temporary'), ses: copy.t('shell:appt.group.ses'), political: copy.t('shell:appt.group.political'),
      schedule_policy: copy.t('shell:appt.group.schedulePolicy')
    };
    var NEST = '\u00a0\u00a0\u00a0\u00a0'; // indents a published type under its group in the list (a native select styles no padding)
    var datasetLabel = { separations: copy.t('page:ctl.dataset.separations'), accessions: copy.t('page:ctl.dataset.accessions'), employment: copy.t('page:ctl.dataset.employment') };
    var componentNames = {};
    function componentName(code, opmName) {
      if (!code) return opmName || none;
      if (componentNames[code] === undefined) { try { componentNames[code] = copy.t('components:' + code); } catch (e) { componentNames[code] = null; } } // copy-audit: components:*
      return componentNames[code] || opmName || code;
    }
    function monthText(v) { var k = LU.yyyymmToKey(v); return k ? L.label(k) : (LU.isEmpty(v) ? none : v); }

    /* the shown text of a row's column (display only; the CSV keeps the published values) */
    function display(r, c) {
      if (c.col === 'component') return componentName(r.agency_subelement_code, r.agency_subelement);
      if (c.col === 'occupation') {
        var parts = [r.occupational_series_code, r.occupational_series].filter(function (v) { return !LU.isEmpty(v); });
        return parts.length ? parts.join(' ') : none;
      }
      if (LU.MONTHS[c.field]) return monthText(r[c.field]);
      return LU.isEmpty(r[c.field]) ? none : r[c.field];
    }

    /* the files the meta lists: departures, hires, and one employee file per snapshot */
    var snapshots = Object.keys(meta.files).filter(function (k) { return /^employment_FY\d{4}$/.test(k); }).sort();
    if (meta.files.employment_latest) snapshots.push('employment_latest');
    function snapshotLabel(key) {
      if (key === 'employment_latest') {
        var src = (meta.files.employment_latest.sources || [])[0], m = src && /_(\d{6})_/.exec(src.file);
        return copy.t('page:ctl.snapshot.latest', { month: m ? monthText(m[1]) : none });
      }
      var fy = key.slice(-4);
      return copy.t('page:ctl.snapshot.sep', { year: fy, fy: fy });
    }

    // departures and hires open newest first (by the month the action took effect, L-103); a snapshot has one month
    function defaultSort(dataset) { return dataset === 'employment' ? null : { col: 'effective', field: 'personnel_action_effective_date_yyyymm', dir: 'desc' }; }
    var state = { dataset: 'separations', snapshot: snapshots[snapshots.length - 1], filters: {}, search: '', groupBy: 'component', sort: defaultSort('separations'), page: 1 };
    var current = null; // { key, dataset, rows, cols, index, options, titles } of the ONE loaded file

    /* controls */
    var bar = h('div', { class: 'opm-settings', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    function field(cls, labelText, control) {
      var id = OPM.dom.id('lu'); control.id = id;
      var el = h('div', { class: 'opm-field ' + cls }, [h('label', { for: id, class: 'opm-field__name', text: labelText }), control]);
      bar.appendChild(el);
      return el;
    }
    var datasetSel = h('select');
    ['separations', 'accessions', 'employment'].forEach(function (d) { datasetSel.appendChild(h('option', { value: d, text: datasetLabel[d] })); });
    field('opm-field--dataset', copy.t('page:ctl.dataset'), datasetSel);
    var snapSel = h('select');
    snapshots.forEach(function (k) { snapSel.appendChild(h('option', { value: k, text: snapshotLabel(k) })); });
    snapSel.value = state.snapshot;
    var snapField = field('opm-field--snapshot', copy.t('page:ctl.snapshot'), snapSel);
    var searchInput = h('input', { type: 'search', placeholder: copy.t('page:ctl.search.placeholder'), autocomplete: 'off' });
    field('opm-field--search', copy.t('page:ctl.search'), searchInput);
    var clearBtn = h('button', { type: 'button', class: 'opm-choice opm-lookup__clear', text: copy.t('page:ctl.clear') });
    bar.appendChild(h('div', { class: 'opm-field opm-field--clear' }, [clearBtn]));

    var filterBox = h('fieldset', { class: 'opm-settings opm-lookup__filters' }, [h('legend', { class: 'opm-field__name', text: copy.t('page:ctl.filters') })]);
    body.appendChild(filterBox);
    var filterSelects = {};
    var groupSel = h('select');

    /* summary */
    var summary = h('section', { class: 'opm-panel opm-lookup__summary', 'aria-live': 'polite' });
    var countLine = h('p', { class: 'opm-lookup__count' });
    var groupWrap = h('div', { class: 'opm-lookup__groups' });
    var groupId = OPM.dom.id('group');
    groupSel.id = groupId;
    summary.appendChild(h('div', { class: 'opm-lookup__summary-head' }, [countLine,
      h('div', { class: 'opm-field opm-field--group' }, [h('label', { for: groupId, class: 'opm-field__name', text: copy.t('page:ctl.groupBy') }), groupSel])]));
    summary.appendChild(groupWrap);
    body.appendChild(summary);

    /* table */
    var tablePanel = h('section', { class: 'opm-panel opm-lookup__records', 'data-chart': 'records' });
    var pagerTop = h('div', { class: 'opm-lookup__pager' });
    var scroller = h('div', { class: 'opm-compare__scroll opm-lookup__scroll', tabindex: '0', role: 'region', 'aria-label': copy.t('page:page.title') });
    var table = h('table', { class: 'opm-compare__table opm-lookup__table' });
    scroller.appendChild(table);
    var pagerBottom = h('div', { class: 'opm-lookup__pager' });
    var dlBtn = h('button', { type: 'button', class: 'opm-choice opm-lookup__download', text: copy.t('page:download.button') });
    var dlNote = h('p', { class: 'opm-field__note opm-field__note--wide', text: copy.t('page:download.note') });
    [pagerTop, scroller, pagerBottom, h('div', { class: 'opm-lookup__download-row' }, [dlBtn, dlNote])].forEach(function (e) { tablePanel.appendChild(e); });
    body.appendChild(tablePanel);

    function optionLabel(key, v) {
      if (v === null) return none;
      if (key === 'component') return componentName(v, current && current.titles.component[v]);
      if (key === 'fy') return L.label(v);
      if (key === 'occupation') return v + (current && current.titles.occupation[v] ? ' ' + current.titles.occupation[v] : '');
      return v;
    }

    function drawFilters() {
      Array.prototype.slice.call(filterBox.querySelectorAll('.opm-field')).forEach(function (e) { e.remove(); });
      filterSelects = {};
      LU.FILTERS[current.dataset].forEach(function (key) {
        var sel = h('select', { 'data-filter': key });
        sel.appendChild(h('option', { value: '', text: copy.t('page:ctl.filter.all') }));
        if (key === 'appointment') { // groups are options themselves (selectable), each followed by its published types, indented (D-095)
          LU.appointmentOptions(current.options[key]).forEach(function (o) {
            sel.appendChild(h('option', o.group ? { value: o.value, text: apptGroupLabel[o.group], class: 'opm-lookup__opt-group', 'data-group': o.group }
              : { value: o.value, text: (o.nested ? NEST : '') + o.label, 'data-nested': o.nested ? '1' : null }));
          });
        } else current.options[key].forEach(function (v) { sel.appendChild(h('option', { value: v, text: optionLabel(key, v) })); });
        sel.value = state.filters[key] || '';
        sel.addEventListener('change', function () { state.filters[key] = sel.value || null; state.page = 1; draw(); });
        var id = OPM.dom.id('filter'); sel.id = id;
        filterBox.appendChild(h('div', { class: 'opm-field opm-field--filter-' + key }, [h('label', { for: id, class: 'opm-field__name', text: filterLabel[key] }), sel]));
        filterSelects[key] = sel;
      });
      groupSel.textContent = '';
      LU.FILTERS[current.dataset].forEach(function (key) { groupSel.appendChild(h('option', { value: key, text: filterLabel[key] })); });
      if (LU.FILTERS[current.dataset].indexOf(state.groupBy) < 0) state.groupBy = 'component';
      groupSel.value = state.groupBy;
    }

    function drawTable(idx) {
      var cols = current.cols;
      var sorted = state.sort ? LU.sortIndexes(current.rows, idx, state.sort.field, state.sort.dir,
        state.sort.col === 'component' || state.sort.col === 'occupation' ? function (r) { return display(r, { col: state.sort.col, field: state.sort.field }); } : null) : idx;
      var pg = LU.page(sorted, state.page, PAGE_SIZE);
      state.page = pg.page;
      table.textContent = '';
      var hr = h('tr');
      cols.forEach(function (c, i) {
        var on = state.sort && state.sort.col === c.col;
        var btn = h('button', { type: 'button', class: 'opm-compare__sort', 'data-col': c.col, text: colLabel[c.col] });
        btn.addEventListener('click', function () {
          state.sort = { col: c.col, field: c.field, dir: on && state.sort.dir === 'asc' ? 'desc' : 'asc' };
          state.page = 1; draw();
        });
        hr.appendChild(h('th', { scope: 'col', class: i === 0 ? 'opm-compare__name' : null, 'aria-sort': on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' }, [btn]));
      });
      table.appendChild(h('thead', null, [hr]));
      var tb = h('tbody');
      pg.rows.forEach(function (i) {
        var r = current.rows[i], tr = h('tr');
        cols.forEach(function (c, j) {
          var cell = h(j === 0 ? 'th' : 'td', { scope: j === 0 ? 'row' : null, class: j === 0 ? 'opm-compare__name' : null, text: display(r, c), title: j === 0 ? display(r, c) : null, 'aria-label': j === 0 ? display(r, c) : null }); // the full name as a tooltip where a phone truncates it
          if (c.field === 'length_of_service_years' && LU.isKdi001(current.dataset, r)) {
            cell.appendChild(h('a', { href: KDI_HREF, class: 'opm-lookup__kdi', 'aria-label': copy.t('page:kdi.marker'), title: copy.t('page:kdi.marker'), text: '!' }));
          }
          tr.appendChild(cell);
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      [pagerTop, pagerBottom].forEach(function (p) {
        p.textContent = '';
        var prev = h('button', { type: 'button', class: 'opm-choice', 'data-pager': 'prev', text: copy.t('page:table.prev'), disabled: pg.page <= 1 });
        var next = h('button', { type: 'button', class: 'opm-choice', 'data-pager': 'next', text: copy.t('page:table.next'), disabled: pg.page >= pg.pages });
        prev.addEventListener('click', function () { state.page = pg.page - 1; draw(); });
        next.addEventListener('click', function () { state.page = pg.page + 1; draw(); });
        p.appendChild(prev);
        p.appendChild(h('span', { class: 'opm-lookup__page', text: copy.t('page:table.page', { page: NUM.format(pg.page), pages: NUM.format(pg.pages) }) }));
        p.appendChild(next);
      });
      scroller.hidden = idx.length === 0;
      return pg;
    }

    function drawSummary(idx) {
      countLine.textContent = idx.length ? copy.t('page:summary.count', { count: NUM.format(idx.length) }) : copy.t('page:summary.none');
      groupWrap.textContent = '';
      if (!idx.length) return [];
      var g = LU.groupCounts(current.rows, idx, state.groupBy);
      var t = h('table', { class: 'opm-lookup__group-table', 'aria-label': copy.t('page:ctl.groupBy') + ': ' + groupSel.selectedOptions[0].textContent });
      var tb = h('tbody');
      g.forEach(function (x) { tb.appendChild(h('tr', null, [h('th', { scope: 'row', text: optionLabel(state.groupBy, x.value) }), h('td', { text: NUM.format(x.count) })])); });
      t.appendChild(tb);
      groupWrap.appendChild(t);
      return g;
    }

    var last = {};
    function draw() {
      if (!current) return;
      var idx = LU.filterRows(current.rows, state.filters, state.search, current.index);
      last.idx = idx;
      last.groups = drawSummary(idx);
      last.page = drawTable(idx);
      OPM.shell.refreshDraft();
    }

    function fileKey() { return state.dataset === 'employment' ? state.snapshot : state.dataset; }

    function load() {
      var key = fileKey(), info = meta.files[key];
      if (!info) { K.unavailable(copy, 'Workforce Look-Up', new Error('lookup.meta.json lists no ' + key)); return; }
      var url = 'data/' + info.path;
      return fetch(OPM.shell.asset(url)).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })
        .then(function (buf) { return root.OPMParquet.parquetReadObjects({ file: buf, compressors: root.OPMParquet.compressors }); })
        .then(function (rows) {
          if (fileKey() !== key) return; // a newer choice is loading
          if (rows.length !== info.rows) console.warn('Workforce Look-Up: ' + key + ' has ' + rows.length + ' rows, the meta says ' + info.rows);
          var cols = LU.columns(info.dataset);
          var titles = { component: {}, occupation: {} };
          rows.forEach(function (r) {
            if (r.agency_subelement_code && !titles.component[r.agency_subelement_code]) titles.component[r.agency_subelement_code] = r.agency_subelement;
            if (r.occupational_series_code && !titles.occupation[r.occupational_series_code]) titles.occupation[r.occupational_series_code] = r.occupational_series;
          });
          // the previous file's rows are dropped here: only one file is ever held (invariant 10)
          current = { key: key, dataset: info.dataset, rows: rows, cols: cols, titles: titles };
          current.options = LU.filterOptions(rows, info.dataset, optionLabel);
          current.index = LU.searchIndex(rows, cols, display);
          drawFilters();
          draw();
          OPM.page.loaded = key;
        }, function (e) { K.unavailable(copy, 'Workforce Look-Up', e); });
    }

    function syncSnapshotField() { snapField.hidden = state.dataset !== 'employment'; }
    datasetSel.addEventListener('change', function () { state.dataset = datasetSel.value; state.filters = {}; state.sort = defaultSort(state.dataset); state.page = 1; syncSnapshotField(); load(); });
    snapSel.addEventListener('change', function () { state.snapshot = snapSel.value; state.filters = {}; state.sort = null; state.page = 1; load(); });
    var searchTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.search = searchInput.value; state.page = 1; draw(); }, 150);
    });
    clearBtn.addEventListener('click', function () {
      state.filters = {}; state.search = ''; searchInput.value = ''; state.page = 1;
      Object.keys(filterSelects).forEach(function (k) { filterSelects[k].value = ''; });
      draw();
    });
    groupSel.addEventListener('change', function () { state.groupBy = groupSel.value; draw(); });
    dlBtn.addEventListener('click', function () {
      if (!current) return;
      var csv = LU.toCsv(current.dataset, current.rows, last.idx);
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = LU.csvName(current.dataset, current.dataset === 'employment' ? current.key.replace('employment_', '') : null);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });

    syncSnapshotField();
    OPM.page = { state: state, meta: meta, last: last, current: function () { return current; }, draw: draw, ready: true, loaded: null };
    load();
  }
})(typeof self !== 'undefined' ? self : this);
