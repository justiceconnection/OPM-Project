# Hires and Departures tab (D-099, D-100): spec addendum to redesign.md section 4.2

Status: signed by Cary 2026-10-09 (D-101), copy and grade bands. Data: doj_admin, doj_core(_series), doj_leaving(_series),
doj_joining(_series) (D-100).

## 1. Container
The Departures tab (`departures.html`) is renamed "Hires and departures". A two-way toggle at the top of the page,
above the existing control bar, switches every tile and chart between Departures (default) and Hires. The control
bar (components, job series, Compare with, View) and its state are shared by both modes. Switching mode keeps the
selected components, series, compared administrations, grain and Group by (when the group exists in the other mode;
otherwise the first group).

## 2. Contents
| Part | Departures (unchanged unless noted) | Hires |
|---|---|---|
| Tiles | Departures, Quits, Retirements, DRP departures since January 2025 | Hires, New hires, Transfers in since January 2025; Hire rate (annualized, D-100) |
| Chart 1 | Departures since taking office | Hires since taking office |
| Chart 2 | Departure reasons (7 reasons incl. DRP, D-080) | How people were hired: competitive service new hires (AC), excepted service new hires (AD), SES appointments (AE), transfers in (AA) |
| Chart 3 | Departed staff demographics: years of service, age, education (new), veteran status (new), grade level (new), supervisory, occupation | Who is joining: age, education, veteran status, grade level, occupation (rates per 100); prior federal service, early-career programs (shares of hires) |
| Chart 4 | Hires and departures over time (unchanged, same in both modes) | same |

Chart 3 in Hires mode, share groups: bars show the share of hires with a known value; the axis and tooltip change
to shares; Compare works the same way. Occupation is hidden while a job series is selected, as today.

## 3. Grade bands (D-100)
GS 1 to 7, GS 8 to 11, GS 12 to 13, GS 14 to 15 (General Schedule and equivalent plans, including law enforcement
rates); Senior executives (SES, senior level, executive pay); Federal wage system; Attorney and judge pay plans (almost
all Assistant U.S. Attorneys and immigration judges).

## 4. Copy (proposed; all keys new unless marked "changed")
| Key | Text |
|---|---|
| shell:nav.departures (changed) | Hires and departures |
| shell:dep.intro (changed) | Who has joined and who has left the Justice Department since January 2025, compared with earlier administrations at the same point in office. |
| shell:dep.mode | Show |
| shell:dep.mode.departures | Departures |
| shell:dep.mode.hires | Hires |
| shell:tile.newHiresSince | New hires since January 2025 |
| shell:tile.transfersInSince | Transfers in since January 2025 |
| shell:tile.hireRateSince | Hire rate (annualized) |
| shell:dep.running.title.hires | Hires since taking office |
| shell:dep.how.title | Hiring streams, first {n} months |
| shell:dep.how.note | Note: New hires are counted as joining from outside the federal government; transfers are inter-agency moves. |
| shell:dep.how.transfersIn | Transfers in |
| series:acc_competitive | Competitive service new hires |
| series:acc_excepted | Excepted service new hires |
| series:acc_ses | Senior Executive Service appointments |
| shell:dep.join.title | New hire demographics, first {n} months |
| shell:dep.join.note | Hires in the first {n} months in office, annualized, per 100 of the group's average number of employees. |
| shell:dep.join.noteShare | Share of hires in the first {n} months in office whose {dimension} is known. |
| shell:dep.join.axis | Hired per year, per 100 employees |
| shell:dep.join.axisShare | Share of hires |
| shell:dep.join.tip | {admin}: {rate} hires per year for every 100 employees in this group ({count} hires) |
| shell:dep.join.tipShare | {admin}: {pct} of hires ({count}) |
| shell:dep.join.unknownAdmin | {admin}: {count} hires with unknown {dimension} are counted in the total but not shown as a group. |
| shell:dep.join.unknownAdmin1 | {admin}: 1 hire with unknown {dimension} is counted in the total but not shown as a group. |
| shell:dep.who.dim.edu | Education |
| shell:dep.who.dim.vet | Veteran status |
| shell:dep.who.dim.grade | Grade level |
| shell:dep.join.dim.prior | Prior federal service |
| shell:dep.join.dim.program | Student and early-career programs |
| who-is-leaving:dim.edu | education |
| who-is-leaving:dim.vet | veteran status |
| who-is-leaving:dim.grade | grade level |
| who-is-leaving:dim.prior | prior federal service |
| who-is-leaving:dim.program | early-career program |
| who-is-leaving:group.edu.hs | High school or less |
| who-is-leaving:group.edu.some | Some college or associate degree |
| who-is-leaving:group.edu.ba | Bachelor's degree |
| who-is-leaving:group.edu.ma | Master's or professional degree |
| who-is-leaving:group.edu.phd | Doctorate |
| who-is-leaving:group.vet.y | Veterans |
| who-is-leaving:group.vet.n | Non-veterans |
| who-is-leaving:group.grade.gs1_7 | GS 1 to 7 |
| who-is-leaving:group.grade.gs8_11 | GS 8 to 11 |
| who-is-leaving:group.grade.gs12_13 | GS 12 to 13 |
| who-is-leaving:group.grade.gs14_15 | GS 14 to 15 |
| who-is-leaving:group.grade.senior | Senior executives |
| who-is-leaving:group.grade.wage | Federal wage system (trades and crafts) |
| who-is-leaving:group.grade.legal | Attorney and judge pay plans |
| who-is-leaving:group.prior.lt1 | Under 1 year (new to federal service) |
| who-is-leaving:group.prior.1_4 | 1 to 4 years |
| who-is-leaving:group.prior.5_9 | 5 to 9 years |
| who-is-leaving:group.prior.10plus | 10 years or more |
| who-is-leaving:group.program.intern | Interns and student trainees |
| who-is-leaving:group.program.recent | Recent graduates |
| who-is-leaving:group.program.pmf | Presidential Management Fellows |
| who-is-leaving:group.program.other | All other hires |
| shell:dep.who.gradeNote | GS includes the General Schedule and equivalent plans, including law enforcement rates. Attorney and judge pay plans are almost all Assistant U.S. Attorneys and immigration judges. |
| shell:dep.join.gradeNote | Most people are hired at entry grades and promoted out of GS 1 to 7, so hire rates in that band are high. |
| reading-the-data:rates.hire | Hire rate: all hires, new hires and transfers in, per 100 employees on average, counted the same way as the departure rate. |

Final key names may change in the build; the text may not without a new sign-off. The build kept every key name;
shell:dep.join.gradeNote is the Hires-mode grade note signed in D-102; shell:dep.how.transfersIn is the chart 2 label signed in D-103.
