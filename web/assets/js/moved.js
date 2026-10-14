/* The "this page has moved" note (docs/pages/redesign.md section 1, D-072) on Departures and Components, shown when
   an old address sent the reader here (moved-redirect.js adds ?moved=<old page id>). Overview never shows it, so it
   does not load this file. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  var FROM = ['hiring-and-departures', 'who-is-leaving', 'components-compared'];
  /* pageName: the signed name of this page (shell:nav.departures or shell:nav.components) */
  function show(copy, pageName) {
    var m = /[?&]moved=([a-z-]+)/.exec(root.location.search);
    if (!m || FROM.indexOf(m[1]) < 0) return null;
    var p = OPM.dom.h('p', { class: 'opm-moved', role: 'status', 'data-moved': m[1], text: copy.t('shell:moved.note', { page: pageName }) });
    var h1 = document.querySelector('h1');
    h1.parentNode.insertBefore(p, h1);
    return m[1];
  }
  OPM.moved = { show: show, FROM: FROM };
})(typeof self !== 'undefined' ? self : this);
