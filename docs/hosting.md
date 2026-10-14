# Hosting the dashboard (GitHub Pages and Framer)

The site is the `web/` folder. It goes live at **https://justiceconnection.github.io/OPM-Project/**.
A workflow in `.github/workflows/pages.yml` tests and publishes it on every push to `main`.

## 1. Turn on GitHub Pages (once)
1. On GitHub, open the repository **justiceconnection/OPM-Project**.
2. Go to **Settings > Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or open **Actions > Deploy the dashboard to GitHub Pages > Run workflow**).

The workflow runs the web unit tests, collects `web/` (without screenshots, tests and dev tools) and publishes it.
If a test fails, nothing is published and the live site stays as it was.

## 2. Check the live site
- Open **Actions** and wait for the run to show a green check. The deploy step links to the site.
- Open https://justiceconnection.github.io/OPM-Project/ and click through every page.
- The footer shows "Last updated: <date>. OPM data through <month>." The date comes from the build stamp, which
  should match `web/build-stamp.json` in the commit you pushed (each page also carries it in
  `<meta name="opm-build">`). If the page still shows an older date, reload once; GitHub can take a minute or two.

Page addresses:

| Page | Address |
|---|---|
| Overview | https://justiceconnection.github.io/OPM-Project/index.html |
| Hires and departures | https://justiceconnection.github.io/OPM-Project/departures.html |
| Components | https://justiceconnection.github.io/OPM-Project/components.html |
| Appointments | https://justiceconnection.github.io/OPM-Project/appointments.html |
| Workforce Look-Up | https://justiceconnection.github.io/OPM-Project/workforce-lookup.html |
| Reading the data | https://justiceconnection.github.io/OPM-Project/reading-the-data.html |

## 3. Embed a page in Framer
**An existing Justice Connection dashboard embed works unchanged.** Copy that Embed component on the Framer page and
change only its address to the OPM page you want (table above). The pages send the message those embeds listen for,
`{ type: 'lions-dashboard-height', height: <pixels> }`, whenever their height changes, up or down, so the frame
grows and shrinks to fit with no inner scroll bar.

Each page also sends `{ type: 'opm:height', height: <pixels>, page: '<page id>' }`. As an alternative to that
embed, add an **Embed** component, choose **HTML**, and paste the block below, changing the `src` to the page you
want (one Embed per page). Give the Embed component a width of Fill and a height of Fit content if Framer offers it;
otherwise set a generous fixed height.

```html
<iframe id="opm-frame"
  src="https://justiceconnection.github.io/OPM-Project/index.html"
  title="DOJ workforce dashboard"
  style="width:100%;height:1200px;border:0;display:block"
  loading="lazy"></iframe>
<script>
  (function () {
    var SITE = 'https://justiceconnection.github.io';
    var frame = document.getElementById('opm-frame');
    // set the frame height from the page's message
    window.addEventListener('message', function (ev) {
      if (ev.origin !== SITE || ev.source !== frame.contentWindow) return;
      if (ev.data && ev.data.type === 'opm:height' && ev.data.height > 0) frame.style.height = ev.data.height + 'px';
    });
    // ask again after the frame loads and when the window is resized
    function ask() { frame.contentWindow.postMessage({ type: 'opm:height-request' }, SITE); }
    frame.addEventListener('load', ask);
    window.addEventListener('resize', ask);
  })();
</script>
```

Notes:
- **Downloads.** The pages offer "Download SVG" and the Look-Up offers "Download CSV". The iframe above has no
  `sandbox` attribute, so downloads work. If Framer or anyone adds a `sandbox` attribute, it must include
  `allow-scripts allow-same-origin allow-downloads`, or the downloads and the height messages stop working.
- **Links between pages** (for example "Known gap; see Reading the data.") open inside the same frame.
- Check the published Framer page, not only the Framer editor: preview modes can block messages or downloads.
- With two embeds on one Framer page, give each iframe its own `id` and repeat the script with that id.

## 4. Refreshing the data
When OPM publishes new months: download the new files into `data/` and run `.venv/bin/python pipeline/build_db.py`
until it prints ALL LOADED (it also rebuilds the cubes and the Look-Up files in `warehouse/`). Run
`.venv/bin/python tests/gate.py` until every check passes (except `promoted_matches_staged` naming the refreshed
cubes as stale, which promotion clears), then promote the refreshed sets with
`.venv/bin/python pipeline/promote.py <cube> [<cube> ...] --decision <id>` (for example `doj_core`, `doj_core_series`,
`doj_admin`, `doj_leaving`, `doj_leaving_series`, `doj_joining`, `doj_joining_series`, `doj_appointments`, `lookup`).
`--decision` names the maintainers' approval record, which is kept outside this repository. Name every cube in one call
so they are gated and copied together; promotion copies the files into `web/data/` and bumps the build stamp. Run the
web tests (`node web/tests/smoke.mjs`, then `node --test 'web/tests/*.test.js'`), commit, and push: the push to
`main` publishes the new data.
