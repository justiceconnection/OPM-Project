# Page spec: Workforce Look-Up

Status: container signed (D-051); fields signed (D-052, readings D-053). Contents and copy signed (D-056). Data: the Look-Up files (`data/lookup/`), not the cubes. Invariant 10: OPM's release, never more: only
the signed fields, values as published (REDACTED kept), nothing inferred, no joins between files.

## 1. Data delivery and reading
- Files: `data/lookup/separations.parquet` (about 1.0 MB), `data/lookup/accessions.parquet` (0.65 MB),
  `data/lookup/employment_FY<yyyy>.parquet` (one per September, about 0.4 MB each) and
  `data/lookup/employment_latest.parquet` (only when the latest month is not a September), plus
  `data/lookup.meta.json` (file list, hashes, rows, source files and versions).
- The page loads only the file for the chosen dataset and snapshot.
- Reader: a small pure-JavaScript Parquet reader, vendored, no CDN (D-054).
- The browser filters, searches, counts and sorts the rows of one file. It never combines two files.

## 2. Controls
| Control | Values | Default |
|---|---|---|
| Dataset | Departures, Hires, Employees | Departures |
| Snapshot (Employees only) | September of each fiscal year FY2012 to latest, and the latest month when it is not a September | Latest |
| Filters | Component (signed display names, via the code); Fiscal year of the month the action took effect (Departures, Hires); Reason (Departures) or Hire type (Hires); Occupation (series number and title; 0905 and 1811 first, D-043, then by series number); Grade; Age bracket; Supervisory status | All |
| Search | Free text across the shown columns, case-insensitive | Empty |
| Group counts by | Any filter field | Component |

Filter values are the published values present in the loaded file. A "Clear filters" action resets filters and
search.

## 3. Contents
### 3a. Summary
"{count} matching records" and, below it, a small table of counts by the chosen "Group counts by" field (all
groups, largest first; scrolls if long). Counts are row counts of the filtered file: one record is one person-action
(Departures, Hires) or one person (Employees).

### 3b. Table
- One row per record, the signed columns in the order of D-052, with plain headings (copy below). Occupation shows
  the series number and OPM's title together, as published. Component shows the signed display name; the CSV keeps OPM's
  code and name.
- REDACTED shows as written. An empty published value shows as the empty-figure mark.
- KDI-001 rows (Departures, length of service 124 to 126 years in the Jun 2024 to Jul 2025 files): the value is
  shown unchanged with a marker linking to Reading the data `#known-gaps` (D-052).
- 50 rows per page with previous and next; sortable by any column; at 390 px the table scrolls inside its panel with
  the first column fixed.

### 3c. Download
"Download CSV" saves the filtered rows (all signed columns, in D-052 order, OPM column names as the header, values
exactly as published, UTF-8) as `doj-<dataset>-<snapshot or all>-filtered.csv`. A note under the button says what it
contains.

## 4. Copy (signed, D-056)
Reused signed keys: component names, period formats, the empty-figure mark, "Data not available."

| Key | Text |
|---|---|
| page.intro | Look up the individual records behind the dashboard: every Justice Department hire and departure since October 2011, and the employee list at the end of each fiscal year, exactly as OPM published them. |
| page.privacy | OPM publishes these records without names or personal identifiers. Where OPM withheld a value, it shows as REDACTED. |
| ctl.dataset | Records |
| ctl.dataset.separations | Departures |
| ctl.dataset.accessions | Hires |
| ctl.dataset.employment | Employees |
| ctl.snapshot | Employees as of |
| ctl.snapshot.sep | September {year} (end of FY{fy}) |
| ctl.snapshot.latest | {month} (latest) |
| ctl.filters | Filter |
| ctl.filter.component | Component |
| ctl.filter.fy | Fiscal year |
| ctl.filter.reason | Reason |
| ctl.filter.hireType | Hire type |
| ctl.filter.occupation | Occupation |
| ctl.filter.grade | Grade |
| ctl.filter.age | Age |
| ctl.filter.supervisory | Supervisory status |
| ctl.filter.all | All |
| ctl.search | Search |
| ctl.search.placeholder | Search these records |
| ctl.clear | Clear filters |
| ctl.groupBy | Count by |
| summary.count | {count} matching records |
| summary.none | No records match these filters. |
| col.component | Component |
| col.effective | Took effect |
| col.processed | Processed |
| col.reason | Reason |
| col.hireType | Hire type |
| col.drp | DRP |
| col.occupation | Occupation |
| col.payPlan | Pay plan |
| col.grade | Grade |
| col.age | Age |
| col.service | Years of service |
| col.supervisory | Supervisory status |
| col.appointment | Appointment type |
| col.tenure | Tenure |
| col.education | Education |
| col.veteran | Veteran |
| col.schedule | Work schedule |
| col.pay | Annual pay |
| col.state | Duty state |
| col.snapshot | As of |
| table.prev | Previous |
| table.next | Next |
| table.page | Page {page} of {pages} |
| kdi.marker | OPM recorded this length of service from 1900; see Reading the data. |
| download.button | Download CSV |
| download.note | Downloads the records that match your filters, with OPM's column names and values exactly as published. |
