# GAD-7 pilot and patient storage

## Canonical assessment definition

`data/assessments/gad-7.json` is the pilot source of truth. It is independent of
ignored `local-data` review folders and contains:

- identity, version hashes, description, administration and reference period;
- all seven questions and the four response choices with printed and score values;
- the total-score rule, 0–21 range and candidate severity bands;
- content sections, guidance and references;
- report metrics, range and history chart configuration, axes, colour policy,
  comparison rules, response history and deterministic text templates;
- private provenance for the recovered sample report, including source document
  hashes, selected answers, page evidence, graph/scoring text and score comparison;
- technical verification and an explicit exception report.

Run:

```bash
npm run assessment:validate -- data/assessments/gad-7.json
```

The reusable contract is `data/schemas/assessment-definition.schema.json`. The
validator additionally checks reference integrity, severity-band coverage, chart
axes, sample-answer scoring and the absence of absolute or `local-data` paths.

Passing validation means the JSON is structurally and technically consistent. It
does not mark clinical review complete. The GAD-7 pilot currently keeps severity
interpretation, score direction, normative percentiles and complete source-report
equivalence disabled or explicitly pending review.

For each later assessment, generate the same canonical file and an exception
report with these independent lists:

- `missingScoringRules`
- `imageOnlyTables`
- `ambiguousSourceSections`
- `withheldCapabilities`
- `manualReview`

An assessment can be stored while exceptions remain, but unavailable or unreviewed
features must stay disabled in its runtime and report configuration.

## Patient import model

Patient source files are different from assessment definitions. An assessment
definition describes a reusable questionnaire. A patient import contains private
identity and clinical data, while an assessment session records one patient's
answers against one immutable assessment version.

The PostgreSQL model uses three tables in `pod_assessment_prototype`:

| Table | Purpose |
| --- | --- |
| `patient_imports` | Immutable original JSON, checksum, source metadata and validation outcome. |
| `patient_profiles` | One normalized identity per source-system patient ID. |
| `patient_documents` | MRI, ECG, CT, EEG, clinical-note and pharmacogenomic sections linked to a validated profile and import. |

The importer first hashes the exact file and checks every embedded patient ID.
Repeated imports of identical bytes return the existing import. A validated file
upserts the profile and creates one typed document per section in one transaction.
A file with conflicting patient IDs is stored as `needs_review`, with no profile
or documents created.

The current `local-data/neurotwin-patient.json` contains two distinct embedded
patient identifiers: the report-level, MRI, EEG and clinical-note identifiers
agree, while the CT identifier differs. Its import is therefore quarantined in
`patient_imports`. Review and correct the source identity or provide a documented
mapping before reimporting it as validated data.

Commands:

```bash
npm run db:migrate:patients
npm run patient:import -- /absolute/path/to/patient.json
```

Future application work should link assessment assignments and sessions to
`patient_profiles.id`. Reports should read the saved assessment snapshot and the
minimum patient fields required for presentation. The private raw import and
unrelated clinical documents should never be returned by assessment-definition or
public report endpoints.
