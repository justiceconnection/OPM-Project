# Spec addendum: Administrations

Status: container signed (D-065); metric definitions signed (D-066). Contents and copy signed (D-068).
Applies to Workforce size, Hiring and departures, Components compared and Who is leaving; each page's own spec stays
in force except where this addendum changes it. Data: `doj_admin` (per entity, all series groups) and the "admin"
grain of `doj_leaving` / `doj_leaving_series`.

## 1. Administrations (D-065)
| Id | Name | Months |
|---|---|---|
| obama2 | Obama II | Jan 2013 to Dec 2016 |
| trump1 | Trump I | Jan 2017 to Dec 2020 |
| biden | Biden | Jan 2021 to Dec 2024 |
| trump2 | Trump II | Jan 2025 to the latest month (so far; partial; newest 3 months provisional) |

Month 1 is January of the inauguration year; month 0 is the December before.

## 2. The administration filter
- **Workforce size, Hiring and departures:** preset buttons under the date range: Obama II, Trump I, Biden, Trump II, All.
  A preset sets From and To to the administration's months (Trump II and All end at the latest month); the reader can
  still adjust them. No new data: the existing cubes are read as today.
- **Components compared:** the Period list gains the four administrations (after the fiscal years at Yearly view, and
  at every view). With an administration chosen, the table and charts use that window (D-066): employees at the end,
  change over the window, hires and departures summed, rates annualized; the rate selector is replaced by a note that
  window rates are annualized.
- **Who is leaving:** the View gains "By administration" alongside Yearly and Last 12 months, with the Period list
  showing the four administrations. Breakdowns use the "admin" grain (annualized rates). With a job series selected,
  "By administration" stays available (the series files carry the admin grain).

## 3. The comparison panel (each of the four pages)
One panel, "Compare administrations", below the page's existing panels.
- **Controls:** administrations to compare (checkboxes; default Trump II with Biden and Trump I); "First N months in
  office" (1 to 48, default N = Trump II so far, 19 today). The component and job series selectors above apply.
- **Contents, all from `doj_admin`:**
  - Employee change in office: one line per administration over months 1 to N, as change since month 0; a table
    under the chart gives, at month N, the change and the percent of month 0.
  - Hires and departures: running totals at month N for each administration, as paired bars; lines over months 1 to N
    in a second chart.
  - Departure rate, first N months: annualized rate per administration (bars), with quit and retirement rates in the
    table; small-base flags as usual.
  - Why people left, first N months: one 100% bar per administration (seven reasons: DRP, then the six D-015 reasons without DRP, D-080).
- N cannot exceed the shortest chosen administration: the control's maximum follows the chosen set, so including
  Trump II caps N at its months so far, with the compare.capped note.
- Provisional months in Trump II's window: marked on its line and noted.
- On Who is leaving the panel shows the departure rate and why-people-left comparisons only (the other two are on the
  other pages).

## 4. Copy (signed, D-068)
| Key | Text |
|---|---|
| admin.obama2 | Obama II |
| admin.trump1 | Trump I |
| admin.biden | Biden |
| admin.trump2 | Trump II |
| admin.all | All |
| ctl.presets.label | Administration |
| ctl.view.admin | By administration |
| period.admin | {name} ({first} to {last}) |
| period.adminSoFar | {name} (so far, {first} to {last}) |
| admin.rateNote | Rates over an administration are annualized: departures per year, as a share of the average number of employees. |
| compare.title | Compare administrations |
| compare.pick | Administrations |
| compare.months | First {n} months in office |
| compare.monthsLabel | Months in office |
| compare.monthsNote | Month 1 is January of the inauguration year. Change is measured from the end of the December before. |
| compare.change.title | Change in employees since taking office |
| compare.change.col | Change |
| compare.change.pct | Percent |
| compare.flows.title | Hires and departures, first {n} months |
| compare.rate.title | Departure rate, first {n} months (annualized) |
| compare.reasons.title | Why people left, first {n} months |
| compare.capped | Limited to {n} months: the shortest administration chosen. |
| compare.provisional | Trump II's newest three months are provisional. |
