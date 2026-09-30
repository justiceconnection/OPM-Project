# DOJ workforce dashboard: metric spec

Status: signed by Cary on 2026-09-30 (D-019 to D-021). Every row cites the decision that settled it (`ops/DECISIONS.md`, local only). Once signed, this file and opm-context section 6 must agree; the
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
| Years of service lost | Sum of length of service across departures, shown with its coverage. Values on a signed known-data-issue list count as unknown (D-026) | Flow |

Rate methods (D-019). The viewer chooses; A is the default. The small-base flag uses the chosen method's average
headcount.
| Method | Numerator | Denominator | Grains |
|---|---|---|---|
| A. Trailing 12 months (default) | Departures in the 12 months ending in the period's last month | Mean of those 12 month-end headcounts | All; a fiscal year is that year; a partial fiscal year shows its trailing 12 months, marked partial; no rate before Sep 2012 |
| B. Fiscal year only | Departures in the fiscal year | Mean of its month-end headcounts | Fiscal year only; month and quarter show no rate; a partial fiscal year shows year to date, not annualized, marked partial (D-023) |
| C. Annualized per period | Departures in the period, times 12 / months published in the period | Mean of the period's published month-end headcounts | All (D-025) |

Method names on the page are copy, signed with the page spec.

## 4. Categories (D-015)
Every category is a flow and is always available as its own series. Categories partition the total exactly each
month (invariant 5, gate check `codes_mapped_and_partition`).

Departures, all counted in attrition:
| Series | Codes | Label | Label status |
|---|---|---|---|
| Transfer out | SA, SB | Transfer out | signed |
| Quit | SC | Quit | signed |
| Retirement | SD, SE, SG | Retirement | signed |
| RIF | SH | RIF | signed |
| Termination | SJ | Termination: expired appointment or other | signed |
| Other | SL | Other | signed |
| DRP (overlay) | `drp_indicator = 'Y'`, any code | DRP | signed |

DRP cuts across the categories (from March 2025), so it is an overlay, not a partition member (D-006).

Hires:
| Series | Codes | Label | Label status |
|---|---|---|---|
| New hire | AC, AD, AE | New hire | signed |
| Transfer in | AA | Transfer in | signed |

Components: `pipeline/crosswalks/components.csv`, display names signed (D-016).

A component that stops appearing in employment has no rows after its last month (D-024). A month with no
employment rows keeps headcount 0, and a rate with a zero denominator is empty (D-027).

## 4a. Who is leaving breakdowns (D-031, D-038)
Departures and a departure rate per value of four dimensions. Rate = departures with that value / mean month-end
headcount with that value over the same window. Grains: fiscal year (B form; a partial year is year to date) and
trailing 12 months at each month end (A form). Never month or quarter.

| Dimension | Values |
|---|---|
| Length of service | <1, 1-4, 5-9, 10-19, 20-24, 25-29, 30+ years (lower bound inclusive); Unknown |
| Age | OPM brackets, "Less than 20" merged into "Under 25"; Unknown ("UNSPECIFIED") |
| Supervisory status | Supervisor or manager (codes 2, 4, 5); all others (6, 7, 8); Unknown ("*") |
| Occupation | 1811 criminal investigation, 0007 correctional officer, 0905 attorney, all other |

- Unknown values (NULL, invalid codes, KDI-001) carry counts, never a rate; coverage is shown.
- A value with mean headcount 0 in the window is not applicable: empty rate, not a small-base flag.
- Occupational category is unusable for separations from the Jun 2024 file (KDI-002, D-032); series is used.

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
wave: 4,816 departures effective September 2025, while headcount fell 3,860 in October 2025. Signed (D-021).

## 7. Open items
- Method names for the rate selector (page-spec copy).
