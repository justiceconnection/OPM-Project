# Spec: Redesign around the current administration

Status: direction signed (D-071). Contents, the new metric (section 6) and copy (section 7) signed (D-072). Replaces the main-view parts of the Workforce size, Hiring and departures, Who is leaving,
Components compared, job series and administrations specs; those specs stay in force for the "Explore full history"
sections (section 5). Figures in examples are DOJ, all series, Jul 2026 data.

"Current administration" = Trump II (D-065). "At this point" = the same number of months in office as Trump II so far
(N, 19 today; month 1 = January of the inauguration year, D-066).

## 1. Navigation
Main pages: Overview (home, `index.html`), Departures, Components. Secondary links (smaller, after the main ones):
Look-Up, Reading the data. Existing page addresses keep working: `hiring-and-departures.html` and
`who-is-leaving.html` open Departures, `components-compared.html` opens Components (each with a one-line "this page
has moved" note), so Framer embeds and bookmarks do not break. Job series has no page of its own: it is a filter on
every page (simpler; D-071 left it to this spec).

## 2. The control bar (identical on the three main pages)
| Control | Values | Default |
|---|---|---|
| Component | Multi-select (D-078): All, or any set of the 11 current components; Community Relations Service only on its own | All |
| Job series | All job series, the 15 series (D-063), All other job series | All job series |
| Compare with | Obama II, Trump I, Biden (toggles) | All on |
| View | Monthly, Quarterly, Yearly (D-033 wording and note) | Monthly |

View applies to every chart on the page: on timeline charts it groups calendar months as today; on months-in-office
charts it shows every month, every 3rd or every 12th month in office (D-071). Tiles and "at this point" figures do
not change with View (they always use month N).

## 3. Administration shading
Every timeline chart (calendar x-axis) gets one band per administration with its name at the top of the band:
Obama II, Trump I, Biden in alternating light neutral tints, Trump II in a slightly stronger tint. Months before Jan
2013 (Oct 2011 to Dec 2012) are unshaded. Bands are drawn behind the data, included in SVG export, and never change
the data. Written as our own Chart.js plugin using our tokens (D-022).

Administration colors on comparison charts stay as built: Obama II purple, Trump I gold, Biden teal, Trump II ink
(thicker line or darker bar), never party colors.

## 4. Pages
### 4.1 Overview (home)
**Tiles** (four, for the selected component and series; data `doj_admin` at N):
| Tile | Main figure | Under it |
|---|---|---|
| Employees | Employees now ({month}), and change since the end of December 2024: "-10,048 (-8.6%)" | One line per compared administration: "Biden at this point: -552 (-0.5%)" |
| Departures since January 2025 | 20,461 | "Biden at this point: 15,191" etc. |
| Hires since January 2025 | 11,343 | same form |
| Departure rate (annualized) | 11.7% | same form |

**Chart A, "Change in employees since taking office":** one line per administration (Trump II plus the compared
ones), x = months in office (per View), y = change since month 0. Trump II emphasized. A table under it gives, at
month N, each administration's change and percent.

**Chart B, "Employees, October 2011 to {latest}":** headcount timeline (doj_core / doj_core_series) at the View's
grain, with administration shading. Provisional months dashed (as today).

**Chart C, "Departure rate, first {N} months (annualized)":** one bar per administration.

### 4.2 Departures
**Tiles** (since January 2025, with "at this point" lines): Departures, Quits, Retirements, DRP departures.

**Chart A, "Departures since taking office":** running departures by months in office, one line per administration.

**Chart B, "Why people left, first {N} months":** one 100% bar per administration (seven reasons: DRP, then the six D-015 reasons without DRP, D-080).

**Chart C, "Who is leaving, first {N} months":** four small panels (years of service, age, supervisors and everyone
else, occupation), each a grouped bar chart: one bar per administration for every group, the departure rate
(annualized). Unknown counted in a note, never a bar; small bases hatched; groups with no staff listed as not
applicable (D-031, D-038 rules). Uses the new "first N months" grain (section 6). With a job series selected the
occupation panel is hidden (as today).

**Chart D, "Hires and departures, October 2011 to {latest}":** paired bars at the View's grain with administration
shading.

### 4.3 Components
**Table, "Components since January 2025":** one row per component (DOJ pinned first): employees now; change since
the end of December 2024 (number and percent); departures since January 2025; departure rate (annualized); then one
column per compared administration with its change percent at the same point. Sortable as today (D-049); scrolls
inside its panel on phones.

**Chart, "Change since taking office, by component":** horizontal bars of each component's Trump II change percent,
with a marker per compared administration's change percent at the same point.

**Mini charts, "Change in employees since taking office, by component" (D-075):** one small chart per component
(12; Community Relations Service marked ended), percent change since month 0 by months in office, one line per
administration (Trump II emphasized), View and Compare with apply, one shared y-axis for the 11 current components; Community Relations Service on its
own axis with `comp.minis.crsNote` (D-076). Note: `comp.minis.note`.

Components with no one in the selected series: "no employees in this job series" (as today).

## 5. Explore full history
At the bottom of Overview and Departures (and Components), a section "Explore full history", collapsed by default.
Opening it shows today's charts for that page, unchanged, with their own controls (date range, presets, rate method,
Last 12 months, etc.), per their existing signed specs. Nothing currently published is removed.

