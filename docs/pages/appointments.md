# Spec: Appointments (fourth main tab)

Status: scope and container signed (D-084); answers D-085; crosswalk, metric definitions, contents and copy signed
(D-086).
Figures were measured on 5 October 2026 from `doj_employment`, `doj_accessions` and `doj_separations`.

## 1. Purpose
Show how DOJ's workforce splits by type of appointment, led by political appointments and the new Schedule
Policy/Career, and compare Trump II with earlier administrations at the same point in office.

## 2. What the data can and cannot say
- `appointment_type_code` is published on every row of all three datasets and is never redacted for DOJ. Invalid
  (`*`): 522 of 20.5 million employment rows, 142 accessions, 3 separations.
- Political appointments are small. Dec 2024 (month 0 for Trump II): 257 people in Schedule C, noncareer SES and
  Senate-confirmed codes; Jul 2026: 287. Most sit in Offices, Boards and Divisions (DJ01); the Senate-confirmed
  group is mostly US Attorneys (EOUSA, DJ09) and US Marshals (USMS, DJ08).
- Schedule Policy/Career (codes 67, 68) first appears in June 2026: 100 people in Jul 2026, 33 of them in OJP.
- **Conversions are invisible.** Moving between appointment types inside DOJ (career-conditional to career after
  three years; career to Schedule Policy/Career) is neither an accession nor a separation, and the data has no
  person ID. So a group's headcount change does not equal its hires minus departures. Example: career-conditional
  from FY2012 to FY2026 has 49,193 hires and 14,071 departures, while its headcount went from 9,375 (Oct 2011) to
  8,211 (Jul 2026). The page never derives one from
  the other (invariant 7) and says so.
- Detailees are not in the data (counted at their home agency).
- Whether a Schedule Policy/Career employee was hired into it or converted cannot be told.

## 3. Crosswalk: appointment groups (signed, D-086)
New file `pipeline/crosswalks/appointment_groups.csv`. Every code in the DB must map (gate).

| Group (label) | Codes | Dec 2024 | Jul 2026 | Comment |
|---|---|---|---|---|
| Career | 10 | 51,761 | 49,288 | Competitive service, permanent |
| Career-conditional | 15 | 9,567 | 8,211 | Competitive, first three years |
| Excepted service | 30, 32, 35, 38 | 51,885 | 47,038 | Permanent excepted, incl. all of the FBI (38) and Pathways (35) |
| Temporary and term | 20, 40, 42, 45, 48 | 3,116 | 1,738 | Every nonpermanent code except political ones |
| Senior Executive Service | 50, 60 | 789 | 664 | Career and limited-term SES |
| Political appointees | 44, 55, 46, 36 | 257 | 287 | Three subgroups, below |
| Schedule Policy/Career | 67, 68 | 0 | 100 | Shown on its own; OPM classes it as career |
| Unknown | * | 4 | 5 | Counted in totals, not shown as a group |

Political subgroups:
| Subgroup (draft label) | Codes | Dec 2024 | Jul 2026 |
|---|---|---|---|
| Schedule C | 44 | 54 | 119 |
| Noncareer SES | 55 | 52 | 55 |
| Executive appointments | 46, 36 | 151 | 113 |

Judgement calls for Cary:
- **Code 46 ("Executive, excepted nonpermanent") as executive appointments (D-085).** Jul 2026: 43 attorneys on the AD
  pay plan in EOUSA (US Attorneys), 56 US Marshals, 14 on the Executive pay plan. Strong but not certain evidence
  that these are Senate-confirmed or presidential appointments; OPM does not label them so.
- **Code 36 ("Executive, excepted permanent").** One US Marshal, Mar 2019 to Oct 2021. Grouped with 46.
- **Limited-term SES (60)** with career SES, not with political: it can be filled by either, 5 people today.
- **Temporary and term** mixes Pathways interns (45), Schedule A temporaries and "other" nonpermanent (48).

## 4. Metric definitions (signed, D-086)
- **Headcount** by group: the period's last month (invariant 3). Never summed across months.
- **Hires and departures** by group: the appointment type on the accession or separation row, by effective month
  (invariant 6), summed over the period. Transfers in and out count, as on the other pages.
- **Change since taking office**: headcount at month N minus headcount at month 0 (the December before
  inauguration, D-065), per group, for each administration. Also as a percent of month 0, except where month 0 is
  below 30 (shown as a count only; Schedule Policy/Career has no month 0 and is shown as a count).
- **Share of workforce**: group headcount / total headcount, same month.
- **No rates on this page.** Departure rates on bases of 50 to 300 mostly measure noise; counts are shown instead.
- Partial periods and provisional months flagged as elsewhere (invariant 8). Small-base flag: not applicable (no
  rates); groups under 30 people carry the small-base note on percentages.

