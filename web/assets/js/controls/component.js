/* Component selector: one select, DOJ first. Options come from OPM.workforce.componentOptions. */
(function (root) {
  'use strict';
  /* opts: { label, options: [{ value, label }], value, onChange } */
  function render(container, opts) {
    var h = root.OPM.dom.h, id = root.OPM.dom.id('component');
    var sel = h('select', { id: id });
    opts.options.forEach(function (o) { sel.appendChild(h('option', { value: o.value, text: o.label })); });
    sel.value = opts.value;
    sel.addEventListener('change', function () { if (opts.onChange) opts.onChange(sel.value); });
    var wrap = h('div', { class: 'opm-field opm-field--component' }, [h('label', { for: id, class: 'opm-field__name', text: opts.label }), sel]);
    container.appendChild(wrap);
    return { el: wrap, get: function () { return sel.value; }, set: function (v) { sel.value = v; } };
  }
  root.OPM = root.OPM || {};
  root.OPM.controls = root.OPM.controls || {};
  root.OPM.controls.component = { render: render };
})(typeof self !== 'undefined' ? self : this);
