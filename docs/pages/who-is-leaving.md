# Page spec: Who is leaving

Status: signed (container D-042; contents and copy D-044; occupation order D-043). Data: `doj_leaving` (not yet
promoted) and `doj_core` (promoted). The browser picks rows, sums columns (across periods only for flow and
stock_change kinds) and divides.

## 1. Data delivery
`doj_leaving` is 10.4 MB as one file. It is published as one file per entity: `data/doj_leaving/<entity>.json`
(DOJ and 12 components, about 0.8 MB each) plus one shared `data/doj_leaving.meta.json`. The page loads only the
selected component's file. Promotion covers the whole set under one decision; the gate checks each file.

## 2. Controls
| Control | Values | Default |
|---|---|---|
| Component | As on the other pages | DOJ |
| View | Yearly, Last 12 months (no quarterly or monthly, D-031) | Last 12 months |
| Period | Yearly: FY2012 to latest (partial marked). Last 12 months: each month end from Sep 2012 | Latest |

The View control on this page offers only the two allowed options. The date range control is not used.

## 3. Panels and contents

### Panel 1: tiles, for the chosen period
| Tile | Value | Source |
|---|---|---|
| Departures | Departures in the period; below it, the same period a year earlier | `doj_leaving`, any one dimension's values summed (they partition) |
| Years of experience lost | Sum of length of service across departures, with coverage | `doj_core`: FY row, or the 12 month rows summed (`years_of_service_lost`, `yos_known`, `departures`) |
| Average years per departure | Years lost / departures with a known length of service | same rows, ratio of sums |

Coverage shows as "based on {pct} of departures" when below 100%. Provisional badge when the period contains a
provisional month; partial marker for a partial fiscal year.

### Panels 2 to 5: one per dimension (length of service, age, supervisors vs others, occupation)
Each panel has two parts.
- **Snapshot.** Horizontal bars of the departure rate per group for the chosen period, with a lighter bar for the
  same period a year earlier (previous fiscal year, or the 12 months ending a year earlier). Each bar is labeled
  with its rate and departures ("40.5% · 2,615 left"). Groups in signed order; occupations list attorneys, then criminal investigators, then correctional officers, then
  all other (D-043).
  - Unknown is not a bar: a line under the chart reads the Unknown count (length of service; age and
    supervisory when non-zero).
  - Not applicable (no one in that group at this component): the group is listed with "not applicable", no bar.
  - Small base: bar drawn hatched with the small-base note.
- **Trend.** One line per group: the departure rate at each period of the chosen View (every fiscal year, or every
  month end for Last 12 months), straight segments, legend toggles. The chosen period is marked with a vertical
  rule. For age (10 groups), lines start with all shown; the legend allows isolating one.

Partial fiscal years under Yearly are year to date (D-023) and say so.

## 4. Flags on this page
| Flag | Treatment |
|---|---|
| Provisional | Tile badge; dashed trend segment; note |
| Partial / year to date | Marker and note |
| Small base | Hatched bar, hollow trend point, note |
| Not applicable | Text label, no bar, gap in trend |
| Unknown | Count line under the snapshot; never a rate |
| Coverage | On the years-lost tile and under the length-of-service panel when below 100% |

## 5. Copy (signed, D-044)
Reused signed keys: component names, View "Yearly", period formats, "(partial)", the provisional sentence, the
small-base note and the year-so-far note. New keys:

| Key | Text |
|---|---|
| page.intro | Who leaves the Justice Department: by years of service, age, supervisory role and occupation, from OPM's federal workforce data. |
| ctl.view.t12 | Last 12 months |
| ctl.period | Period |
| ctl.period.t12 | 12 months ending {month} |
| tile.departures | Departures |
| tile.yearsLost | Years of experience lost |
| tile.avgYears | Average years of service per departure |
| tile.prior | Year before: {value} |
| tile.coverage | Based on {pct} of departures with a known length of service. |
| panel.los.title | By years of service |
| panel.age.title | By age |
| panel.sup.title | Supervisors and managers vs. everyone else |
| panel.occ.title | By occupation |
| group.los.lt1 | Under 1 year |
| group.los.1_4 | 1 to 4 years |
| group.los.5_9 | 5 to 9 years |
| group.los.10_19 | 10 to 19 years |
| group.los.20_24 | 20 to 24 years |
| group.los.25_29 | 25 to 29 years |
| group.los.30plus | 30 years or more |
| group.age.under25 | Under 25 |
| group.age.65plus | 65 or older |
| group.age.range | {lo} to {hi} |
| group.sup.supervisor | Supervisors and managers |
| group.sup.other | Everyone else |
| group.occ.0905 | Attorneys |
| group.occ.1811 | Criminal investigators |
| group.occ.0007 | Correctional officers |
| group.occ.other | All other occupations |
| bar.label | {rate} · {count} left |
| bar.prior | Year before |
| unknown.line | {count} departures with unknown {dimension} are counted in the total but not shown as a group. |
| notApplicable | not applicable: no employees in this group |
| chart.snapshot.note | Departure rate: share of the group's average number of employees who left in the period. |
| chart.trend.title | Over time |
| dim.los | years of service |
| dim.age | age |
| dim.sup | supervisory status |
