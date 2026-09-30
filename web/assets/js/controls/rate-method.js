/* Rate-method selector hook (D-019). Three methods; A, trailing 12 months, is the default.
   Method ids match the cube's columns: <measure>_<id>_num over rate_<id>_den.
   The browser does not compute any method: each is a precomputed numerator and denominator.
   Method names on the page are copy and are NOT signed yet (metric-spec section 7). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.rateMethod = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var METHODS = [
    { id: 'a', grains: ['month', 'quarter', 'fy'] }, // A: trailing 12 months, default
    { id: 'b', grains: ['fy'] },                     // B: fiscal year only; no rate at month or quarter
    { id: 'c', grains: ['month', 'quarter', 'fy'] }  // C: annualized per period
  ];
  var DEFAULT = 'a';

  function ids() { return METHODS.map(function (m) { return m.id; }); }
  function normalize(v) { return ids().indexOf(v) >= 0 ? v : DEFAULT; }
  function availableAt(method, grain) {
    var m = METHODS.filter(function (x) { return x.id === method; })[0];
    return !!m && m.grains.indexOf(grain) >= 0;
  }

  /* opts.copy: { label, options: { a, b, c }, help: { a, b, c } (optional, shown under the select) } */
  function render(container, opts) {
    var h = self.OPM.dom.h, id = self.OPM.dom.id('rate');
    var state = normalize(opts.value);
    var sel = h('select', { id: id });
    METHODS.forEach(function (m) { sel.appendChild(h('option', { value: m.id, text: opts.copy.options[m.id] })); });
    sel.value = state;
    var help = null;
    if (opts.copy.help) {
      var helpId = self.OPM.dom.id('rate-help');
      help = h('p', { class: 'opm-field__note opm-field__note--wide', id: helpId, 'aria-live': 'polite' });
      sel.setAttribute('aria-describedby', helpId);
    }
    function paintHelp() { if (help) help.textContent = opts.copy.help[state]; }
    sel.addEventListener('change', function () {
      state = normalize(sel.value);
      paintHelp();
      if (opts.onChange) opts.onChange(state);
    });
    var wrap = h('div', { class: 'opm-field opm-field--rate' }, [h('label', { for: id, class: 'opm-field__name', text: opts.copy.label }), sel, help]);
    paintHelp();
    container.appendChild(wrap);
    return { el: wrap, get: function () { return state; }, set: function (v) { state = normalize(v); sel.value = state; paintHelp(); } };
  }

  return { METHODS: METHODS, DEFAULT: DEFAULT, ids: ids, normalize: normalize, availableAt: availableAt, render: render };
});
