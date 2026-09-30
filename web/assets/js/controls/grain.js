/* Time-grain control: month, fiscal quarter, fiscal year. A radio group of buttons.
   Pure state lives in the exported helpers; render() is the only part that needs a DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.grain = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OPTIONS = ['month', 'quarter', 'fy'];
  var DEFAULT = 'month';

  function normalize(v) { return OPTIONS.indexOf(v) >= 0 ? v : DEFAULT; }

  /* Keyboard movement inside the group: arrows wrap, Home and End jump. */
  function step(current, key) {
    var i = OPTIONS.indexOf(normalize(current)), n = OPTIONS.length;
    if (key === 'ArrowRight' || key === 'ArrowDown') return OPTIONS[(i + 1) % n];
    if (key === 'ArrowLeft' || key === 'ArrowUp') return OPTIONS[(i - 1 + n) % n];
    if (key === 'Home') return OPTIONS[0];
    if (key === 'End') return OPTIONS[n - 1];
    return null;
  }

  /* copy = copy.controls.grain: { label, options: { month, quarter, fy } } */
  function render(container, opts) {
    var h = self.OPM.dom.h, labelId = self.OPM.dom.id('grain');
    var state = normalize(opts.value);
    var buttons = {};
    var group = h('div', { class: 'opm-choices', role: 'radiogroup', 'aria-labelledby': labelId });
    OPTIONS.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'opm-choice', role: 'radio', 'data-value': o, text: opts.copy.options[o] });
      b.addEventListener('click', function () { set(o, true); });
      b.addEventListener('keydown', function (ev) {
        var next = step(state, ev.key);
        if (next) { ev.preventDefault(); set(next, true); buttons[next].focus(); }
      });
      buttons[o] = b;
      group.appendChild(b);
    });
    var wrap = h('div', { class: 'opm-field opm-field--grain' }, [h('span', { class: 'opm-field__name', id: labelId, text: opts.copy.label }), group]);
    container.appendChild(wrap);

    function paint() {
      OPTIONS.forEach(function (o) {
        var on = o === state;
        buttons[o].setAttribute('aria-checked', on ? 'true' : 'false');
        buttons[o].tabIndex = on ? 0 : -1;
      });
    }
    function set(v, fromUser) {
      var n = normalize(v);
      if (n === state && fromUser) return;
      state = n; paint();
      if (fromUser && opts.onChange) opts.onChange(state);
    }
    paint();
    return { el: wrap, get: function () { return state; }, set: function (v) { set(v, false); } };
  }

  return { OPTIONS: OPTIONS, DEFAULT: DEFAULT, normalize: normalize, step: step, render: render };
});
