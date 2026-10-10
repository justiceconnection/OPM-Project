# Spec addendum: Job series filter

Status: container signed (D-061); list, grains and depth signed (D-062). Contents and copy signed (D-063; series.ytdOnly updated in D-070). Applies to Workforce size, Hiring and departures, Components compared and Who is leaving; each page's own
spec stays in force except where this addendum changes it.

## 1. The control
| Item | Rule |
|---|---|
| Label | "Job / Job number" |
| Options | "All job series" (default), then the 15 series in D-062 order, then "All other job series" |
| Placement | Next to the Component selector (Components compared has no component selector: placed with the View control) |
| Combines with | The component selector, every View, every rate method (D-062: all views allowed) |
| Data | `doj_core_series` (per entity) and, on Who is leaving, `doj_leaving_series` (per entity, fiscal years only); "All job series" keeps reading today's cubes |

Choosing a series reloads only that component's series file; no figure is computed from other series.

## 2. Page by page
### Workforce size
All four panels follow the selected series. Panel 4 (by component) shows the components' counts within the series;
components with no one in the series are listed as "no employees in this job series". The known-break markers stay
(they are DOJ-wide facts; the note applies to all series).

### Hiring and departures
All five panels follow the selected series. Small groups show the small-base flag as usual (shown, not hidden).

### Components compared
All four panels compare components within the selected series. A component with no one in the series in the chosen
period is listed with "no employees in this job series" and no rates. Growth since a start year: a component with
no one in the series at the end of the start year has no line (no base to index from), listed below the chart.

### Who is leaving
- Tiles and the years-of-service, age and supervisor panels follow the selected series.
- With a series selected, the View is Yearly only (D-062); "Last 12 months" is shown disabled with a note.
- The occupation panel is hidden while a series is selected (it would show one group).
- Years of experience lost follows the series through `doj_core_series`.

## 3. Copy (signed, D-063)
### Control and notes
| Key | Text |
|---|---|
| ctl.series | Job series |
| ctl.series.all | All job series |
| ctl.series.other | All other job series |
| series.none | no employees in this job series |
| series.ytdOnly | Breakdowns by jobs are available by fiscal year or by administration. |
| series.growthNoBase | No line: no employees in this job series at the end of {year}. |

### Series names (shown as "Name (code)")
| Code | Name |
|---|---|
| 0905 | Attorneys |
| 1811 | Criminal investigators |
| 0007 | Correctional officers |
| 0301 | Administration and program staff |
| 0132 | Intelligence specialists |
| 0343 | Management and program analysts |
| 1801 | Inspection, investigation and compliance staff |
| 2210 | IT specialists |
| 0303 | Clerks and assistants |
| 0101 | Social scientists |
| 0950 | Paralegals |
| 0901 | Legal administration staff |
| 0006 | Correctional administrators |
| 0201 | Human resources specialists |
| 7404 | Cooks |

The first three match the signed Who is leaving occupation names (D-044).
