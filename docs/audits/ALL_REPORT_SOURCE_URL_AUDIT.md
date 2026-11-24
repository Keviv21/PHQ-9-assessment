# All Assessment Report Source URL Audit

Created: 2026-11-23T12:03:47.194229+00:00

This is a one-time preparation audit. It is not imported into PostgreSQL and is not used by the running application.

## Summary

- **assessments:** 186
- **archivePresent:** 185
- **missingArchive:** 1
- **withReportCandidate:** 185
- **withoutReportCandidate:** 1
- **uniqueReportUrls:** 200
- **verifiedTwoLocalTwoRemote:** 179
- **requiresReview:** 2
- **verifiedArchivedTwoLocalTwoRemote:** 179
- **verifiedViaIndependentLiveDiscovery:** 4
- **verifiedArchivedPlusAuthoritativeOpen:** 1
- **verifiedReportSources:** 184
- **deadReportUrls:** 1
- **withoutStandaloneReportUrl:** 1

## Unresolved exceptions

| Assessment | Status | Finding |
|---|---|---|
| Center for Epidemiological Studies Depression Scale for Children (CES-DC) | `dead_report_url_no_replacement` | Archived report URL returns 404; no replacement report found. |
| Why Have Sex? Questionnaire Short Form (YSEX-SF) | `no_archived_report_url_assessment_page_only` | No standalone report URL found; the live assessment page describes the report structure. |
