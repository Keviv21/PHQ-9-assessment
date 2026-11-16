# Assessment import status

The 13 November 2026 repaired export contains 186 draft records. Prescribe Test can start a saved voice or on-screen review for 162 of them. DASS-21 now has an implemented score; the others use their dedicated scored flows (PHQ-9, GAD-7, PCL-5) or save answers without a score. Compared with the prior import, 53 additional records have usable question and response structures. For 16 of these, the export prints numeric choices but labels only the scale endpoints; those choices display the printed numbers and available endpoint words.

The other 24 records remain catalogue-only. The number in the last column is the number of items without a complete choice structure. The source needs to provide the missing response sets or, for SDQ, its questions before these can run as the same questionnaire. We have not invented choices or scoring rules.

| Assessment | Extracted items | Incomplete items |
| --- | ---: | ---: |
| Ask Suicide-Screening Questionnaire (asQ) | 8 | 2 |
| Brief Addiction Monitor – Continuous (BAM) | 23 | 16 |
| Client Satisfaction Survey (CSS) | 10 | 2 |
| Composite Caregiving Questionnaire (CCQ) | 45 | 3 |
| CRAFFT Substance Use Assessment (CRAFFT 2.1+N) | 20 | 4 |
| Eating Disorder-15 (ED-15) | 15 | 5 |
| Gender Preoccupation and Stability Questionnaire 2 (GPSQ-2) | 17 | 2 |
| Kessler Psychological Distress Scale PLUS (K10+) | 14 | 3 |
| Multilevel Assessment of Psychopathology (MAPsy) | 155 | 1 |
| Obsessional Compulsive Inventory – Child Self Report (ChOCI-R-S) | 38 | 6 |
| Obsessional Compulsive Inventory – Revised Parent (ChOCI-R-P), source record 1 | 38 | 6 |
| Obsessional Compulsive Inventory – Revised Parent (ChOCI-R-P), source record 2 | 38 | 6 |
| PARDI-AR-Q | 29 | 4 |
| PARDI-AR-Q, informant report | 29 | 4 |
| Preschool Anxiety Scale (PAS) | 35 | 1 |
| Spence Children’s Anxiety Scale – Child (SCAS-Child) | 46 | 1 |
| Spence Children’s Anxiety Scale – Parent (SCAS-Parent) | 39 | 1 |
| Strengths and Difficulties Questionnaire (SDQ) | 0 | 0 |
| WHODAS 2.0 – Self Report | 39 | 3 |
| Vanderbilt ADHD Diagnostic Teacher Rating Scale (VADTRS) | 44 | 1 |
| WHODAS – Children and Youth | 40 | 5 |
| WHODAS 2.0 – Interview | 43 | 5 |
| WHODAS 2.0 – Proxy | 39 | 3 |
| Your Experience of Service (YES) | 28 | 2 |

The repaired export marks no record as scoring enabled or ready for clinical use. It has structured draft rules for eight forms and no structured rules for the other 178. The app has independently implemented and tested scoring for PHQ-9, GAD-7, PCL-5, and DASS-21; the remaining forms save selected answers without a score. DASS-21 follows the [published NovoPsych raw-score guidance](https://novopsych.com/assessments/depression/depression-anxiety-stress-scales-short-form-dass-21/) for its total, subscales, and severity bands. Percentiles and change calculations are not included. Run `npm run audit:assessments -- <repaired-bundle.json>` to inspect scoring coverage before adding another rule.