## 5. Contents (signed, D-086)
Controls, as on the other main tabs: Component (multi-select, D-078), Compare with (administrations), View
(Yearly, Quarterly, Monthly). No Job series control in this version.

1. **Tiles.** Political appointees now (with each compared administration at this point); Schedule Policy/Career
   now; political hires since January 2025; political departures since January 2025.
2. **Political appointees since taking office.** Lines by months in office (0 to 48), one per administration, with
   three on/off subgroup toggle buttons, Schedule C, Noncareer SES and Executive appointments, all on by default (=
   all political appointees; D-098, which replaced the single-choice toggle). The last one on cannot be turned off.
   Each line is the sum of the selected subgroups; the percent change in the tooltip is the summed change over the
   summed month 0, a count only where the summed month 0 is under 30. The signature chart: the
   outgoing appointees leave in month 0 to 1 and the new administration refills.
3. **Workforce mix over time.** Since D-090: small multiples, one line chart per group on its own scale, with a From/to range (`docs/pages/october-2026-changes.md` section 8). Originally: stacked areas from Oct 2011 of the seven groups, share or count toggle,
   administration bands shaded. Political and Schedule Policy/Career are too thin to see here, so they are also
   listed in the tooltip and table.
4. **Hires and departures by group.** Paired bars per period for the chosen group (default: political
   appointees), administration bands shaded. Note on conversions (section 2).
5. **By component.** For the chosen group, one bar per component: headcount now, with markers for each compared
   administration at the same point (the Components chart style). Components with none are listed, not hidden.
6. **Notes.** What each group means, the code 46 reasoning, Schedule Policy/Career kept separate, conversions and
   detailees invisible. Also added to Reading the data.

Explore full history: none (new page).

## 6. Build outline (after sign-off)
- **data-engineer:** the crosswalk; a cube `doj_appointments` (entity x group and subgroup x month, quarter, fiscal
  year, plus administration x months-in-office rows), headcount, hires, departures, shares, flags; gate checks:
  every code mapped, groups and subgroups sum to the DOJ totals in every row (headcount, hires, departures),
  independent recomputation, effective-month basis, provisional flags, manifest hash.
- Admin view (D-088): `doj_appointments/admin.json`, admin grain only at N = each entity's Trump II months so far,
  for every administration and group; the by-component panel reads it (via `meta.files.admin.path`) instead of the 13
  entity files.
- **frontend-developer:** the tab, the page, tests and smoke at 1280 and 390, Reading the data addition.
- **verifier:** full pass on a frozen tree, then promotion approval.

## 7. Copy (signed, D-086)
| Key | Text |
|---|---|
| nav.appointments | Appointments |
| appt.title | Appointments |
| appt.intro | How the Justice Department's workforce is appointed, from career staff to political appointees, compared with earlier administrations at the same point in office. |
| appt.group.career | Career |
| appt.group.careerConditional | Career-conditional |
| appt.group.excepted | Excepted service |
| appt.group.temporary | Temporary and term |
| appt.group.ses | Senior Executive Service |
| appt.group.political | Political appointees |
| appt.group.schedulePolicy | Schedule Policy/Career |
| appt.sub.scheduleC | Schedule C |
| appt.sub.noncareerSes | Noncareer SES |
| appt.sub.executive | Executive appointments |
| appt.tile.political | Political appointees |
| appt.tile.schedulePolicy | Schedule Policy/Career |
| appt.tile.politicalHires | Political hires since January 2025 |
| appt.tile.politicalDepartures | Political departures since January 2025 |
| appt.since.title | Political appointees since taking office |
| appt.mix.title | Workforce by type of appointment, {from} to {to} (D-090) |
| appt.flows.title | Hires and departures: {group} |
| appt.comp.title | {group} by component |
| appt.note.conversions | Moves between appointment types inside the department, such as conversion to Schedule Policy/Career, are not hires or departures, so a group's change in employees can differ from its hires minus its departures. |
| appt.note.executive | Executive appointments are positions OPM codes as executive excepted appointments, mostly U.S. Attorneys, U.S. Marshals and the department's senior leadership. |
| appt.note.schedulePolicy | Schedule Policy/Career began in June 2026. OPM classes it as a career appointment; it is shown separately because it covers policy-influencing positions. |
| appt.note.unknown | {count} employees with an invalid appointment code are counted in the total but not shown as a group. |
| appt.tile.politicalParts | Schedule C {sc} · Noncareer SES {ses} · Executive appointments {exec} |
| appt.note.political | Political appointees are the total of three appointment types: Schedule C, Noncareer SES and Executive appointments. Schedule Policy/Career is counted separately. |

## 8. Answered (D-085)
1. Code 46 and 36 subgroup label: "Executive appointments".
2. Group label: "Political appointees".
3. Schedule Policy/Career tile sits next to the political appointees tile.
4. No rates on this page.
5. No Job series control in this version.
