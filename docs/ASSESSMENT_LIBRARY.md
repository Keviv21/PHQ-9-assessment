# Versioned assessment JSON library

The dev application supports the current 186-assessment export through a versioned
database library and the generated `data/assessment-library.json` runtime file.
The original extraction is preserved privately in database JSONB; public screens
receive selected display fields without provider marketing or source archive paths.
Instrument IDs remain stable, including historical source-derived identifiers.
Instrument references remain separate from branding. Check applicable reuse and
attribution requirements before publishing extracted text or images.

## Destination and configuration

The requested destination is database **`sagar prototype`**, schema
**`pod_assessment_prototype`**. Configure its `DATABASE_URL` in ignored `.env.local`
with `sslmode=verify-full`. Do not overwrite a different checkout's configured env.
Set `ASSESSMENT_DATABASE_NAME=sagar prototype` to prevent importing into another
database by mistake. The configuration is not committed.

Five additive library tables are used:

| Table | Content |
| --- | --- |
| `assessment_library` | Stable assessment identity and active version |
| `assessment_versions` | Original definition JSONB, runtime JSONB, hashes and versions |
| `assessment_assets` | Deduplicated file hashes, storage keys, MIME types and sizes |
| `assessment_version_assets` | Version-specific source references and display review |
| `assessment_imports` | Bundle checksum and import inventory |

Existing prescription and session tables are not modified by the importer.
Session creation freezes the runtime definition. Completed sessions save answers,
context, metrics, definition identity and scoring-engine version. A later import
does not recalculate completed results.

## Import and JSON export

Requires Node 24+, Python 3 (standard library only), and `npm ci`.

```bash
npm run library:import -- \
  --source ../assessment-url-preview/assessment-exports/current/all-assessments.json \
  --source-root ../assessment-url-preview \
  --expected-database "sagar prototype" \
  --export data/assessment-library.json \
  --dry-run
```

Use absolute source paths if running from a worktree outside `Pod_Dev`.
The dry run validates relationships, verifies scoring-content fingerprints using
the producer's Python canonical JSON format, checks all referenced file hashes,
and writes the requested runtime JSON. It does not write database rows or copy files.

Remove `--dry-run` to import. Use `--initialize-schema` only when deliberately
creating this schema in the selected database. The import transaction creates new
immutable versions and updates active pointers atomically. Identical records are
reused. Changes to content, normalization or display selection produce new versions.
Old versions remain available. The import reads back active versions before
reporting success; restart the app to refresh its in-memory library cache.

For an explicit offline test, add `--sqlite local-data/library-test.sqlite`.
This does not synchronize with PostgreSQL. The import inventory is written to
ignored `local-data/library-import.json`.

The generated JSON is a portable runtime catalogue, not a backup of the full
extraction. It contains all 186 normalized definitions, questions, scoring rules,
report settings, content sections and reference guidance. The original full records
and archived evidence remain in the extraction and in a successful database import.
`ASSESSMENT_LIBRARY_FILE=data/assessment-library.json` allows an empty library to
load the runtime file. Database connection failures still stop startup; this is not
a silent database fallback.

## Images and documents

The current source has 3,853 asset references, 2,969 unique local files (about
496 MB), and 49 references without an attached file. No missing file is fabricated.
Original archive paths remain private evidence metadata.

Files are copied to `ASSESSMENT_ASSET_ROOT` (default
`local-data/assessment-assets`) under `<first-two-hash-characters>/<sha256>`.
The archive is private, Git-ignored and checked before an import can commit.
Back up this directory together with the database. For deployment, use a durable
volume shared by all app instances. Cloud bucket upload is not configured by this
change; no S3 credentials or bucket were supplied.

The current display selection is empty. Captured logos, navigation, sample reports
and source snapshots are not automatically shown to patients. Charts are rendered
from saved results. Normative-table images are evidence, not executable scoring.

To enable a reviewed PNG/JPEG, pass `--display-manifest <file.json>` containing an
array of records with `assessmentId`, `assetId`, exact `sha256`, `alt`, optional
`caption` and `questionId`, plus actual `reviewedBy`, `reviewedOn`, and `reuseBasis`.
Do not invent reviewer identities. Selected images are served only through a
version-specific route; arbitrary archive files, PDFs and HTML are not public.
Images linked to a question appear alongside that question; other selected images
appear in assessment information. Reimport after reviewing the manifest.

## Scoring, reports and analytics

Set `ASSESSMENT_DRAFT_SCORES=true` only for development review of imported rules.
Default is false. Imported scores are labelled **Draft score — not clinically
validated**. Clinical approval, diagnostic interpretation and percentiles remain
disabled. Stale content, unsupported methods, missing required inputs and unknown
eligibility withhold results. NA choices do not become zero unless a rule explicitly
overrides their value. CORE-10 partial-response prorating and YES denominator
exceptions remain unimplemented; their affected results are withheld.

The scoring regression suite checks 137 supplied source-based score assertions in
eight instruments and three known missing/NA cases. This is technical verification,
not clinical approval of all 729 formulas.

The selected-assessment panel shows instructions, metadata, context sections,
reference tables, source scoring guidance (labelled as pending review), and citations.
The report uses persisted metrics and responses; separate measures retain their
own ranges, including signed ranges. Descriptive instruments do not gain a total.
Compatible sessions must match patient, definition/content, language, context and
scoring engine before baseline/previous comparisons are shown. No improvement or
reliable-change conclusion is inferred. Paired profiles and protocol interpretation
remain unavailable pending verification.

Saved report endpoints:

- `/api/definition-sessions/<id>/report.json`
- `/api/definition-sessions/<id>/report.html`
- `/api/definition-sessions/<id>/report.pdf`

PDF rendering uses locally installed Chromium through `playwright-core`.
Set `REPORT_CHROMIUM_PATH` to its executable. The renderer disables JavaScript and
blocks network requests; no patient content is sent to a PDF service. If Chromium
is unavailable, the HTML report can still be printed using the browser. PDFs are
generated on demand; this change does not add stored PDF artifacts.

## Verification

```bash
npm test
```

Set `TEST_REPORT_CHROMIUM_PATH` to include the PDF integration check. Set
`TEST_LIBRARY_DATABASE_URL` only to a disposable empty PostgreSQL database to run
the storage contract there. Never point that variable at the shared dev database.
The tests cover import idempotency, rollback, immutable history, public projections,
checksums, draft gating, source benchmarks, compatible analytics, HTTP reports and
descriptive questionnaires.

Production authentication and patient authorization are still outside this
prototype; this change does not make its existing patient APIs production-ready.
