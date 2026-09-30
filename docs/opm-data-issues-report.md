# Draft: data issues found in OPM Federal Workforce Data (separations)

Status: DRAFT for Cary. Not sent. Figures measured 30 September 2026 against the current file versions listed in
the project manifest (separations files published 2026-04-30).

To: OPM Federal Workforce Data team
From: Justice Connection

We use the Federal Workforce Data separations and employment files to report on the Department of Justice
workforce. We found two issues in the separations release that we believe are processing errors, and we are
sharing them in case they are useful.

## 1. Length of service counted from 1 January 1900

In the separations files for June 2024 through July 2025, 7,667 records government-wide report
`length_of_service_years` between 124 and 126 years. For every one of them, the effective month minus the
published value falls between 1899.95 and 1900.03, so the value is the time elapsed since about 1 January 1900.
The same records carry a normal `service_computation_date_leave` (null on none of them, and 1900-01-01 on only 4).

| File (processing month) | Separations | Values of 124 to 126 years | Share |
|---|---|---|---|
| 2024-06 | 21,100 | 90 | 0.43% |
| 2024-07 | 17,727 | 99 | 0.56% |
| 2024-08 | 21,052 | 189 | 0.90% |
| 2024-09 | 20,318 | 807 | 3.97% |
| 2024-10 | 18,604 | 1,077 | 5.79% |
| 2024-11 | 17,978 | 1,132 | 6.30% |
| 2024-12 | 23,927 | 2,018 | 8.43% |
| 2025-01 | 22,271 | 1,093 | 4.91% |
| 2025-02 | 15,620 | 506 | 3.24% |
| 2025-03 | 22,084 | 604 | 2.74% |
| 2025-04 | 24,135 | 44 | 0.18% |
| 2025-05 to 2025-07 | | 8 | |

By department: Defense 6,154; Veterans Affairs 743; Homeland Security 399; Health and Human Services 66;
Treasury 42; Commerce 41; Justice 39; Agriculture 39; others fewer. No earlier file and no later file has any
value over 100 years, and the employment files for the same months are unaffected.

## 2. Occupational category missing from separations since June 2024

From the June 2024 separations file onward, `occupational_category` and `occupational_category_code` are empty:
null from June 2024 to March 2025, and "NO DATA REPORTED" from April 2025. For Justice, 797 of 799 records in the
June 2024 file and every record in the July 2026 file are affected; government-wide, 17,168 of 19,029 in the
June 2025 file. The employment files still carry the field. It cannot be reconstructed from the occupational
series, because some series map to more than one category depending on grade.

## How we handle them meanwhile

We publish OPM's values unchanged in our row-level tables. In our aggregates we treat the 1900-based lengths of
service as unknown (and show the reduced coverage), and we do not use occupational category for separations after
May 2024. We would welcome a correction or a data note, and will pick up any reissued files automatically.
