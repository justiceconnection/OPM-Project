# Page spec: Hiring and departures

Status: container signed (D-037). Contents and copy are DRAFT for Cary's sign-off. Data: `doj_core` only. The
browser picks rows, sums columns (across periods only for flow and stock_change kinds) and divides.

## 1. Controls
| Control | Values | Default |
|---|---|---|
| Component | As on Workforce size (D-016 names; DJ14 with its end month) | DOJ |
| View | Yearly, Quarterly, Monthly (D-033) | Yearly (D-029) |
| Date range | Oct 2011 to latest month | Full range |
| Rate based on | The three signed methods (D-019), in panel 4 only | Method A |

The component selector drives every panel.

## 2. Panels and contents

### Panel 1: headline tiles
| Tile | Value | Cube source |
|---|---|---|
| Hires, last 12 months | Sum of `hires` over the latest 12 month rows; below it, the sum over the 12 months before | month rows, `hires` |
| Departures, last 12 months | Same, `departures` | month rows, `departures` |
| Departure rate | Latest month's method A rate (`attrition_a_num / rate_a_den`); below it, the same month a year earlier | month rows |

Earlier-period figures are shown as a second number, not as a difference, so the browser never subtracts. The
tiles do not follow the View control; they always describe the latest 12 months. Provisional marker on all three
(the latest months are always provisional). Small-base flag on the rate tile when set.

### Panel 2: hires vs departures
Two series per period, `hires` and `departures`, as paired bars at the chosen View and range. Provisional bars
hatched; partial periods marked. The DRP wave shows in the data itself; no annotation beyond panel 3's overlay.

### Panel 3: why people left
Stacked bars per period of the six signed categories (D-015, D-020): Transfer out, Quit, Retirement, RIF,
Termination: expired appointment or other, Other. They sum to departures. DRP is a line overlay (`sep_drp`), on
by default, toggleable in the legend; its note says DRP departures are already inside the categories. Legend
order as listed; RIF and Termination keep their own colors even when small.

### Panel 4: rates over time
Three lines: departure (attrition), quit and retirement rates, at the chosen View, using the method picked in
this panel's "Rate based on" control (D-019).
- Method A at every View; method B only at Yearly (other Views show the no-value message); method C at every View.
- A partial year under method B is year to date and labeled so (D-023).
- Rows with `small_base` show a hollow marker and the small-base note; rates never suppressed (D-007).
- Empty rates (D-027) are gaps.

### Panel 5: hires by type
Stacked bars per period: New hire, Transfer in (D-015, D-020). They sum to hires.

## 3. Flags on this page
| Flag | Treatment |
|---|---|
| Provisional | Hatched bars, dashed line segments, tile badges |
| Partial | Marker and "(partial)" label (signed) |
| Small base | Hollow marker and note, panel 1 rate tile and panel 4 |
| Known break | Not shown here (it concerns headcount vs net flow, on Workforce size) |
| Coverage | Not used: no partly missing fields on this page |

## 4. Copy (DRAFT, for sign-off)
Signed labels reused as is: component names, category and hire-type labels, View control, period formats,
"(partial)", provisional sentence (from Workforce size, as a shared key).

| Key | Proposed text |
|---|---|
| page.intro | Who joins and who leaves the Justice Department, and why people leave, from OPM's federal workforce data. |
| tile.hires | Hires, last 12 months |
| tile.departures | Departures, last 12 months |
| tile.rate | Departure rate, last 12 months |
| tile.prior | Year before: {value} |
| chart.flows.title | Hires and departures |
| chart.flows.series.hires | Hires |
| chart.flows.series.departures | Departures |
| chart.reasons.title | Why people left |
| chart.reasons.drp | Deferred Resignation Program (DRP) |
| chart.reasons.drpNote | DRP departures are already counted in the reasons above; the line shows how many of them there were. |
| chart.rates.title | Departure, quit and retirement rates |
| chart.rates.series.attrition | Departure rate (all reasons) |
| chart.rates.series.quit | Quit rate |
| chart.rates.series.retirement | Retirement rate |
| chart.rates.note | Share of the average number of employees who left. |
| ctl.rate | Rate based on |
| ctl.rate.a | Last 12 months |
| ctl.rate.b | Fiscal year |
| ctl.rate.c | Annual pace |
| ctl.rate.help.a | Departures in the 12 months up to each point, over the average employee count in those months. |
| ctl.rate.help.b | Departures in each fiscal year, over its average employee count. A year still in progress shows the year so far. Yearly view only. |
| ctl.rate.help.c | Departures in each period, scaled up to a full year, over the period's average employee count. |
| chart.noRateAtGrain | This rate is only available in the Yearly view. |
| flag.smallBase | Based on fewer than 30 employees on average: read with care. |
| flag.ytd | {period}: year so far, not a full year. |
| chart.hireTypes.title | Hires by type |

## 5. Open for sign-off
1. Contents above, including tiles that always describe the latest 12 months and show the year before as a
   second number.
2. Copy table, especially the plain method names "Last 12 months", "Fiscal year", "Annual pace" and "Departure
   rate" for attrition.