## 6. New metric: "first N months in office" for departure breakdowns (signed, D-072)
For each administration, departures and the departure rate per dimension value over months 1 to N in office, where N
is Trump II's months so far (the same N for every administration; cut at a component's last month, D-024). Rate =
departures with that value in months 1 to N / mean month-end headcount with that value over months 1 to N,
annualized (x 12 / N), as D-066. Same Unknown, not-applicable, small-base and coverage rules as the existing
breakdowns. Recomputed at every refresh (N moves); in doj_leaving and doj_leaving_series as grain "admin_n".
Windows of 19 months or more are coarser than a fiscal year, so D-031's concern does not arise.

## 7. Copy (signed, D-072; additions and changes D-074 to D-078, D-080, D-081)
Reused signed strings: component and series names, administration names, View control and note, category labels,
group labels, provisional sentence, small-base note, "no employees in this job series", Data not available.

| Key | Text |
|---|---|
| nav.overview | Overview |
| nav.departures | Departures |
| nav.components | Components |
| nav.lookup | Look-Up |
| nav.reading | Reading the data |
| moved.note | This page has moved. You are now on {page}. |
| ctl.compare | Compare with |
| ctl.components.n | {n} components |
| ctl.components.header | Choose components |
| ctl.components.all | All components |
| sel.components | Selected components ({n}) |
| ov.intro | How the Justice Department's workforce has changed since January 2025, compared with earlier administrations at the same point in office. |
| tile.employees | Employees |
| tile.employees.change | {change} ({pct}) since the end of December 2024 |
| tile.departuresSince | Departures since January 2025 |
| tile.hiresSince | Hires since January 2025 |
| tile.rateSince | Departure rate (annualized) |
| tile.atThisPoint | {admin} at this point: {value} |
| ov.change.title | Change in employees since taking office |
| ov.change.note | Month 1 is January of the inauguration year. Change is measured from the end of the December before. |
| ov.timeline.title | Employees, October 2011 to {latest} |
| ov.rate.title | Departure rate, first {n} months (annualized) |
| shade.note | Shaded bands mark administrations. |
| dep.intro | Who has left the Justice Department since January 2025 and why, compared with earlier administrations at the same point in office. |
| tile.quitsSince | Quits since January 2025 |
| tile.retirementsSince | Retirements since January 2025 |
| tile.drpSince | DRP departures |
| dep.running.title | Departures since taking office |
| dep.reasons.title | Why people left, first {n} months |
| dep.who.title | Who is leaving, first {n} months |
| dep.who.unknownAdmin | {admin}: {count} departures with unknown {dimension} are counted in the total but not shown as a group. |
| dep.who.unknownAdmin1 | {admin}: 1 departure with unknown {dimension} is counted in the total but not shown as a group. |
| dep.who.coverageAdmin | {admin}: based on {pct} of departures with a known length of service. |
| dep.who.note | Departure rate by group: departures in the first {n} months, annualized, as a share of the group's average number of employees. |
| dep.timeline.title | Hires and departures, October 2011 to {latest} |
| comp.intro | How each component has changed since January 2025, compared with earlier administrations at the same point. |
| comp.table.title | Components since January 2025 |
| comp.col.now | Employees now |
| comp.col.change | Change since Dec 2024 |
| comp.col.departures | Departures since Jan 2025 |
| comp.col.rate | Departure rate (annualized) |
| comp.col.atThisPoint | {admin} at this point |
| comp.chart.title | Change since taking office, by component |
| comp.minis.title | Change in employees since taking office, by component |
| comp.minis.note | Percent change from the end of the December before each administration took office. All charts use the same scale. |
| comp.chart.crsNote | Community Relations Service, a very small office, runs off the scale; its value is labeled. |
| comp.minis.value | Trump II: {pct} |
| adm.ruleN | Trump II so far (month {n}) |
| adm.tipMonth | Month {n} in office |
| comp.minis.crsNote | Community Relations Service, a very small office, is shown on its own scale. |
| comp.minis.expand | Expand |
| comp.minis.close | Close |
| comp.minis.year | Year {n} |
| comp.minis.xTitle | Months in office |
| reasons.drpNote | DRP departures are shown as their own reason and are not counted again under Quit, Retirement or the other reasons. |
| explore.title | Explore full history |
| explore.note | Every chart from earlier versions of this page, with its own date and rate controls. |
