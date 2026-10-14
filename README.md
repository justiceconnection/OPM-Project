# DOJ Workforce Dashboard

A dashboard of the U.S. Department of Justice workforce, built from the U.S. Office of Personnel Management's
[Federal Workforce Data](https://data.opm.gov/get-data/api-access) (Employment, Accessions and Separations, October
2011 onward). Published by Justice Connection.

Live: https://justiceconnection.github.io/OPM-Project/

It shows how many people DOJ and its components employ, who joins and who leaves and why, how departures compare
across administrations, appointment types, and a row-level Look-Up of every DOJ hire and departure exactly as OPM
published them. The "Reading the data" page explains the sources, definitions and known data issues.

## Layout
| Folder | What it holds |
|---|---|
| `web/` | The static site (HTML, CSS, plain JavaScript, Chart.js), its tests and tools. See `web/README.md`. |
| `web/data/` | The published data the site reads: aggregate cubes (JSON) and the Look-Up files (Parquet). |
| `pipeline/` | Python scripts that build the local DuckDB database, the cubes and the Look-Up files, plus the code crosswalks. |
| `tests/gate.py` | Data checks: every cube figure is recomputed independently from the source files. Needs the full local data. |
| `docs/` | The metric definitions (`metric-spec.md`), page specifications (`docs/pages/`) and hosting notes. |

The source files (about 12 GB) and the database (about 1 GB) are not in the repository. They are rebuilt from the OPM
API.

## Rebuilding the data
1. Download the current Employment, Accessions and Separations Parquet files from the OPM API
   (`GET https://data.opm.gov/api/v1/files/{employment|accessions|separations}`, then
   `/api/v1/files/{dataset}/{year}/{month}/{version}/download`) into `data/<Dataset>/`, and record them in
   `data/opm_manifest.json`.
2. Create a Python environment with DuckDB (`python3 -m venv .venv && .venv/bin/pip install duckdb`).
3. Run `.venv/bin/python pipeline/build_db.py` until it prints `ALL LOADED`. It is resumable: it loads what is new,
   drops superseded file versions, then builds the cubes and the Look-Up files into `warehouse/`.
4. Run `.venv/bin/python tests/gate.py` to check the results.

Query the database with the working directory set to the repository root: its views read `data/...` by relative path.

## How the numbers are counted
- One row in OPM's files is one person. There is no person identifier, so nobody is followed across months.
- DOJ is identified by `department_code = 'DJ'` from January 2015 and `agency_code = 'DJ'` before.
- Headcount is a stock: a quarter or a year shows its last month, never a sum. Hires and departures are flows, counted
  in the month the action took effect, not the month OPM processed it. Rates are ratios of sums.
- Years are federal fiscal years (October to September). The newest three months are marked provisional.
- Redacted values are never imputed: numeric fields become NULL with a `<field>_redacted` flag, and text fields keep
  OPM's literal `REDACTED`.
- Rates based on fewer than 30 employees on average are shown with a small-base flag, not hidden.

Full definitions: `docs/metric-spec.md`. Known OPM data issues and how they are handled: the site's "Reading the data"
page.

## License
The code is licensed under the Apache License 2.0 (see `LICENSE`). The data is published by the U.S. Office of
Personnel Management.
