/* Time-grain control: fiscal year, fiscal quarter, month, in that order (D-033). A radio group of
   buttons with an optional note under it.
   Pure state lives in the exported helpers; render() is the only part that needs a DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.grain = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OPTIONS = ['fy', 'quarter', 'month']; // left to right (D-033)
  var DEFAULT = 'fy'; // D-029: the dashboard opens at fiscal-year grain

  function normalize(v) { return OPTIONS.indexOf(v) >= 0 ? v : DEFAULT; }

  /* Keyboard movement inside the group: arrows wrap, Home and End jump. values: the options shown
     (default all three; a page may offer fewer, e.g. Who is leaving: fy and t12). */
  function step(current, key, values) {
    var list = values || OPTIONS, i = list.indexOf(current), n = list.length;
    if (i < 0) i = 0;
    if (key === 'ArrowRight' || key === 'ArrowDown') return list[(i + 1) % n];
    if (key === 'ArrowLeft' || key === 'ArrowUp') return list[(i - 1 + n) % n];
    if (key === 'Home') return list[0];
    if (key === 'End') return list[n - 1];
    return null;
  }

  /* opts.copy: { label, options: { fy, quarter, month }, note (optional) } */
  function render(container, opts) {
    var h = self.OPM.dom.h, labelId = self.OPM.dom.id('grain');
    var values = opts.values || OPTIONS;
    var fix = function (v) { return values.indexOf(v) >= 0 ? v : values[0]; };
    var state = opts.values ? fix(opts.value) : normalize(opts.value);
    var buttons = {}, disabled = {};
    var group = h('div', { class: 'opm-choices', role: 'radiogroup', 'aria-labelledby': labelId });
    values.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'opm-choice', role: 'radio', 'data-value': o, text: opts.copy.options[o] });
      b.addEventListener('click', function () { if (!disabled[o]) set(o, true); });
      b.addEventListener('keydown', function (ev) {
        var next = step(state, ev.key, values);
        if (next && disabled[next]) next = step(next, ev.key, values); // skip a disabled option
        if (next) { ev.preventDefault(); set(next, true); buttons[next].focus(); }
      });
      buttons[o] = b;
      group.appendChild(b);
    });
    var note = null;
    if (opts.copy.note) {
      var noteId = self.OPM.dom.id('grain-note');
      note = h('p', { class: 'opm-field__note', id: noteId, text: opts.copy.note });
      group.setAttribute('aria-describedby', noteId);
    }
    var wrap = h('div', { class: 'opm-field opm-field--grain' }, [h('span', { class: 'opm-field__name', id: labelId, text: opts.copy.label }), group, note]);
    container.appendChild(wrap);

    function paint() {
      values.forEach(function (o) {
        var on = o === state;
        buttons[o].setAttribute('aria-checked', on ? 'true' : 'false');
        buttons[o].tabIndex = on ? 0 : -1;
      });
    }
    function set(v, fromUser) {
      var n = opts.values ? fix(v) : normalize(v);
      if (n === state && fromUser) return;
      state = n; paint();
      if (fromUser && opts.onChange) opts.onChange(state);
    }
    paint();
    /* disable one option (e.g. Last 12 months while a job series is selected on Who is leaving) */
    function disable(v, on) {
      disabled[v] = !!on;
      if (buttons[v]) { buttons[v].disabled = !!on; buttons[v].setAttribute('aria-disabled', on ? 'true' : 'false'); }
    }
    return { el: wrap, get: function () { return state; }, set: function (v) { set(v, false); }, disable: disable };
  }

  return { OPTIONS: OPTIONS, DEFAULT: DEFAULT, normalize: normalize, step: step, render: render };
});
