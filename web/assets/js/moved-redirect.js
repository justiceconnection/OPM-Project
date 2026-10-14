/* The old page addresses (docs/pages/redesign.md section 1, D-072): hiring-and-departures.html and who-is-leaving.html
   open Departures, components-compared.html opens Components, so Framer embeds and bookmarks keep working. The old
   page is replaced in the history (location.replace: no extra Back step, no refresh loop, since the new pages never
   redirect) and the new page shows the signed "this page has moved" note (assets/js/moved.js). The hash is kept.
   A relative address, so it works under any base path. */
(function (root) {
  'use strict';
  var TARGET = { 'hiring-and-departures': 'departures.html', 'who-is-leaving': 'departures.html', 'components-compared': 'components.html' };
  var from = root.document.body.getAttribute('data-moved');
  if (TARGET[from]) root.location.replace(TARGET[from] + '?moved=' + from + root.location.hash);
})(typeof self !== 'undefined' ? self : this);
