'use strict';
/* Where the tests find their real-data inputs. warehouse/, data/ and .venv are local only (not in git); web/data
   holds the promoted copies (in git). A test uses the staged files when they are present, else the promoted
   copies, else it skips. OPM_NO_LOCAL_DATA=1 hides the local-only inputs, to check that the suite runs as it
   does in the GitHub workflow. Not a test file itself (no .test.js). */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const WEB = path.join(REPO, 'web');
const HIDE = process.env.OPM_NO_LOCAL_DATA === '1';

function local(p) { return !HIDE && fs.existsSync(p) ? p : null; }
function present(p) { return fs.existsSync(p) ? p : null; }

/* the directory with doj_core.json, doj_core.meta.json, doj_leaving.meta.json and doj_leaving/ */
function cubesDir() {
  return local(path.join(REPO, 'warehouse', 'cubes')) || (present(path.join(WEB, 'data', 'doj_core.json')) ? path.join(WEB, 'data') : null);
}
/* the Look-Up meta, and the directory its file paths (lookup/<name>.parquet) are relative to */
function lookup() {
  if (local(path.join(REPO, 'warehouse', 'lookup', 'lookup.meta.json'))) return { meta: path.join(REPO, 'warehouse', 'lookup', 'lookup.meta.json'), base: path.join(REPO, 'warehouse'), where: 'warehouse/lookup' };
  if (present(path.join(WEB, 'data', 'lookup.meta.json'))) return { meta: path.join(WEB, 'data', 'lookup.meta.json'), base: path.join(WEB, 'data'), where: 'web/data/lookup' };
  return null;
}
function venvPython() { return local(path.join(REPO, '.venv', 'bin', 'python')); }

module.exports = { REPO, WEB, HIDE, local, cubesDir, lookup, venvPython };
