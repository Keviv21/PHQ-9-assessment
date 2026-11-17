# Branch cleanup

The cleanup organizes the `chandrika` working tree without changing main/sagar branches or either Neon database. Existing local UI and database changes are included in the reorganized files. `.env`, private patient JSON, databases, backups and dependencies stay in place.

## Reorganized

- Current frontend pages/modules are grouped under `public/workspace`, `public/session`, `public/shared` and `public/assets`.
- PostgreSQL and offline SQLite adapters are grouped under `src/storage`; current workspace services remain under `src/workspace`.
- Structured doctor-guidance rules live under `src/clinical`.
- Still-reachable original pages, standard forms, draft reviews and analytics/report logic are isolated under `public/legacy`, `src/legacy` and `data/legacy`.
- Current catalogue import, database migration and historical utilities have separate script folders.
- Synthetic data is in `data/fixtures`; private patient imports remain ignored under `local-data`.
- The package is named `pod-assessment-platform`. Existing start and migration commands remain available. `import:assessments` now imports the active workspace catalogue; `import:legacy` retains the original bundle importer.
- README now describes the active app. The workflow, architecture and editable diagram replace outdated prototype-only explanations.

## Removed after reference checks

| Removed file | Reason |
| --- | --- |
| `public/analytics.js` | Old standalone analytics controller was no longer loaded by any page; workspace analytics is active |
| `public/analytics.css` | Its standalone layout was not referenced by any page |
| `public/assessment-library.js` | Superseded by the active workspace library controller; no page loaded this script |
| `docs/ASSESSMENT_IMPORT_STATUS.md` | Historical source counts conflicted with the current November 16 catalogue |
| `docs/SAGAR_FEATURE_PARITY.md` | Historical branch-comparison checklist superseded by current architecture/workflow documentation |
| `docs/WORKFLOW_AND_PERFORMANCE.md` | Described an old SQLite/confirmation-only flow; replaced by current workflow documentation |

Removed scripts no longer appear in the public asset allowlist. Existing functional compatibility pages remain available. The previously nonexistent `/assessment-library.html` target now resolves to the workspace instead of a missing file.

## Intentionally retained

The full raw source export supports provenance and reproducible import. Historical form JSON remains necessary for original routes and saved sessions. SQLite code supports offline tests and migration, while the running app uses Neon. Patient backups and ignored local files are recovery data, not cleanup targets.

Before applying the reorganization, affected original project files are archived in ignored `local-data/backups/`. This is a filesystem cleanup only; no database tables or records are deleted. Restart an already-running Node process after file moves so it loads the new module and asset layout.
