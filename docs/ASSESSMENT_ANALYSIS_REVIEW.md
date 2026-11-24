# Assessment-specific analysis review

The extracted library contains 186 assessments, not 186 complete reproductions of the source reports. A questionnaire, raw scoring rules and archived screenshots do not themselves encode percentile conversions, subgroup thresholds, reference distributions or report layout. The earlier generic `reportPlan` previews were not consumed by the application's saved-report renderer. Database definitions also take precedence over file definitions at startup, so preparing a file did not activate it in the database-backed application.

This change adds `reporting.analysisProfile` to each candidate definition and connects it to the actual saved-report HTML/PDF routes. No shared database connection, import, activation, migration or restart was performed. Existing shared definitions and historical saved snapshots retain their existing behavior. Local candidate files are separate from `data/assessment-library.json`.

## Review in the real dev app

Run with Node 24 from this repository:

```sh
npm run library:preview-app
```

The launcher does not load `.env` or `.env.local`, explicitly disables `DATABASE_URL`, and creates a fresh private SQLite database under `local-data/analysis-sandbox-*`. The app runs at `http://localhost:4189`; the catalogue at `http://localhost:4189/preview/analysis` uses the application's real report renderer. New assessments can also be completed in the app. Preview pages use fictional answers; repeat previews use fictional visits. PDF generation needs Chromium (`REPORT_CHROMIUM_PATH`, default `/opt/google/chrome/chrome`). The launcher does not restart the existing server on 4174. Voice AI is disabled in this isolated review instance.

Candidate files are under `local-data/assessment-analysis/`:

- `assessment-library.json`: combined runtime library loaded by the isolated app.
- `definitions/<assessment-id>.json`: separate versioned questionnaire, rules and reporting configuration.
- `profiles/<assessment-id>.json`: report configuration for inspection.
- `readiness.json`: per-assessment implemented features and unresolved extraction/analysis gaps.
- `review-candidate.json`: original raw definitions plus candidate runtime versions; not an authorized import package.
- `browser-validation/`: 186 generated PDFs, screenshots and layout check results.

Rebuild into a **new** output directory (existing output is deliberately not overwritten):

```sh
npm run library:prepare-analysis -- /home/chandrikak/Pod_Dev/assessment-url-preview/assessment-exports/current/all-assessments.json local-data/assessment-analysis-next
npm run library:preview-app -- local-data/assessment-analysis-next/assessment-library.json
```

## What changed

ASRS now includes the three raw scores, five endorsement-count metrics, item-specific binary thresholds, exact community percentile lookups, score bands, reference comparison curves and a stacked symptom-endorsement graph. The archived sample responses reproduce raw scores 14 / 27 / 41, percentiles 80 / 79 / 82, and endorsement percentages 61% / 89% / 33%. The curves are explicitly labelled normal-model illustrations using published parameters; the numeric percentile results use the table, not a fitted CDF. Blank source cells stay unavailable. Adult reference applicability must be reviewed for each respondent. No diagnostic narrative is inferred.

PHQ-9 now uses the archived Kocalevent (2013) community lookup (N=5018), instead of the earlier Kliem (2024) research comparison. The sample's nine answers sum to 17 and map to percentile 99. A score of 7 maps to 87, rather than the previous reference's 89.4. The default single-visit report has a severity column and reference-population quartile intervals. The earlier extra item-profile and cumulative charts are not included in this candidate. Quartiles use the first discrete raw score reaching 25/50/75 percentiles; this does not reproduce the exact source density curves. An upper-tail inconsistency in the archived other-depressive-disorder reference column is retained in source evidence and excluded from patient percentile conversion.

ABUSI uses its exact extracted **NSSI treatment** percentile table, labelled as a treatment reference rather than community norms. Structured complete score bands are compiled only when their ranges are contiguous, non-overlapping and cover the configured metric range. Conditional risk tables and unsupported text descriptions are not silently converted into score bands.

Across all 186 candidates, 14 assessments have complete compiled score bands and 3 have exact percentile lookups. The rest can display available saved scores, individual responses and compatible visit trends; they still require instrument-specific analysis work. SDQ has no questionnaire in this extraction. **Full source-report equivalence verified: 0. Clinically approved: 0.** Matching two sample reports numerically does not establish all-case clinical validity.

Report values come from saved scores. Missing results do not become zero, missing visits break trend lines, and incompatible definitions/contexts/engines are excluded from comparisons. The scoring engine version advances for the conditional eligibility fix: when an ASQ parent question is ineligible, its dependent question is also ineligible. Unknown or cyclic dependencies remain unresolved.

## Evidence and validation

ASRS configuration: `data/report-profiles/asrs.json`; PHQ-9 source comparison: `data/report-profiles/phq9-source.json`. These retain SHA-256 identifiers of the archived PDFs/images. Source documents are used for offline verification only; report pages make no external document requests and contain no provider branding.

Checks cover the source sample values, item-specific ASRS thresholds, missing percentile cells, stale scoring fingerprints, PHQ-9 lookup selection, invalid band ranges, conditional eligibility, and the existing 137 source-based assertions across eight instruments. The actual HTTP flow completes 370 visits across all 185 available definitions, verifies saved JSON/HTML reports and analytics, and separately checks all 186 preview definitions. Browser checks cover single/repeated/missing scenarios (558 pages), mobile width 390, SVG geometry and 186 PDFs, with external requests blocked. These are software checks, not independent clinical approval.

The default `npm test` now targets `test/*.test.js`; it no longer accidentally invokes the separately operated disposable PostgreSQL rehearsal script through Node's filename discovery.

