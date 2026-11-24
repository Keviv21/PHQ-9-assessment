# PHQ-9 graphical reports

PHQ-9 alone has a versioned `reporting.visualProfile` in `data/assessment-library.json`.
Its editable source is `data/report-profiles/phq9.json`. Other assessment records,
questions and scoring formulas are unchanged. Profile edits are presentation changes;
the scoring hash remains unchanged. The profile and data carry their own version.

The renderer supports a severity score bar, a community cumulative-reference curve,
observed severity distributions for three study groups, a compatible-visit trend,
and an item response chart. Every figure is locally rendered SVG in HTML and PDF.
No remote report, image, font, or chart service is needed.

Reference data:
- Kliem et al. (2024), Tables 2–3, DOI 10.3389/fpsyt.2024.1483782, CC BY.
  https://digitalcollection.zhaw.ch/server/api/core/bitstreams/71436c28-4e92-4658-9e56-5d61fa07678b/content
- Kroenke, Spitzer & Williams (2001), Table 2, DOI 10.1046/j.1525-1497.2001.016009606.x.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC1495268/

The community reference is the German sample of 2,519 respondents aged 16–96,
surveyed in 2020–2021. It is not an individually matched norm. The clinical
subgroups are from a separate US primary-care study. The graph labels explicitly
identify these populations. Distribution percentages are counts divided by group
size. No normal curve, quartile, or diagnostic probability is estimated.
The published cumulative table omits score 24 and censors score 27 as >99.9.
Those cases remain missing and censored, respectively; there is no interpolation.
Development review labels remain visible. Scores are read from completed sessions.

Update only PHQ-9 in the runtime library:

```sh
node scripts/update-phq9-report.mjs /path/to/all-assessments.json
```

Import only this definition into the configured database:

```sh
npm run library:import -- --source /path/to/all-assessments.json \
  --source-root /path/to/assessment-url-preview \
  --expected-database 'assessment_config_prototype' \
  --assessment-id patient-health-questionnaire-depression-phq-9--8f81b7b3270c
```

This preserves other database definitions and existing sessions. Startup merges the
runtime catalogue with active database records; database records take precedence.
Only report-compatible snapshots (identical scoring hash, language, context and
engine) share a PHQ-9 trend. Presentation versions alone do not break a trend.

New definition reports use the graphics automatically. Existing English PHQ-9
`v1-prototype` results opened through `report.html?id=...` redirect to the new
read-only adapter. It maps the original nine saved answers without changing the
stored score or session. Other languages keep their existing report path.

Open `/preview/phq9-report` for a clearly marked fictional three-visit example,
or add `?single=1`. The `.json` and `.pdf` endpoints are also available. These
previews do not create patient, session or assessment rows.
