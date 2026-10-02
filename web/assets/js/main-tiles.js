/* The tiles of Overview and Departures (docs/pages/redesign.md section 4): a figure at month N with one
   "{admin} at this point: {value}" line per compared administration. Components has no tiles and does not load this file. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  /* A tile: name, value, an optional sub line, then one "{admin} at this point: {value}" line per compared administration. */
  function tile(copy, el, parts) {
    var subs = (parts.subs || []).concat((parts.at || []).map(function (x) {
      return { text: copy.t('shell:tile.atThisPoint', { admin: OPM.mainKit.adminName(copy, x.id), value: x.text }), cls: 'opm-tile__at' };
    }));
    K.fillTile(el, { name: parts.name, badges: parts.badges, value: parts.value, subs: subs });
    Array.prototype.forEach.call(el.querySelectorAll('.opm-tile__at'), function (p, i) { p.setAttribute('data-admin', parts.at[i].id); });
  }

  OPM.mainKit.tile = tile;
})(typeof self !== 'undefined' ? self : this);
