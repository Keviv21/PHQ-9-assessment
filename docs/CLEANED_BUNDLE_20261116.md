# Cleaned assessment bundle: implementation and source gaps

Source: `all-assessments-cleaned-20261116.json`, imported with `npm run import:new`. The generated runtime file is `data/assessment-definitions-20261116.json`; it includes the source file's SHA-256, questionnaire items, response schemas, conditional display rules, draft arithmetic rules, and review flags. Existing completed assessment records retain their earlier form definitions. New sessions store a complete snapshot of the assigned form.

## What works in the local demonstration

- The Prescribe Test dropdown lists all 186 records. The 185 entries with questions can be assigned to a sample patient; the SDQ entry is disabled because the supplied record has no questionnaire.
- New forms accept single and multiple choice, integer, number, and text responses by voice conversation or on screen. Gemini Live speaks each available item, interprets the response against its permitted values, and saves it only after explicit confirmation. Source conditional questions use saved answers and explicit school/work context. The respondent reviews answers before finishing.
- The score engine evaluates `sum`, `mean`, `count_threshold`, and `weighted_sum`, including the supplied option values, thresholds, coefficients, transforms, skip policies, and source ranges. It withholds a metric when a required numeric value or context is unavailable. Reports show raw draft results, withheld reasons, recorded answers, and a visual range where bounds exist. They can be printed or saved as PDF.
- Assignments and results persist in isolated SQLite tables or in the `pod_assessment_prototype` schema of the configured PostgreSQL database. Completed results appear under View Test Reports and in patient analytics. New assessment metrics with a valid nonnegative source range appear as separate time series.
- PHQ-9, GAD-7, PCL-5, and DASS-21 continue to use the previously implemented conversational flows. All 185 records with questionnaires now offer voice conversation and an on-screen path. The new generic conversation uses the supplied English source wording; fixed translations for these imported forms are not yet provided.

## Source gaps that code cannot fill

| Record | Issue | Current behavior |
| --- | --- | --- |
| SDQ | No questionnaire or variant-specific scoring in the supplied JSON | Visible but unavailable for assignment |
| LEC-5 | Descriptive exposure inventory; no numeric score defined | Responses and answer report only |
| asQ | Source screening protocol, no numeric total, and no approved clinical handling workflow | Responses and answer report only; no inferred clinical state |
| Remaining 183 records | Draft arithmetic rules exist, but `scoring.enabled` is false and none is marked clinically approved | Clearly labelled draft raw calculations only |

The source audit finds 729 draft scoring rules. A synthetic coverage run calculates 728; one CRAFFT rule correctly does not apply to the chosen answers. The ORT rule is withheld if the source scoring category and selected options conflict. This does not validate the formulas, instrument versions, eligibility, reverse coding, source translations, cutoff interpretations, or respondent safety workflow.

Exact NovoPsych-style output requires approved source materials for each assessment's questionnaire version, scoring logic, reference norms, percentiles, reliable change, and interpretation. The supplied file explicitly does not mark any assessment ready for clinical use. The local report therefore does not claim equivalence to the NovoPsych platform report. Before actual patient use, a qualified reviewer should approve each form, scoring rule, report interpretation, respondent group, and required escalation workflow.

## Check locally

1. `npm test`
2. `npm run check:definitions`
3. `npm run dev`, then open the local address and assign **Adult ADHD Self-Report Scale** to a sample patient.
4. Choose **Start voice conversation**, allow the microphone, answer naturally, and confirm or correct each proposed answer. You can switch to the on-screen form. Edit an answer in final review and use **Print / Save PDF** on the result.
