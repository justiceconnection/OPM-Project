# Page spec: Reading the data

Every figure below was measured against the Oct 2011 to Aug 2026 data (as reissued) and is fixed text, not read
from a cube.

## 1. Layout
One page. Title, one-line intro, then a contents list linking to each section by anchor. Each section is a
heading and short paragraphs; a few use a small table. No charts, no controls. Other pages link in:
- Workforce size "Known gap; see Reading the data." goes to `#known-gaps`.
- Rate help texts and small-base notes may link to `#rates` (optional).

| Section | Anchor |
|---|---|
| Data origin | `#source` |
| Data breakdown | `#counting` |
| Rates and categories | `#rates` |
| Known gaps and data issues | `#known-gaps` |
| AI Use Disclaimer | `#ai-use` |

Figures in this copy are as of the Aug 2026 data; the page states that date once, in the intro.

## 2. Copy

### Page
| Key | Text |
|---|---|
| page.intro | Breaking down data sources, how it's analyzed, and important data caveats. All data on this page are as of August 2026. |
| toc.label | On this page |

### Data origin (`#source`)
| Key | Text |
|---|---|
| source.title | Data origin |
| source.p1 | All data is from the U.S. Office of Personnel Management's Federal Workforce Data. OPM publishes two types of monthly files: a snapshot of payroll demographics at the end of each month, and a record of personnel actions, including hires and departures. |
| source.p1.link | U.S. Office of Personnel Management's Federal Workforce Data |
| source.p2 | Dashboard data begins in October 2011 and goes through the latest month OPM has published. Justice Connection updates the dashboard when OPM releases new data, which usually lags by about a month. |
| source.p4 | The Justice Department's components are shown as OPM reports them. OPM reports the Department as 12 components; litigating divisions and other offices are grouped under Offices, Boards and Divisions. The Community Relations Service was eliminated in April 2026 and OPM's files show no CRS employees after that month, so it is shown with 0 employees, hires and departures from May 2026. Note that CRS data is missing from OPM's January 2026 file, so that month shows 0 employees, but that is not an accurate count. |
| source.p5 | Each record is one person, but OPM's files have no personal identifier, so the dashboard cannot follow an individual from month to month. |
| source.p6 | Labels follow OPM's terms. For example, components, the sub-divisions of the Justice Department, are named as OPM reports them, and in the Look-Up tool, grade is the federal pay grade within the employee's pay plan. |

### Data breakdown (`#counting`)
| Key | Text |
|---|---|
| counting.title | Data breakdown |
| counting.p1 | Employees are the number of staff counted at the month-end snapshot. For a quarter or a year, we show the count at the end of its last month, never an average or a sum. |
| counting.p2 | Hires and departures: counted in the month the action took effect, not the month OPM processed it. Most actions appear in the file for the month they took effect; since 2020, 98.7% appear within one month. |
| counting.p3 | Provisional labels are applied because some data is filed retroactively. The most recent three months are the most likely to change, and are always marked provisional. |
| counting.p4 | Years are organized from October to September following the federal fiscal year. A year or quarter that is still in progress is marked partial and covers only the months published so far. |
| counting.p5 | Change in employees and hires minus departures are counted from different files, so they do not always match. The dashboard shows both and does not adjust one to fit the other. In most years they differ by less than 500. |

### Rates and categories (`#rates`)
| Key | Text |
|---|---|
| rates.title | Rates and categories |
| rates.p1 | A departure rate is the number of people who left, divided by the average number of employees over the same months. The average is taken over month-end counts. Quit and retirement rates work the same way, counting only those reasons. |
| rates.p2 | You can choose how the rate is measured: |
| rates.list.a | Past 12 months: departures in the 12 months up to each point, over the average employee count in those months. |
| rates.list.b | Fiscal year: departures in each fiscal year, over its average employee count. A year still in progress shows the year so far. |
| rates.list.c | Annual pace: departures in each period, scaled up to a full year, over the period's average employee count. |
| rates.p3 | Small groups: when a rate is based on fewer than 30 employees on average, it is shown with a flag. Such rates can swing widely from one period to the next. They are shown but caveated. |
| rates.p4 | While the human reasons behind a departure may be nuanced, in the data a departure falls into only one reason, based on OPM's separation codes: |
| rates.reasons | table: Transfer out (individual and mass transfers to another agency); Quit; Retirement (voluntary, early and other retirements); RIF (reduction in force); Termination: expired appointment or other; Other. |
| rates.p5 | Deferred Resignation Program (DRP): OPM flags departures under the program from March 2025. In the departure reasons charts they are shown as their own reason and are not counted again under Quit, Retirement or the other reasons; the tiles and rate lines still count them under their original reason. |
| rates.p6 | Hires can be either new hires (competitive, excepted or Senior Executive Service appointments) or transfers in from another agency. |
| rates.p7 | Departed staff demographics groups people by years of service, age (OPM's brackets), supervisory role and occupation. Groups are shown only by fiscal year or for 12-month periods, never month by month, so that small samples do not point to individuals. People whose group is unknown are counted in totals but not shown as part of a group. |

### Known gaps and data issues (`#known-gaps`)
| Key | Text |
|---|---|
| gaps.title | Known gaps and data issues |
| gaps.drp.title | The Deferred Resignation Program gap (fiscal years 2025 and 2026) |
| gaps.drp.p1 | About 4,800 departures took effect in September 2025, most of them under the Deferred Resignation Program, but the employee count fell mostly in October 2025 (by 3,860). As a result, change in employees and hires minus departures differ by about 4,000 in each of fiscal years 2025 and 2026, in opposite directions. Across the two years the difference largely cancels out. |
| gaps.los.title | Length of service recorded from 1900 |
| gaps.los.p1 | In OPM's departure files for June 2024 through July 2025, some records show about 125 years of service, or the time since 1 January 1900 rather than since the person's start date. This affects 39 Justice Department staff who departed between October 2024 and March 2025. We treat those values as unknown: they are left out of the dashboard showing years of experience lost. The Look-Up tool shows OPM's values as published. |
| gaps.occ.title | Occupational category missing |
| gaps.occ.p1 | From June 2024, OPM's departure files no longer provide data in the broad occupational category. We group occupations by OPM's job series instead (examples include attorneys / 0905, criminal investigators / 1811, correctional officers / 0007). |
| gaps.redact.title | Pay and location withheld |
| gaps.redact.p1 | OPM withholds pay and duty location for many employees - about two thirds of Justice Department records with most affecting the FBI, DEA, U.S. Marshals Service, ATF and the U.S. Attorneys' offices. The dashboard therefore does not show pay or location breakdowns. |
| gaps.revisions.title | Revised files |
| gaps.revisions.p1 | OPM sometimes reuploads and changes a month's files. When that happens, the dashboard reloads them, and files that have been changed are flagged. Published numbers can change as a result. |

### AI Use Disclaimer (`#ai-use`)
| Key | Text |
|---|---|
| ai.title | AI Use Disclaimer |
| ai.p1 | To develop this tool, we used Claude Code and Copilot to help write code, build dashboard logic and filter data. When using AI, we validated data against published OPM data when possible. All new code was subject to human review and analysis. All copy published inside and alongside the dashboard (including notes, documentation, explanations and data labels) was written or reviewed and approved by humans. We utilized AI to expedite data clean-up, speed up web development and create more sophisticated dashboard features. |
