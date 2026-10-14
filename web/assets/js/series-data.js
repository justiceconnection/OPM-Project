/* Loading the job series cubes for a page: the meta once, then one entity's file when needed, cached.
   doj_core_series and doj_leaving_series are published as data/<cube>.meta.json and data/<cube>/<entity>.json
   (paths from the meta's files map). Each file holds every series group of its entity; the page picks one group.
   Each page passes the meta URLs it reads, so the copy audit sees exactly the files a page names. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  /* metaUrls maps each cube name to the URL of its meta (under data/) */
  function create(metaUrls) {
    var META = metaUrls;
    var metas = {}, files = {};
    function meta(cube) { return metas[cube] || (metas[cube] = K.getJson(META[cube])); }
    /* rows of one entity's file (all groups), as row objects */
    function entity(cube, e) {
      var key = cube + ':' + e;
      if (!files[key]) {
        files[key] = meta(cube).then(function (m) {
          var f = m.files && m.files[e];
          if (!f) throw new Error(cube + ' meta lists no file for ' + e);
          return K.getJson('data/' + f.path);
        }).then(function (file) {
          if (file.entity !== e) throw new Error(cube + ': file for ' + e + ' holds ' + file.entity);
          return OPM.data.fromCube(file);
        });
        files[key].catch(function () { delete files[key]; });
      }
      return files[key];
    }
    /* the rows of one group for several entities: { rows, meta } (an entity without the group adds no rows) */
    function group(cube, entities, g) {
      return meta(cube).then(function (m) {
        var want = entities.filter(function (e) { return OPM.series.present(m, e, g); });
        return Promise.all(want.map(function (e) { return entity(cube, e); })).then(function (lists) {
          var rows = [];
          lists.forEach(function (l) { Array.prototype.push.apply(rows, OPM.series.pick(l, g)); });
          return { rows: rows, meta: m };
        });
      });
    }
    return { meta: meta, entity: entity, group: group };
  }
  /* the control's signed labels: "Job series", "All job series", the 15 names (shown as "Name (code)"), "All other job series" */
  function controlCopy(copy) {
    var names = {};
    OPM.series.CODES.forEach(function (c) { names[c] = copy.t('series_names:' + c); }); // copy-audit: series_names:*
    return { label: copy.t('shell:ctl.series'), allLabel: copy.t('shell:ctl.series.all'), otherLabel: copy.t('shell:ctl.series.other'), names: names };
  }
  OPM.seriesData = { create: create, controlCopy: controlCopy };
})(typeof self !== 'undefined' ? self : this);
