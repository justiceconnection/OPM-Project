# Page spec: Workforce size

Status: signed (container D-029; contents and copy D-030). Data: `doj_core` only. The browser picks rows, sums columns and divides; nothing else.

## 1. Controls
| Control | Values | Default |
|---|---|---|
| Component | DOJ, then the 12 components by display name (D-016); DJ14 listed with its end month | DOJ |
| View (D-033) | Yearly, Quarterly, Monthly | Yearly (D-029) |
| Date range | Oct 2011 to latest month; administration presets later | Full range |

No rate-method selector: this page shows no rates. The component selector drives every panel except panel 4.

## 2. Panels and contents

### Panel 1: headline tiles
| Tile | Value | Cube source |
|---|---|---|
| Headcount | Latest month's headcount for the selected component | month row, `headcount` |
| Change over 12 months | Sum of the last 12 monthly `headcount_change` values (= latest month minus the same month a year earlier), and that sum over the earlier month's headcount as a percent | month rows, `headcount_change`, `headcount` |
| Change over the chosen range | Sum of `headcount_change` over the periods in the range (= last period's headcount minus the headcount at the end of the period before the range), with the same percent | rows in range |

Sums of `headcount_change` telescope, so the browser never subtracts two rows. When the range starts at Oct 2011,
the first period has no change and the tile says the change is measured from the end of Oct 2011 (FY grain: from
the end of FY2012). The Headcount tile carries the provisional marker when the latest month is provisional (always,
by definition).

### Panel 2: headcount over time
Line of `headcount` by period at the chosen grain. Quarter and year points are the period's last published month
(D-008). Provisional periods are drawn dashed; a partial fiscal year or quarter gets a "partial" marker on its point.
A component with an end month (DJ14) stops there.

### Panel 3: headcount change vs net flow
Two series per period: `headcount_change` and `net_flow` (hires minus departures), as paired bars. They are
separate series and are never reconciled (invariant 7). At fiscal-year grain FY2025 and FY2026 carry a
known-break marker (D-012, D-021) linked to the Reading the data page; at month or quarter grain the marker sits on
Sep 2025 and Oct 2025. Provisional and partial markers as in panel 2.

### Panel 4: headcount by component
Always DOJ-wide, ignoring the component selector.
- 4a. Ranking: horizontal bars of the latest month's headcount for the 11 current components, largest first.
  DJ14 is listed below the bars as ended (last month Apr 2026, headcount 9), not ranked.
- 4b. Trend: small multiples, one line per component at the chosen grain and range, each with its own y-axis
  and its latest value labeled. At 390 px the grid becomes one column.

Proposed for sign-off: 4b uses independent y-axes (shape over size); the ranking shows size.

## 3. Flags on this page
| Flag | Treatment |
|---|---|
| Provisional | Dashed segment and a marker; tile badge |
| Partial | Point marker and "(partial)" in the period label |
| Reissued | Marker on the period, once reissues exist |
| Known break | Marker on panel 3 only |
| Small base, coverage | Not used: no rates, no redacted fields on this page |

## 4. Copy (signed, D-030)
Every string goes into `web/copy.json`. Proposed wording:

| Key | Text |
|---|---|
| page.title | Workforce size |
| page.intro | How many people the Justice Department employs, month by month since October 2011, from OPM's federal workforce data. |
| ctl.component | Component |
| ctl.component.all | Justice Department (all components) |
| tile.headcount | Employees |
| tile.headcount.asof | As of {month} |
| tile.change12 | Change over 12 months |
| tile.changeRange | Change, {start} to {end} |
| tile.changeRange.firstNote | Measured from the end of {period}. |
| chart.headcount.title | Employees over time |
| chart.flow.title | Change in employees vs. hires minus departures |
| chart.flow.series.change | Change in employees |
| chart.flow.series.net | Hires minus departures |
| chart.flow.note | These are counted from different OPM files and do not always match. The largest gap follows the Deferred Resignation Program: about 4,800 departures took effect in September 2025, while the employee count fell mostly in October 2025. |
| chart.components.title | Employees by component |
| chart.components.ended | {name}: last reported {month} ({count} employees) |
| flag.provisional | Provisional: the newest three months can still change as late actions arrive. |
| flag.partial | Partial: {period} so far runs through {month}. |
| flag.break | Known gap; see Reading the data. |
| source | Source: OPM Federal Workforce Data (EHRI Status and Dynamics), October 2011 to {latest}. DOJ counts include all components. |

## 5. Open for sign-off
1. Contents above (tiles, panel details, 4b independent axes).
2. Copy table.
3. Dashboard-wide: control labels and method names stay unsigned until a page that uses them is specced.
