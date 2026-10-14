/* A tiny element builder. Text is always set with textContent, never parsed as HTML. */
(function (root) {
  'use strict';
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  var uid = 0;
  function id(prefix) { uid += 1; return (prefix || 'opm') + '-' + uid; }
  root.OPM = root.OPM || {};
  root.OPM.dom = { h: h, id: id };
})(typeof self !== 'undefined' ? self : this);
