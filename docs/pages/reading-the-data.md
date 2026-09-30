# Page spec: Reading the data

Status: container signed (D-048). Contents and copy are DRAFT for Cary's sign-off. Every figure below is taken
from opm-context (measured against the Oct 2011 to Jul 2026 data) and is fixed text, not read from a cube.

## 1. Layout
One page. Title, one-line intro, then a contents list linking to four sections by anchor. Each section is a
heading and short paragraphs; a few use a small table. No charts, no controls. Other pages link in:
- Workforce size "Known gap; see Reading the data." goes to `#known-gaps`.
- Rate help texts and small-base notes may link to `#rates` (optional; not required by signed specs).

| Section | Anchor |
|---|---|
| Source and coverage | `#source` |
| How we count | `#counting` |
| Rates and categories | `#rates` |
| Known gaps and data issues | `#known-gaps` |

Figures in this copy are as of the Jul 2026 data; the page states that date once, in the intro.

## 2. Copy (DRAFT, for sign-off)

### Page
| Key | Proposed text |
|---|---|
| page.intro | What the numbers on this dashboard mean, where they come from and where to be careful. Figures on this page are as of the July 2026 data. |
| toc.label | On this page |

### Source and coverage (`#source`)
| Key | Proposed text |
|---|---|
| source.title | Source and coverage |
| source.p1 | All figures come from the U.S. Office of Personnel Management's Federal Workforce Data. OPM publishes two kinds of monthly files: a snapshot of everyone on the payroll at the end of each month, and a record of personnel actions, such as hires and departures. |
| source.p2 | The dashboard covers October 2011 through the latest month OPM has published, and is updated when OPM releases new months. |
| source.p3 | "Justice Department" means every component of the Department. Files before January 2015 identify the Department differently; we use the matching code, and the employee count is continuous across the change (114,656 in December 2014, 114,163 in January 2015). |
| source.p4 | The Department's components are shown as OPM reports them. The Community Relations Service was last reported in April 2026 (it is also missing from the January 2026 file), so it appears only for periods when it existed. |
| source.p5 | Each record is one person, but OPM's files have no personal identifier, so the dashboard cannot follow an individual from month to month. |

### How we count (`#counting`)
| Key | Proposed text |
|---|---|
| counting.title | How we count |
| counting.p1 | Employees: the number of people in the month-end snapshot. For a quarter or a year, we show the count at the end of its last month, never an average or a sum. |
| counting.p2 | Hires and departures: counted in the month the action took effect, not the month OPM processed it. Most actions appear in the file for the month they took effect; since 2020, 98.7% appear within one month. |
| counting.p3 | Provisional: because some actions arrive late, the newest three months can still change and are marked as provisional. |
| counting.p4 | Years run October to September, the federal fiscal year. A year or quarter that is still in progress is marked partial and covers only the months published so far. |
| counting.p5 | Change in employees and hires minus departures are counted from different files, so they do not always match. We show both and do not adjust one to fit the other. In most years they differ by a few hundred. |

### Rates and categories (`#rates`)
| Key | Proposed text |
|---|---|
| rates.title | Rates and categories |
| rates.p1 | A departure rate is the number of people who left, divided by the average number of employees over the same months. The average is taken over month-end counts. Quit and retirement rates work the same way, counting only those reasons. |
| rates.p2 | You can choose how the rate is measured: |
| rates.list.a | Last 12 months: departures in the 12 months up to each point, over the average employee count in those months. |
| rates.list.b | Fiscal year: departures in each fiscal year, over its average employee count. A year still in progress shows the year so far. |
| rates.list.c | Annual pace: departures in each period, scaled up to a full year, over the period's average employee count. |
| rates.p3 | Small groups: when a rate is based on fewer than 30 employees on average, it is shown with a flag. Such rates can swing widely from one period to the next; they are shown, not hidden. |
| rates.p4 | Every departure falls into exactly one reason, based on OPM's separation codes: |
| rates.reasons | table: Transfer out (individual and mass transfers to another agency); Quit; Retirement (voluntary, early and other retirements); RIF (reduction in force); Termination: expired appointment or other; Other. |
| rates.p5 | Deferred Resignation Program (DRP): OPM flags departures under the program from March 2025. They are already counted in the reasons above; the dashboard shows them as an extra line, not a separate reason. |
| rates.p6 | Hires are either new hires (competitive, excepted or Senior Executive Service appointments) or transfers in from another agency. |
| rates.p7 | Who is leaving groups people by years of service, age (OPM's brackets), supervisory role and occupation. Groups are shown only by fiscal year or for 12-month periods, never month by month, so that small groups do not point to individuals. People whose group is unknown are counted in totals but not shown as a group. |

### Known gaps and data issues (`#known-gaps`)
| Key | Proposed text |
|---|---|
| gaps.title | Known gaps and data issues |
| gaps.drp.title | The Deferred Resignation Program gap (fiscal years 2025 and 2026) |
| gaps.drp.p1 | About 4,800 departures took effect in September 2025, most of them under the Deferred Resignation Program, but the employee count fell mostly in October 2025 (by 3,860). As a result, change in employees and hires minus departures differ by about 4,000 in each of fiscal years 2025 and 2026, in opposite directions. Across the two years the difference largely cancels out. |
| gaps.los.title | Length of service recorded from 1900 |
| gaps.los.p1 | In OPM's departure files for June 2024 through July 2025, some records show about 125 years of service: the time since 1 January 1900 rather than since the person's start date. This affects 39 Justice Department departures between October 2024 and March 2025. We treat those values as unknown: they are left out of years of experience lost, and the coverage shown next to that figure reflects it. The Look-Up shows OPM's values as published. |
| gaps.occ.title | Occupational category missing |
| gaps.occ.p1 | From June 2024, OPM's departure files no longer fill in the broad occupational category. We group occupations by OPM's job series instead (attorneys 0905, criminal investigators 1811, correctional officers 0007). |
| gaps.redact.title | Pay and location withheld |
| gaps.redact.p1 | OPM withholds pay and duty location for many employees: about two thirds of Justice Department records, and 79% to 90% at the FBI, DEA, U.S. Marshals Service, ATF and the U.S. Attorneys' offices. The dashboard therefore does not show pay or location breakdowns. |
| gaps.revisions.title | Revised files |
| gaps.revisions.p1 | OPM sometimes reissues a month's files. When that happens we reload them, and months whose files changed are flagged. Figures on the dashboard can change as a result. |

## 3. Open for sign-off
1. Contents and layout above.
2. Copy table. Figures to confirm are all from the measured data: 114,656 / 114,163; 98.7%; about 4,800, 3,860 and
   about 4,000; 39 departures; two thirds and 79% to 90%.
