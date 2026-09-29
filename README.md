# OPM-Project - DOJ workforce data

Local database and (soon) dashboard built from the OPM Federal Workforce Data (FWD) files:
Employment, Accessions and Separations, Oct 2011 to Jul 2026, current file versions.

## Layout
| Folder | What it holds | In git? |
|---|---|---|
| `data/` | The 534 Parquet files from the OPM API (plus the original Separations TXT files) and `opm_manifest.json` | No (about 12 GB) |
| `warehouse/` | `opm.duckdb`, the local database (about 1 GB) | No |
| `pipeline/` | `build_db.py`, which builds and refreshes the database | Yes |

## Tables and views in `warehouse/opm.duckdb`
| Object | What it is |
|---|---|
| `doj_employment`, `doj_accessions`, `doj_separations` | DOJ-only rows, typed, stored in the database (fast) |
| `doj_monthly` | DOJ headcount, accessions, separations and net flow per month |
| `employment`, `accessions`, `separations` | Government-wide typed views (read the Parquet files on the fly) |
| `raw_employment`, `raw_accessions`, `raw_separations` | The files exactly as published (all text) |
| `files` | Manifest: every source file with version, publish date, size |
| `load_log` | Which files have been loaded into the `doj_*` tables |

**Open the database with the working directory set to this folder** (`OPM-Project`). The views read
`data/...` by relative path, so they only find the files from here. The `doj_*` tables work from anywhere.

## Conventions
- `period` = the month of the source file (first of month). One row = one person (`count` is always 1).
- `REDACTED` is kept distinct from missing: numeric/date fields become NULL when redacted and get a
  `<field>_redacted` = true flag. Text fields keep the literal `REDACTED`.
- DOJ is identified by `is_doj` (department_code = 'DJ' from 2015 on; agency_code = 'DJ' before 2015,
  when department_code did not exist).
- In accessions/separations, `period` is the month OPM processed the action and
  `personnel_action_effective_date_month` is the month it took effect. The dashboard will count by effective month.

## Refreshing
1. Download new or reissued Parquet files into `data/<Dataset>/` and update `data/opm_manifest.json`.
2. Run `python3 pipeline/build_db.py` until it prints `ALL LOADED`. It only loads what is new and drops superseded versions.
