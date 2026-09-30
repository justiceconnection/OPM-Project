# Page spec: Components compared

Status: signed (container D-046; contents and copy D-047). Data: `doj_core` only
(promoted). The browser picks rows, sums columns and divides one picked value by another.

## 1. Controls
| Control | Values | Default |
|---|---|---|
| View | Yearly, Quarterly, Monthly (D-033), with the fiscal-year note | Yearly (D-029) |
| Period | One period at the chosen View, latest first | Latest (FY2026, partial) |
| Rate based on | Last 12 months, Fiscal year, Annual pace (D-019, D-040), with help texts | Last 12 months |
| Start year (panel 3 only) | FY2012 to the year before the latest | FY2012 |

At the defaults (Yearly, FY2026, Last 12 months) every rate is the 12 months to the latest month. "Fiscal year"
is available only in the Yearly view; other views show the signed no-value message for rates. A partial fiscal
year under "Fiscal year" is year to date (D-023).

No component selector: every panel shows all components. DOJ overall is shown as the reference.

## 2. Components shown
The 11 current components always; Community Relations Service only when the chosen period falls within its
existence (to Apr 2026), labeled with its end month (signed `ctl.component.ended`). Components sorted by the
latest employee count unless a table column is sorted.

## 3. Panels and contents

### Panel 1: comparison table
One row per component for the chosen period, plus a DOJ row pinned at the top.

| Column | Value | Cube source |
|---|---|---|
| Employees | Period-end headcount | `headcount` |
| Change | Change over the period, and as a percent of the previous period's end | `headcount_change`; percent over the previous row's `headcount` |
| Hires | Hires in the period | `hires` |
| Departures | Departures in the period | `departures` |
| Departure rate | Chosen method | `attrition_<m>_num / rate_<m>_den` |
| Quit rate | Chosen method | `quit_<m>_num / rate_<m>_den` |
| Retirement rate | Chosen method | `retirement_<m>_num / rate_<m>_den` |

- Every column header sorts: number columns highest first, the Component column A to Z first (D-049); click
  again to reverse. DOJ stays on top.
- Small-base rates carry the small-base marker and note (only CRS today). Empty rates show the empty-figure mark.
- Provisional and partial periods: marker in the table caption.
- At 390 px the table scrolls horizontally inside its panel (the page itself never does), with the component column
  fixed.

### Panel 2: departure rate ranking
Horizontal bars of each component's departure rate for the chosen period and method, sorted highest first, with a
vertical reference line at DOJ overall. Each bar labeled with its rate. Small base: hatched bar with the note.

### Panel 3: growth since a start year
One line per component: employee count at each period of the chosen View divided by its count at the end of the
start year, times 100 (start = 100). DOJ overall as a thicker reference line. Straight segments, legend toggles,
provisional segments dashed. CRS stops at Apr 2026. The View's periods from the start year to the latest.

### Panel 4: why people left, by component
One 100% bar per component (and DOJ) for the chosen period: each of the six signed reasons as its share of the
component's departures (reason / departures). Same colors and order as Hiring and departures. The DRP share is not
shown here (it overlaps the reasons). Components with no departures in the period show "no departures".

## 4. Flags on this page
| Flag | Treatment |
|---|---|
| Provisional | Caption marker and the provisional sentence; dashed segments in panel 3 |
| Partial / year to date | Caption marker and note |
| Small base | Marker and note in panel 1, hatched bar in panel 2 |
| Ended component | CRS labeled with its end month |

## 5. Copy (signed, D-047)
Reused signed keys: component names, View control and note, period formats, "(partial)", rate selector names and
help texts, no-value message, provisional sentence, small-base note, year-so-far note, reason labels, the
empty-figure mark, `ctl.component.ended`. New keys:

| Key | Text |
|---|---|
| page.intro | How the Justice Department's components compare on size, hiring, departures and why people leave, from OPM's federal workforce data. |
| ctl.period | Period |
| ctl.startYear | Start year |
| table.title | Components side by side |
| table.caption | {period}. Rates: {method}. |
| col.component | Component |
| col.employees | Employees |
| col.change | Change |
| col.hires | Hires |
| col.departures | Departures |
| col.rate | Departure rate |
| col.quit | Quit rate |
| col.retirement | Retirement rate |
| row.doj | Justice Department (all components) |
| sort.hint | Select a column heading to sort. |
| chart.ranking.title | Departure rate by component |
| chart.ranking.reference | Justice Department overall: {rate} |
| chart.growth.title | Growth in employees since {year} |
| chart.growth.note | Each line shows employees as a share of that component's count at the end of {year} (= 100). |
| chart.growth.doj | Justice Department overall |
| chart.reasons.title | Why people left, by component |
| chart.reasons.note | Share of each component's departures in {period}. |
| chart.reasons.none | no departures |
