# All-assessment report visual specifications

The application owns one self-contained visual-spec bundle for all 186 active assessment definitions. Runtime report generation reads the active specification from PostgreSQL and does not read the extraction workspace, archived PDFs, PNG previews, or source websites.

The bundle records assessment and definition identity, questionnaire count, score-rule bindings, first-administration and repeat-administration chart configurations, axes, colors, tables, sections, observed report page/chart/table inventory, validation state, and explicit exception codes. Source evidence is represented only by stable hashes and page counts.

The import uses the existing `report_visual_spec_versions`, `assessment_report_visual_specs`, and `report_visual_spec_imports` tables. It does not create an assessment-specific table or store a local path or external URL.

Current readiness:

- 186 active specifications
- 185 generic schema-driven report layouts
- 1 detailed AIS source-layout specification
- 124 assessments with at least one observed chart candidate
- 62 assessments with no chart detected in the available sample report
- 2 assessments with image-only evidence
- 183 assessments with at least one renderable numeric chart
- 1 extraction record marked as having a locally verified numeric template
- 0 specifications marked visually equivalent or clinically approved

AIS has the detailed four-page source-layout specification and passed its recorded sample score checks, while full visual equivalence remains pending. The generic specifications are usable draft reports. Their source chart geometry and chart types are retained for review, but unverified population norms, percentile conversions, severity thresholds, sample patient values, and image-derived formulas are not executed. The exception report lists the remaining work per assessment.

Files:

- `data/report-profiles/all-assessment-report-visual-specs.json`
- `data/report-profiles/all-assessment-report-visual-spec-exceptions.json`
- `data/schemas/report-visual-spec-bundle.schema.json`
- `scripts/import-all-report-visual-specs.mjs`
