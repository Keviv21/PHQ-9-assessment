# Offline assessment-library preparation

This workflow prepares all 186 assessments for review without starting the main app, reading `.env`, contacting PostgreSQL, changing active definitions, reading patients, or uploading files. The existing dev application on port 4174 remains unchanged. Use a separate preview server on port 4188.

## Run with Node 24

```sh
npm run library:prepare -- --source /home/chandrikak/Pod_Dev/assessment-url-preview/assessment-exports/current/all-assessments.json --source-root /home/chandrikak/Pod_Dev/assessment-url-preview
npm run library:verify-review -- --dir local-data/assessment-review
npm run library:check-review-browser -- --dir local-data/assessment-review
npm run library:preview
```

Preparation refuses to overwrite an existing output directory. For another revision, pass `--out local-data/assessment-review-v2` to preparation and `--dir local-data/assessment-review-v2` to the remaining commands. Browser validation requires Chrome (default `/opt/google/chrome/chrome`, configurable through `REPORT_CHROMIUM_PATH`). No command above loads environment files. The verification command creates only a hard-coded in-memory SQLite database, which is discarded when it exits. It does not accept a PostgreSQL URL.

## What is prepared

- A separate complete definition and report profile for each assessment.
- A combined runtime JSON export and private import candidate, both linked by content hashes.
- Assessment-specific readiness reports and CSV, with missing information and withheld features.
- Three synthetic HTML previews per assessment: one visit, repeated visits, and missing responses.
- Source asset checksums and proposed content-addressed storage keys. The original source files remain where they are; nothing is uploaded.
- An import proposal mapping to the existing five versioned library tables.
- Offline read-back/idempotency/history verification in SQLite and optional browser/PDF results.

Generated artifacts belong in ignored `local-data/assessment-review/`. The tooling and documentation can be reviewed in Git; this workflow does not commit or push changes. Keep the raw import candidate and asset manifest private. The local preview server intentionally exposes only sanitized definitions, profiles, reviews, rendered previews and summary plans. It binds to loopback and permits GET/HEAD only.

## Configuration and rendering

Each `definitions/<assessment-id>.json` contains `reporting.reportPlan`. `profiles/<assessment-id>.json` is a review copy of that same configuration. `src/assessment-review-html.js` consumes the embedded plan directly; it does not read per-assessment local profiles as fallbacks.

Every numeric metric keeps its own source rule, scale and units. A range bar shows the current stored result. A line chart uses compatible saved administrations and breaks at missing scores. There is no cross-scale normalization, invented combined total, automatic improvement label or interpolated norm. The synthetic preview uses the existing scoring engine to create fictional saved result objects; actual report rendering reads those values rather than recalculating them.

The 183 numeric assessments have draft chart configurations. LEC-5 is descriptive, ASQ displays responses without protocol interpretation, and SDQ is explicitly unavailable because its extracted questionnaire is absent. No numeric graph is manufactured for these cases.

The older PHQ-9 profile is retained as a disabled supplementary candidate. Its community reference differs from the supplied reference report. The review preview defaults to neutral raw-score charts; normative comparisons and severity interpretation remain withheld until the reference data and intended application are reviewed. This does not change the currently running PHQ-9 report.

## What validation means

Structural checks verify identities, metric/rule links, bounds, chart references and unchanged scoring hashes. Generated input cases check valid selections, configured bounds and withheld missing results. They exercise software; they do not independently prove the extracted rule is the correct rule for the instrument.

Existing source fixtures cover only eight instruments, with 137 score assertions and three known gaps that must remain withheld. All 186 require clinical review. A technically passing assessment is not automatically clinically valid, licensed for every intended use, or equivalent to a source website's report. Source PDFs/screenshots are evidence for review, not runtime patient graphs.

Browser validation checks every generated HTML preview at desktop and 390px mobile width, prevents external asset requests, checks SVG values and creates one PDF per assessment. PDFs and screenshots are in `browser-validation/`; `results.json` records the checks. Print / save PDF also works from each preview.

## Recommended database design and later promotion

Reuse the existing library design, subject to a later approved schema compatibility check:

| Table | Role |
| --- | --- |
| `assessment_library` | Assessment identity and active-version pointer |
| `assessment_versions` | Immutable version; source extraction and runtime definition in JSONB |
| `assessment_assets` | Hash, storage key, MIME type and size |
| `assessment_version_assets` | Version-to-asset links and display review metadata |
| `assessment_imports` | Import manifest and source provenance |

Store one versioned JSON record per assessment, not one huge database row. The combined JSON is a transport/backup artifact. Patient answers and scores remain separate and retain the exact definition version used. Store file bytes in private object storage and their keys in PostgreSQL; generate patient graphs from saved scores.

`import-plan.json` compares candidates only with the local runtime baseline. It does not claim to know what currently exists in the shared database. No database writes or active-version changes have been approved for this work.

After user approval, first validate against an isolated PostgreSQL staging schema/database. Review every candidate to be activated, verify the database identity, take a backup of active-version pointers and use a transaction/import lock. Recheck active pointers before promotion so another user's changes cannot be silently overwritten. Insert immutable versions before separately promoting selected ones. Roll back by restoring those pointers; preserve older versions and all patient records.

Do not use the existing `library:import` command as a shortcut to import this review package: it normalizes the original extraction and immediately promotes active versions. A later approved importer must explicitly consume this exact checked candidate and separate staging from activation. The current work intentionally does not add a shared-database write command.
