/* Date-range control. Default: the full range the data covers, from Oct 2011.
   Presets: the administrations (D-065), built by page-controls.js from OPM.admin; with an empty list no
   preset row is drawn. */
(function (root, factory) {
  var periods = (typeof require === 'function' && typeof module === 'object')
    ? require('../periods.js') : root.OPM.periods;
  var api = factory(periods);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.range = api; }
})(typeof self !== 'undefined' ? self : this, function (periods) {
  'use strict';

  function defaultRange(bounds) { return { start: bounds.start, end: bounds.end }; }

  /* A preset is { id, label, start: 'YYYY-MM', end: 'YYYY-MM' | null }. A null end means
     "to the latest month". Returns only well-formed presets. */
  function validPresets(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) {
      return p && typeof p.id === 'string' && typeof p.label === 'string' && periods.isMonthKey(p.start) &&
        (p.end === null || p.end === undefined || (periods.isMonthKey(p.end) && p.end >= p.start));
    });
  }

  function presetRange(list, id, bounds) {
    var p = validPresets(list).filter(function (x) { return x.id === id; })[0];
    if (!p) return null;
    return periods.normalizeRange({ start: p.start, end: p.end || bounds.end }, bounds);
  }

  /* Which preset, if any, the current range equals. */
  function matchPreset(list, range, bounds) {
    var hit = validPresets(list).filter(function (p) {
      var r = presetRange(list, p.id, bounds);
      return r && r.start === range.start && r.end === range.end;
    })[0];
    return hit ? hit.id : null;
  }

  /* opts: { bounds, value, copy: copy.controls.range, fmt: period label formats, onChange } */
  function render(container, opts) {
    var h = self.OPM.dom.h, dom = self.OPM.dom;
    var bounds = opts.bounds;
    var state = periods.normalizeRange(opts.value, bounds);
    var presets = validPresets(opts.copy.presets);
    var months = periods.listMonths(bounds.start, bounds.end);

    function select(labelText) {
      var id = dom.id('range');
      var s = h('select', { id: id });
      months.forEach(function (m) { s.appendChild(h('option', { value: m, text: periods.periodLabel(m, opts.fmt) })); });
      var box = h('div', { class: 'opm-field' }, [h('label', { for: id, class: 'opm-field__name', text: labelText }), s]);
      return { box: box, sel: s };
    }
    var from = select(opts.copy.from), to = select(opts.copy.to);
    var presetRow = null, presetButtons = {};
    if (presets.length) {
      var plId = dom.id('presets');
      presetRow = h('div', { class: 'opm-field opm-field--presets' }, [h('span', { class: 'opm-field__name', id: plId, text: opts.copy.presetsLabel })]);
      var group = h('div', { class: 'opm-choices', role: 'group', 'aria-labelledby': plId });
      presets.forEach(function (p) {
        var b = h('button', { type: 'button', class: 'opm-choice', 'aria-pressed': 'false', text: p.label });
        b.addEventListener('click', function () { set(presetRange(presets, p.id, bounds), true); });
        presetButtons[p.id] = b; group.appendChild(b);
      });
      presetRow.appendChild(group);
    }
    var wrap = h('div', { class: 'opm-range' }, [from.box, to.box, presetRow]);
    container.appendChild(wrap);

    function onSelect() { set({ start: from.sel.value, end: to.sel.value }, true); }
    from.sel.addEventListener('change', onSelect);
    to.sel.addEventListener('change', onSelect);

    function paint() {
      from.sel.value = state.start; to.sel.value = state.end;
      var on = matchPreset(presets, state, bounds);
      Object.keys(presetButtons).forEach(function (id) {
        presetButtons[id].setAttribute('aria-pressed', id === on ? 'true' : 'false');
      });
    }
    function set(r, fromUser) {
      state = periods.normalizeRange(r, bounds); paint();
      if (fromUser && opts.onChange) opts.onChange({ start: state.start, end: state.end });
    }
    paint();
    return {
      el: wrap,
      get: function () { return { start: state.start, end: state.end }; },
      set: function (r) { set(r, false); },
      reset: function () { set(defaultRange(bounds), true); }
    };
  }

  return { defaultRange: defaultRange, validPresets: validPresets, presetRange: presetRange, matchPreset: matchPreset, render: render };
});