## Database activation after approval

Use the existing versioned library tables in `pod_assessment_prototype`; one assessment version per row, not one giant JSON record and not one table per assessment:

- `assessment_versions.definition` retains the raw source JSON; `runtime` stores the questionnaire, scoring rules and `reporting.analysisProfile` together as JSONB.
- `assessment_library.active_version_id` selects the version used for **new** sessions.
- `assessment_assets` and `assessment_version_assets` retain file hashes and object-storage keys. Image/PDF bytes belong in object storage. The source archive is not an approved patient-facing image collection.
- Completed sessions retain the exact definition and score snapshot used at administration.

Before shared activation, review the particular instrument's missing features, population applicability, normative evidence, conditional rules and example outputs. Merge the revised runtime with its existing archived asset links, test the exact candidate in a disposable database, then approve a selected-version import/activation. Do not run the old source importer expecting it to preserve these compiled profiles automatically: it normalizes raw extraction and does not consume this candidate. Historical records should not be silently rescored. No shared import or new table creation is performed by this work.

## All-assessment local review (19 November 2026)

The dev-only candidate is `local-data/assessment-reports-all/`. No shared database import, commit, or push is part of this preparation. Its JSON definitions, report configurations, evidence and validation are local review artifacts. The existing default library and database selection are not changed by this candidate.

Open `index.html` for a searchable offline catalogue, or start the actual dev application with an explicit candidate and a private SQLite database:

```sh
ANALYSIS_PREVIEW_PORT=4191 npm run library:preview-app -- local-data/assessment-reports-all/assessment-library.json
```

Then open `http://localhost:4191/preview/analysis`. This launcher explicitly clears `DATABASE_URL`, does not load dotenv, and creates a fresh SQLite directory under `local-data/`. It cannot read existing shared-database patient visits. Actual saved visits in this isolated app use their saved responses; source sample answers are used only by the preview routes.

The candidate contains:

- `definitions/`: 186 complete assessment JSON files, including questions, scoring rules, interpretation guidance and report configuration.
- `report-configs/`: 186 report-only JSON files, including graph plans, score descriptors, available normative conversions, source sample comparisons and unresolved requirements.
- `comparison/`: per-assessment computed-versus-source score comparisons, including selected table column and source display precision.
- `evidence/`: archived sample text, page references, selected-response evidence, extraction issues and document hashes. These contain fictional source examples, not patient report templates.
- `reports/`: 186 standalone local HTML previews; their expandable review section shows comparison results and interpretation guidance.
- `browser-validation/pdfs/`: PDF previews produced through the same renderer, plus the browser validation results in the parent folder.
- `readiness.json`: full assessment-by-assessment counts and remaining work.
- `assessment-library.json`: combined candidate for the isolated app. Each definition has its own version ID; the combined file is a transport/review bundle, not a proposed single database record.
- `source-inventory.json`: links and hashes back to archived sample assets; no sample PDF URL is fetched at report time.

The final evidence inventory has 162 readable PDF samples, 3 image-only samples and 21 assessments without a usable archived sample. Complete selected-answer sets were recovered for 127 assessments. Numeric score comparisons were possible for 138 assessments (including partially recovered samples): 503 metric values match their source display precision. This is not a claim that all metrics, interpretations, charts, norms or clinical algorithms for those 138 assessments are verified. Forty-eight assessments still lack a numeric sample comparison. Graph-type identification is based on extracted sample text and guidance; it is not a visual/pixel comparison of every page.

149 additional source-explicit item groups were compiled across 38 assessments. These include source attributes as well as named subscales. Normal-distribution percentile conversions were enabled only where the guidance explicitly specified that method and its parameters: MAIA-2 and FAS. All nine available corresponding example percentiles match when rounded as displayed. Other reference statistics are retained for review without inventing a percentile conversion. Missing percentiles are never replaced by a raw percentage of the score range.

EAT-26 has one unresolved source-version/scoring conflict affecting the total and Dieting scores: the sample displays Q26/OFTEN as 1, while the extracted questionnaire maps that response to 0. Both affected report metrics/graphs remain withheld. Its Oral Control item list also contains the ambiguous token `1519`; the compiler does not guess its meaning. Details are preserved in that assessment's `sourceReport.reviewNotes`.

All report configurations are drafts. Full report equivalence and clinical approval remain unverified for every assessment. Narrative guidance is preserved; it is not automatically executed as diagnostic interpretation. Repeat charts require compatible saved visits, missing scores leave gaps, and synthetic history in review previews is labelled. Unknown age/sex/population inputs and missing norm tables are not guessed.

To rebuild from the already extracted local evidence without touching a database:

```sh
npm run library:prepare-all-reports -- local-data/assessment-reports-all/evidence local-data/assessment-reports-rebuilt
node scripts/verify-all-report-specs.mjs local-data/assessment-reports-rebuilt
```

The compiler refuses to overwrite an existing output folder. PDF extraction can be repeated using `scripts/extract-report-samples.py` with a Python environment containing PyMuPDF, the saved inventory, baseline library and a fresh evidence folder. Rebuilding source evidence requires the original archived PDF paths and text files listed in the inventory; the included extracted evidence is sufficient for JSON rebuilding.

After local review and explicit approval, the recommended database design remains one immutable, versioned JSONB definition record per assessment version, with report configuration included in that record, separate asset records pointing to object storage, and patient responses pinned to a definition version. Do not replace shared patient data or import this entire candidate as an approved clinical library.
