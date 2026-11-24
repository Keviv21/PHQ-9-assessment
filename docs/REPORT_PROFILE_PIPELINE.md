# Database report profile pipeline

The report pipeline compiles the archived assessment HTML/PDF evidence once and stores the resulting versioned definitions and report profiles in PostgreSQL. The assessment and report runtime does not fetch NovoPsych or read report configuration from local files.

## Source and compilation

The source extraction is maintained in `/home/chandrikak/Pod_Dev/assessment-url-preview`. The reviewed compiler output is `local-data/assessment-reports-all` and contains definitions, private source evidence, report profiles, generated draft reports, comparison results, and a readiness manifest.

Run the structural and score checks before importing:

```bash
npm run library:verify-all-reports
```

Apply migrations and import the compiled catalogue:

```bash
npm run db:migrate:patients
npm run library:import-report-profiles -- \
  --source local-data/assessment-reports-all \
  --expected-database assessment_config_prototype
```

The import is content-addressed, transactional, idempotent, and retains prior versions. It verifies that every report profile's scoring hash matches its assessment runtime before activation.

## PostgreSQL records

- `assessment_library` selects the active assessment version.
- `assessment_versions` stores the original source JSONB and compiled runtime JSONB.
- `report_profile_versions` stores private source evidence, a sanitized runtime profile, validation results, the renderer version, and the linked assessment version.
- `assessment_report_profiles` selects the active report-profile version.
- `report_profile_imports` stores the compilation/import manifest.
- `definition_sessions.state` saves the exact assessment and report-profile snapshot used by a patient.

Source sample answers and detailed source comparisons remain in `report_profile_versions.source_profile`. They are not exposed through `/api/definitions`. The runtime profile contains deterministic chart configuration, source section inventory, coverage, validation status, and layout metadata.

## Verification and exceptions

Run the ten-archetype PostgreSQL smoke test:

```bash
npm run library:smoke-report-profiles
```

Read the current DB-backed readiness report at:

```text
GET /api/report-profiles/readiness
```

Each assessment records missing sample reports, image-only sources, incomplete recovered answers, unresolved score differences, missing graph configuration, full-equivalence status, and clinical-approval status. A draft report being available does not imply full source equivalence or clinical approval.

## Current readiness

- 186 versioned report profiles are active.
- 185 assessments can produce draft reports; one questionnaire is unavailable.
- 162 have readable source sample PDFs; three are image-only and 21 have no usable sample.
- 138 have at least one matched source metric, covering 503 matched score checks.
- One assessment has unresolved source-score differences; conflicting metrics are withheld.
- Full report equivalence and clinical approval remain pending for every assessment.

Exact equivalence must remain false until required normative conversions, image-only content, missing graphs, page geometry, interpretation rules, and visual comparisons have been independently reviewed.
