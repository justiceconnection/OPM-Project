# October 2026 changes (L-126 to L-132)

Status: signed 2026-10-07 (D-089, D-090); built (L-126 to L-132). Amends `docs/pages/redesign.md` and
`docs/pages/appointments.md` where they differ.

## 1. Explore full history hidden (L-126)
The "Explore full history" section is removed from Overview, Departures and Components. `history-*.html`,
`main-explore.js` and the `explore.*` copy stay in the repo, unused, so it can return. Old addresses keep
redirecting to the main pages. No new copy.

## 2. Provisional marker on tiles (L-127)
The dashed-line glyph is replaced by a small text chip in the tile's top-right corner. The chip's tooltip and the
note under the tile row keep `shell:flag.provisional`; the note loses its leading glyph (it already starts with
"Provisional:").

| Key | Text |
|---|---|
| shell:flag.provisional.chip | Provisional |

## 3. Community Relations Service after April 2026 (L-128)
Rule (decision to record): DJ14 rows continue from May 2026 through the latest month in every per-entity cube
(doj_core, doj_core_series, doj_leaving, doj_leaving_series, doj_admin, doj_appointments), with headcount, hires
and departures 0. Rates on a zero denominator stay empty (D-027); leaving groups are not applicable (D-038). CRS
can be combined with other components in the multi-select; D-079 already handles its empty rates. The 9 people
on board in April 2026 have no recorded departure, which adds 9 to CRS's FY2026 gap between headcount change and
net flow (now 49: change -52, net flow -3).
The Look-Up is unchanged (it republishes OPM's files only). Amends D-024 and D-078.

| Key | Text |
|---|---|
| shell:sel.crsNote (shown when CRS is selected, alone or combined) | The Community Relations Service was eliminated in April 2026. It is shown with 0 employees from May 2026. |
| reading-the-data:source.p4 (replaces) | The Department's components are shown as OPM reports them. The Community Relations Service was eliminated in April 2026; OPM's files show no CRS employees after that month, so it is shown with 0 employees, hires and departures from May 2026. It is also missing from OPM's January 2026 file, so that month shows 0 employees. |

## 4. Component names and order (L-129)
Display names (amends D-016), used everywhere a component is named. Order in the selector, the Components
table's default order and the mini charts: the six below, then a "Main Justice" heading and the Main Justice six,
in Cary's order. Table sorting by column is unchanged.

| Code | Display name |
|---|---|
| DJ15 | Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF) |
| DJ03 | Bureau of Prisons (BOP) |
| DJ06 | Drug Enforcement Administration (DEA) |
| DJ02 | Federal Bureau of Investigation (FBI) |
| DJ09 | U.S. Attorneys' Offices and EOUSA |
| DJ08 | U.S. Marshals Service (USMS) |
| *Main Justice* | |
| DJ14 | Community Relations Service |
| DJ12 | Executive Office for Immigration Review (EOIR) |
| DJ01 | Offices, Boards and Divisions (Main Justice) |
| DJ10 | Office of the Inspector General (OIG) |
| DJ07 | Office of Justice Programs (OJP) |
| DJ11 | U.S. Trustee Program |

| Key | Text |
|---|---|
| shell:ctl.components.group.mainJustice | Main Justice |

## 5-6. Who is leaving on Departures (L-130)
One chart replaces the four panels. A "Group by" selector picks the dimension (default Years of service). For each
group, one bar per administration shown, scaled to the data (not to 100%). Bars carry the rate as a number; the
axis and tooltip say what it means. Unknown, small-base and not-applicable rules unchanged. Occupation is hidden from
the selector when a job series is selected.

| Key | Text |
|---|---|
| shell:dep.who.dim | Group by |
| shell:dep.who.dim.los | Years of service |
| shell:dep.who.dim.age | Age |
| shell:dep.who.dim.sup | Supervisors and everyone else |
| shell:dep.who.dim.occ | Occupation |
| shell:dep.who.axis | Left per year, per 100 employees |
| shell:dep.who.tip | {admin}: {rate} of every 100 employees in this group left per year ({count} departures) |
| shell:dep.who.note (replaces) | Departures in the first {n} months in office, annualized, per 100 of the group's average number of employees. |

## 7. Time range on the October 2011 charts (L-131)
Every chart that runs from October 2011 (Overview employees, Departures hires and departures, Appointments
workforce by type and hires and departures by group) gets "From [FY] to [FY]" selectors and a reset. Default: the
full range. The range applies at any View grain; the title follows it. Narrowing one chart does not change others.

| Key | Text |
|---|---|
| shell:ctl.range.from | From |
| shell:ctl.range.to | to |
| shell:ctl.range.reset | Full range |
| shell:ov.timeline.title (replaces) | Employees, {from} to {to} |
| shell:dep.timeline.title (replaces) | Hires and departures, {from} to {to} |
| shell:appt.mix.title (replaces) | Workforce by type of appointment, {from} to {to} |

`{from}` is the first month of the range (e.g. "October 2019"); `{to}` is its last month (the latest month when
the range runs to the end). Hires and departures by group gets the same selectors; its title is unchanged.

## 8. Workforce by type of appointment (L-132)
The stacked areas become small multiples: one line chart per group (seven groups, unknown in a note as today),
each on its own scale, administration bands shaded, expandable like the Components minis. The share/count toggle
applies to all of them.

| Key | Text |
|---|---|
| shell:appt.mix.note | Each chart has its own scale so changes in small groups are visible. Compare sizes using the numbers, not the heights. |
| shell:appt.mix.value | {value} in {month} |
