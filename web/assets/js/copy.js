/* Copy access. Every visible string comes from copy.json through t(), which also records the
   key as used, so the page knows whether it shows any unsigned string (the draft badge).
   A reference is 'section:key', where section is 'shell', 'components', 'page' (the current
   page) or a page id. Pure; no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.copy = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? vars[k] : all; });
  }

  function createCopy(json, pageId) {
    var used = {};

    function sectionOf(name) {
      if (name === 'shell' || name === 'components') return json[name];
      if (name === 'page') return json.pages[pageId];
      return json.pages[name];
    }
    function canonical(name) { return name === 'page' ? pageId : name; }

    function split(ref) {
      var i = ref.indexOf(':');
      if (i < 0) throw new Error('copy ref needs a section: ' + ref);
      return { section: ref.slice(0, i), key: ref.slice(i + 1) };
    }

    function raw(ref) {
      var r = split(ref), sec = sectionOf(r.section);
      if (!sec || !(r.key in sec) || r.key === '_status') throw new Error('copy.json has no ' + ref);
      used[canonical(r.section) + ':' + r.key] = true;
      return sec[r.key];
    }

    /* Read a value without marking it used: for deciding whether to show something at all. */
    function peek(ref) {
      var r = split(ref), sec = sectionOf(r.section);
      return sec && r.key !== '_status' ? sec[r.key] : undefined;
    }

    function t(ref, vars) {
      var v = raw(ref);
      if (typeof v !== 'string') throw new Error('copy ' + ref + ' is not a string');
      return fill(v, vars);
    }

    function status(ref) {
      var r = split(ref), sec = sectionOf(r.section);
      return sec && sec._status ? sec._status[r.key] : undefined;
    }

    /* Used keys that are not signed, excluding the given refs (the badge's own text). */
    function unsignedUsed(exclude) {
      var skip = {};
      (exclude || []).forEach(function (e) { skip[e] = true; });
      return Object.keys(used).filter(function (k) { return !skip[k] && status(k) !== 'signed'; });
    }

    return { t: t, raw: raw, peek: peek, status: status, unsignedUsed: unsignedUsed, used: function () { return Object.keys(used); }, fill: fill };
  }

  return { createCopy: createCopy, fill: fill };
});
