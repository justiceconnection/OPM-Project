/* Component multi-select for the main pages (D-078): a button that names the choice ("All components", one component's
   name, or "{n} components") and opens a list headed "Choose components" with a checkbox per component and an "All
   components" reset. Community Relations Service cannot be combined: choosing it clears the others, and choosing another
   component clears it. Keyboard: Enter, Space or Down opens; arrows move between the options; Escape closes and returns
   to the button; Tab leaves. The old pages keep their single selector (controls/component.js).
   exclusive(list, code, exclusiveCodes) is pure. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.controls = root.OPM.controls || {}; root.OPM.controls.componentsMulti = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* The selection after toggling code: an exclusive code (CRS) stands alone; any other code clears it. [] = all. */
  function toggle(list, code, exclusive) {
    var on = list.indexOf(code) >= 0;
    if (on) return list.filter(function (c) { return c !== code; });
    if (exclusive.indexOf(code) >= 0) return [code];
    return list.filter(function (c) { return exclusive.indexOf(c) < 0; }).concat([code]);
  }

  /* opts: { label, header, allLabel, nLabel(n), options: [{ value, label }] (no DOJ), exclusive: [codes], value: [codes], onChange(list) } */
  function render(container, opts) {
    var dom = self.OPM.dom, h = dom.h, id = dom.id('components'), listId = dom.id('components-list'), headId = dom.id('components-head');
    var state = (opts.value || []).slice(), boxes = {};
    var btn = h('button', { type: 'button', id: id, class: 'opm-multi__button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': listId });
    var btnText = h('span', { class: 'opm-multi__text' });
    btn.appendChild(btnText);
    btn.appendChild(h('span', { class: 'opm-multi__caret', 'aria-hidden': 'true' }));
    var pop = h('div', { class: 'opm-multi__pop', id: listId, role: 'group', 'aria-labelledby': headId, hidden: true });
    pop.appendChild(h('p', { class: 'opm-multi__head', id: headId, text: opts.header }));
    // inside the list the arrows move (tabindex -1), so Tab leaves the list and closes it
    var allBtn = h('button', { type: 'button', class: 'opm-multi__all', 'aria-pressed': 'true', tabindex: '-1', text: opts.allLabel });
    pop.appendChild(allBtn);
    var list = h('ul', { class: 'opm-multi__list' });
    opts.options.forEach(function (o) {
      var box = h('input', { type: 'checkbox', value: o.value, id: dom.id('comp-opt'), tabindex: '-1' });
      boxes[o.value] = box;
      box.addEventListener('change', function () { set(toggle(state, o.value, opts.exclusive || []), true); });
      list.appendChild(h('li', null, [h('label', { class: 'opm-multi__opt', for: box.id, 'data-value': o.value }, [box, h('span', { text: o.label })])]));
    });
    pop.appendChild(list);
    var wrap = h('div', { class: 'opm-field opm-field--component opm-field--multi' }, [h('label', { for: id, class: 'opm-field__name', text: opts.label }),
      h('div', { class: 'opm-multi' }, [btn, pop])]);
    container.appendChild(wrap);

    function labelOf(v) { return opts.options.filter(function (o) { return o.value === v; })[0].label; }
    function paint() {
      btnText.textContent = !state.length ? opts.allLabel : state.length === 1 ? labelOf(state[0]) : opts.nLabel(state.length);
      Object.keys(boxes).forEach(function (v) { boxes[v].checked = state.indexOf(v) >= 0; });
      allBtn.setAttribute('aria-pressed', state.length ? 'false' : 'true');
    }
    function set(next, fromUser) {
      state = next.slice(); paint();
      if (fromUser && opts.onChange) opts.onChange(state.slice());
    }
    function focusables() { return [allBtn].concat(Object.keys(boxes).map(function (v) { return boxes[v]; })); }
    function open(focusFirst) {
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) { var f = focusables(), on = f.filter(function (x) { return x.checked; })[0]; (on || f[0]).focus(); }
    }
    function close(refocus) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); }
    btn.addEventListener('click', function () { if (pop.hidden) open(false); else close(false); });
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ((ev.key === 'Enter' || ev.key === ' ') && pop.hidden)) { ev.preventDefault(); open(true); }
    });
    pop.addEventListener('keydown', function (ev) {
      var f = focusables(), i = f.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); close(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); f[Math.min(f.length - 1, i + 1)].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i <= 0) close(true); else f[i - 1].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); f[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (ev.key === 'Tab') setTimeout(function () { if (!pop.contains(document.activeElement)) close(false); }, 0); // Tab moves on and closes the list
    });
    allBtn.addEventListener('click', function () { set([], true); });
    // a click or focus outside closes the list
    document.addEventListener('mousedown', function (ev) { if (!pop.hidden && !wrap.contains(ev.target)) close(false); });
    wrap.addEventListener('focusout', function (ev) { if (!pop.hidden && ev.relatedTarget && !wrap.contains(ev.relatedTarget)) close(false); });
    paint();
    return { el: wrap, get: function () { return state.slice(); }, set: function (v) { set(v, false); }, open: open, close: close, button: btn };
  }

  return { toggle: toggle, render: render };
});
