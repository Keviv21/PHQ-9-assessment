# Cleaned assessment bundle: implementation status

The 16 November cleaned bundle was the original import source. The later `all-assessments.json` export is synchronized into `data/all-assessments.json` and imported with `npm run db:import-content`. The runtime reads versioned assessment definitions from SQLite or PostgreSQL, not from the JSON file. The import includes questionnaire items, response schemas, conditional display rules, draft arithmetic rules, and review flags. Existing completed assessment records retain their earlier form snapshots. New generic sessions store a complete snapshot of the assigned form.

For the overall application path, see [prototype architecture](PROTOTYPE_ARCHITECTURE.md). For every source flag and an assessment-by-assessment matrix, see the [November 16 gap audit](NOVOPSYCH_20261116_GAP_AUDIT.md).

## What works in the local demonstration

- The Prescribe Test dropdown lists all 186 records. The 185 entries with questions can be assigned to a sample patient; the SDQ entry is disabled because the supplied record has no questionnaire.
- New forms accept single and multiple choice, integer, number, and text responses by voice conversation or on screen. Gemini Live speaks each available item, interprets the response against its permitted values, and saves it only after explicit confirmation. Source conditional questions use saved answers and explicit school/work context. The respondent reviews answers before finishing.
- The score engine evaluates `sum`, `mean`, `count_threshold`, and `weighted_sum`, including the supplied option values, thresholds, coefficients, transforms, skip policies, and source ranges. It withholds a metric when a required numeric value or context is unavailable. Reports show raw draft results, withheld reasons, recorded answers, and a visual range where bounds exist. They can be printed or saved as PDF.
- Assignments and results persist in isolated SQLite tables or in the `pod_assessment_prototype` schema of the configured PostgreSQL database. Completed results appear under View Test Reports and in patient analytics. New assessment metrics with a valid nonnegative source range appear as separate time series.
- PHQ-9, GAD-7, PCL-5, and DASS-21 continue to use the previously implemented conversational flows. All 185 records with questionnaires now offer voice conversation and an on-screen path. The new generic conversation uses the supplied English source wording; fixed translations for these imported forms are not yet provided.
- BAM Continuous calculates separate Substance Use, Risk Factors, and Protective Factors draft composites. Its 17 numbered items include seven item-7 subitems, producing 23 response fields. Numeric skip conditions for Q5 and Q7–Q13 are handled in both the browser and server and have a completion regression test.

## Source gaps that code cannot fill

| Record | Issue | Current behavior |
| --- | --- | --- |
| SDQ | No questionnaire or variant-specific scoring in the supplied JSON | Visible but unavailable for assignment |
| LEC-5 | Descriptive exposure inventory; no numeric score defined | Responses and answer report only |
| asQ | Source screening protocol, no numeric total, and no approved clinical handling workflow | Responses and answer report only; no inferred clinical state |
| Remaining 183 records | Draft arithmetic rules exist, but `scoring.enabled` is false and none is marked clinically approved | Clearly labelled draft raw calculations only |

The source audit finds 729 draft scoring rules. A synthetic coverage run calculates 728; one CRAFFT rule correctly does not apply to the chosen answers. The ORT rule is withheld if the source scoring category and selected options conflict. This does not validate the formulas, instrument versions, eligibility, reverse coding, source translations, cutoff interpretations, or respondent safety workflow.

The bundle itself has `scoring.enabled: false` for all 186 records. The application may display draft raw metrics from its own deterministic evaluator after final review; this is separate from source approval. The source also marks 177 records for selection/branching review and 14 for item-count reconciliation. The BAM count difference has a likely explanation in the official form, recorded in the gap audit.

### BAM Continuous example

| Draft composite | Imported response fields | Raw range |
| --- | --- | ---: |
| Substance Use | Q4 + Q5 + Q6 | 0–90 |
| Risk Factors | Q1 + Q2 + Q3 + Q14 + Q17 + Q21 | 0–180 |
| Protective Factors | Q15 + Q16 + Q18 + Q19 + Q20 + Q22 | 0–180 |

Numeric day counts contribute 0–30; the categorical fields use the printed 0, 8, 15, 22, or 30 values, except the income item, which uses 0 or 30. When Q4 is zero, Q5 is hidden and contributes zero. Q7–Q13, corresponding to numbered item 7a–g, and Q23 are recorded but excluded from the composites. This mapping follows the [VA BAM instructions](https://www.mentalhealth.va.gov/healthcare-providers/docs/VA_OMH_The_Brief_Addiction-Monitor_Instuctions_508.pdf). There is no single BAM total, severity band, or percentile in this implementation. The generic score engine returns `source_draft_unapproved` for these metrics; `test/definition.test.js` checks the numeric skip path and a completed three-composite calculation.

Exact NovoPsych-style output requires approved source materials for each assessment's questionnaire version, scoring logic, reference norms, percentiles, reliable change, and interpretation. The supplied file explicitly does not mark any assessment ready for clinical use. The local report therefore does not claim equivalence to the NovoPsych platform report. Before actual patient use, a qualified reviewer should approve each form, scoring rule, report interpretation, respondent group, and required escalation workflow.

## Check locally

1. `npm test`
2. `npm run check:definitions`
3. `npm run dev`, then open the local address and assign **Adult ADHD Self-Report Scale** to a sample patient.
4. Choose **Start voice conversation**, allow the microphone, answer naturally, and confirm or correct each proposed answer. You can switch to the on-screen form. Edit an answer in final review and use **Print / Save PDF** on the result.
