const schema = 'pod_assessment_prototype';
const profiles = `${schema}.patient_profiles`;
const imports = `${schema}.patient_imports`;
const documents = `${schema}.patient_documents`;

function ageGroup(age) {
  if (!Number.isFinite(Number(age))) return 'unknown';
  if (Number(age) < 19) return 'under19';
  if (Number(age) >= 65) return '65plus';
  return '19to64';
}

function patientSummary(row, rows) {
  const clinical = rows.find((item) => item.document_type === 'clinical_notes_summary')?.content ?? {};
  const conclusion = clinical.executive_summary?.clinical_conclusion;
  const sleepIssues = clinical.clinical_inference?.sleep_analysis?.persistent_issues;
  const observations = Array.isArray(sleepIssues) ? sleepIssues
    .filter((issue) => typeof issue === 'string' && issue.trim())
    .map((issue, index) => ({
      code: 'sleepDisruption', featureCode: 'sleep_disruption', status: 'current',
      description: issue.trim(), evidenceText: issue.trim(),
      source: `clinical_notes_summary.clinical_inference.sleep_analysis.persistent_issues[${index}]`,
    })) : [];
  return {
    id: row.id,
    label: row.demographics?.name || row.external_patient_id,
    demographics: {
      name: row.demographics?.name || row.external_patient_id,
      age: row.demographics?.age ?? null,
      gender: row.demographics?.gender ?? null,
    },
    summary: {
      ageGroup: ageGroup(row.demographics?.age),
      overview: typeof conclusion === 'string' && conclusion.trim()
        ? conclusion.trim() : 'A validated Neurotwin patient record is available in PostgreSQL.',
      observations,
      traumaExposure: 'notReported',
      safetyStatus: 'notReviewed',
    },
    source: { system: row.source_system, externalPatientId: row.external_patient_id,
      validationStatus: row.validation_status, warningCount: row.validation_errors?.length ?? 0 },
  };
}

export function openPatientStore(pool) {
  async function patientRow(id = null) {
    const values = id ? [id] : [];
    const where = id ? 'AND p.id = $1::uuid' : '';
    const result = await pool.query(`SELECT p.id::text, p.source_system, p.external_patient_id,
      p.demographics, i.validation_status, i.validation_errors
      FROM ${profiles} p
      JOIN LATERAL (SELECT validation_status, validation_errors FROM ${imports}
        WHERE patient_id = p.id ORDER BY imported_at DESC, id DESC LIMIT 1) i ON true
      WHERE i.validation_status IN ('validated', 'validated_with_warnings') ${where}
      ORDER BY COALESCE(p.demographics->>'name', p.external_patient_id), p.id`, values);
    return id ? result.rows[0] ?? null : result.rows;
  }

  return {
    async list() {
      return (await patientRow()).map((row) => ({ id: row.id,
        label: row.demographics?.name || row.external_patient_id }));
    },
    async get(id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
      const row = await patientRow(id);
      if (!row) return null;
      const result = await pool.query(`SELECT document_type, source_section_key, content
        FROM ${documents} WHERE patient_id = $1::uuid AND included_in_patient_record
        ORDER BY created_at DESC, source_section_key`, [id]);
      return patientSummary(row, result.rows);
    },
  };
}
