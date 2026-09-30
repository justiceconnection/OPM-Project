# DOJ workforce dashboard: metric spec

Status: DRAFT for Cary's sign-off. Rows marked **proposed** are not yet decided; everything else cites the decision
that settled it (`ops/DECISIONS.md`, local only). Once signed, this file and opm-context section 6 must agree; the
cubes implement only what this file defines.

## 1. Scope and basis
- Population: DOJ rows, identified by `is_doj` (invariant 2).
- Range: October 2011 onward. Actions effective before October 2011 are excluded from every series and remain
  Look-Up rows (D-017).
- Time basis: hires and departures by effective month, `personnel_action_effective_date_month` (D-005). Processing
  month appears only in the Look-Up (invariant 6).
- One row is one person-action or one person-month; there is no person ID and no series joins people across months
  (invariant 10).

## 2. Grains and rollup rules (D-008, invariant 3)
| Kind | Rule | Examples |
|---|---|---|
| Stock | The period's last month | Headcount |
| Flow | Sum of the period's months | Hires, departures, each category, DRP |
| Rate | Recomputed from summed numerators and denominators, never averaged | Attrition, quit, retirement |

Grains: month, fiscal quarter, fiscal year (FY2025 = Oct 2024 to Sep 2025). A period with any month not yet
published is marked partial.

## 3. Metrics
| Metric | Definition | Kind |
|---|---|---|
| Headcount | Rows in the month's employment file | Stock |
| Hires | Accession rows effective in the month | Flow |
| Departures | Separation rows effective in the month | Flow |
| Net flow | Hires minus departures. Never derived from, or reconciled to, headcount change (invariant 7) | Flow |
| Headcount change | Headcount at period end minus headcount at the previous period's end | Stock difference |
| Attrition rate | All departures over 12 months (transfers out and DRP included) / average headcount over the same 12 months (D-006) | Rate |
| Quit rate | Same form, departures restricted to SC | Rate |
| Retirement rate | Same form, departures restricted to SD + SE + SG | Rate |
| Years of service lost | Sum of length of service across departures, shown with its coverage | Flow |

**Proposed** details, for sign-off:
- P1. "Average headcount over 12 months" is the mean of the 12 month-end headcounts ending in the rate's last month.
- P2. A rate at month or quarter grain is the trailing 12 months ending in that period's last month; at fiscal-year
  grain it is that fiscal year. A partial fiscal year shows the trailing 12 months ending in its latest month, marked
  partial.
- P3. A rate needs 12 published months; the first 11 months of the range (Oct 2011 to Aug 2012) show no rate.

## 4. Categories (D-015)
Every category is a flow and is always available as its own series. Categories partition the total exactly each
month (invariant 5, gate check `codes_mapped_and_partition`).

Departures, all counted in attrition:
| Series | Codes | Label | Label status |
|---|---|---|---|
| Transfer out | SA, SB | Transfer out | proposed |
| Quit | SC | Quit | proposed |
| Retirement | SD, SE, SG | Retirement | proposed |
| RIF | SH | RIF | signed |
| Termination | SJ | Termination: expired appointment or other | signed |
| Other | SL | Other | signed |
| DRP (overlay) | `drp_indicator = 'Y'`, any code | DRP | proposed |

DRP cuts across the categories (from March 2025), so it is an overlay, not a partition member (D-006).

Hires:
| Series | Codes | Label | Label status |
|---|---|---|---|
| New hire | AC, AD, AE | New hire | proposed |
| Transfer in | AA | Transfer in | proposed |

Components: `pipeline/crosswalks/components.csv`, display names signed (D-016).

## 5. Flags
| Flag | Rule | Source |
|---|---|---|
| Provisional | The newest 3 effective months, and any period containing one | D-005, invariant 8 |
| Reissued | A month whose file version changed since the previous refresh | Invariant 8 |
| Incomplete | A month OPM marks incomplete for DOJ | Invariant 8 |
| Small base | Rate whose average headcount is below 30; shown, never suppressed | D-007, invariant 9 |
| Coverage | Share of rows not redacted, on any figure built from a partly redacted field | Invariant 4 |
| Partial | Period with months not yet published | Invariant 3 |

## 6. Known breaks (D-012)
Headcount change and net flow differ by more than 500 in FY2025 (+3,958) and FY2026 (-4,228) because of the DRP
wave: 4,816 departures effective September 2025, while headcount fell 3,860 in October 2025. **D-012 is still
awaiting Cary's sign-off.**

## 7. Open items
- Sign P1 to P3.
- Sign the labels marked proposed (they are user-facing copy).
- Sign D-012.
- Confirm the length-of-service field and its unit before building years of service lost.
