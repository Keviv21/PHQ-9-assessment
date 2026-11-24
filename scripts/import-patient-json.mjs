import { createHash, randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const file = resolve(process.argv[2] || 'local-data/neurotwin-patient.json');
const bytes = await readFile(file);
const payload = JSON.parse(bytes);
const report = payload.digital_twin_report;
if (!report || typeof report !== 'object' || !report.sections || typeof report.sections !== 'object') {
  throw new Error('Expected digital_twin_report with a sections object.');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourcePatientId = typeof report.patient_id === 'string' ? report.patient_id.trim() : null;
const profile = report.sections.clinical__notes_summary?.patient_profile ?? {};
const profilePatientId = typeof profile.patient_id === 'string' ? profile.patient_id.trim() : null;
const criticalErrors = [];
const warnings = [];
if (!sourcePatientId) criticalErrors.push({ severity: 'error', code: 'missing_primary_patient_id',
  path: 'digital_twin_report.patient_id' });
if (sourcePatientId && profilePatientId && profilePatientId !== sourcePatientId) {
  criticalErrors.push({ severity: 'error', code: 'profile_patient_id_mismatch',
    path: 'digital_twin_report.sections.clinical__notes_summary.patient_profile.patient_id' });
}

const sectionTypes = {
  MRI_clinical_summary: 'mri_clinical_summary',
  ECG_Clinical_Summary: 'ecg_clinical_summary',
  CT_scan_clinical_summary: 'ct_clinical_summary',
  EEG_clinical_summary: 'eeg_clinical_summary',
  clinical__notes_summary: 'clinical_notes_summary',
  Pharmacogenomic_clinical_summary: 'pharmacogenomic_clinical_summary',
};
const sectionPatientId = (key, section) => key === 'CT_scan_clinical_summary' ? section.patientId
  : key === 'EEG_clinical_summary' ? section.report_metadata?.patient_id
    : key === 'clinical__notes_summary' ? section.patient_profile?.patient_id
      : section.patient_id ?? null;
const periods = (key, section) => {
  if (key === 'ECG_Clinical_Summary') return [section.reporting_period?.start_date, section.reporting_period?.end_date];
  if (key === 'CT_scan_clinical_summary') return [section.reportMetadata?.periodCovered?.startDate, section.reportMetadata?.periodCovered?.endDate];
  if (key === 'clinical__notes_summary') return [section.observation_window?.start_date, section.observation_window?.end_date];
  return [null, null];
};

const sections = Object.entries(report.sections).map(([key, content]) => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    criticalErrors.push({ severity: 'error', code: 'invalid_section', path: `digital_twin_report.sections.${key}` });
    return null;
  }
  const patientId = sectionPatientId(key, content);
  const identityStatus = !patientId ? 'inherited' : patientId === sourcePatientId ? 'matched' : 'mismatch';
  if (identityStatus === 'mismatch') warnings.push({ severity: 'warning', code: 'section_patient_id_mismatch',
    path: `digital_twin_report.sections.${key}`, sourcePatientId: patientId,
    action: 'stored_but_excluded_from_patient_record' });
  const [periodStart, periodEnd] = periods(key, content);
  return { key, content, patientId, identityStatus, periodStart: periodStart ?? null, periodEnd: periodEnd ?? null };
}).filter(Boolean);

const validationStatus = criticalErrors.length ? 'rejected' : warnings.length ? 'validated_with_warnings' : 'validated';
const validationErrors = [...criticalErrors, ...warnings];
const payloadHash = sha256(bytes);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  let patientId = null;
  if (validationStatus !== 'rejected') {
    const existing = await client.query(`SELECT id FROM pod_assessment_prototype.patient_profiles
      WHERE source_system = $1 AND external_patient_id = $2 FOR UPDATE`, ['neurotwin', sourcePatientId]);
    patientId = existing.rows[0]?.id ?? randomUUID();
    const demographics = { name: profile.name ?? null, age: profile.age ?? null,
      gender: profile.gender ?? null, diagnosis: profile.diagnosis ?? null };
    await client.query(`INSERT INTO pod_assessment_prototype.patient_profiles
      (id, source_system, external_patient_id, demographics) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (source_system, external_patient_id) DO UPDATE
      SET demographics = EXCLUDED.demographics, updated_at = now()`,
    [patientId, 'neurotwin', sourcePatientId, JSON.stringify(demographics)]);
  }

  const previous = await client.query(`SELECT id FROM pod_assessment_prototype.patient_imports
    WHERE payload_sha256 = $1 FOR UPDATE`, [payloadHash]);
  const importId = previous.rows[0]?.id ?? randomUUID();
  if (previous.rowCount) {
    await client.query(`UPDATE pod_assessment_prototype.patient_imports SET
      patient_id = $2, source_system = $3, source_filename = $4, source_version = $5,
      source_patient_id = $6, raw_payload = $7::jsonb, validation_status = $8,
      validation_errors = $9::jsonb, imported_at = now() WHERE id = $1`,
    [importId, patientId, 'neurotwin', basename(file), report.version ?? null, sourcePatientId,
      JSON.stringify(payload), validationStatus, JSON.stringify(validationErrors)]);
  } else {
    await client.query(`INSERT INTO pod_assessment_prototype.patient_imports
      (id, patient_id, source_system, source_filename, source_version, source_patient_id,
       payload_sha256, raw_payload, validation_status, validation_errors)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)`,
    [importId, patientId, 'neurotwin', basename(file), report.version ?? null, sourcePatientId,
      payloadHash, JSON.stringify(payload), validationStatus, JSON.stringify(validationErrors)]);
  }

  let includedDocuments = 0;
  if (patientId) {
    for (const section of sections) {
      const included = section.identityStatus !== 'mismatch';
      await client.query(`INSERT INTO pod_assessment_prototype.patient_documents
        (id, patient_id, import_id, document_type, source_section_key, source_patient_id,
         period_start, period_end, content_sha256, content, identity_status, included_in_patient_record)
        VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10::jsonb, $11, $12)
        ON CONFLICT (import_id, source_section_key) DO UPDATE SET
          patient_id = EXCLUDED.patient_id, document_type = EXCLUDED.document_type,
          source_patient_id = EXCLUDED.source_patient_id, period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end, content_sha256 = EXCLUDED.content_sha256,
          content = EXCLUDED.content, identity_status = EXCLUDED.identity_status,
          included_in_patient_record = EXCLUDED.included_in_patient_record`,
      [randomUUID(), patientId, importId, sectionTypes[section.key] ?? 'other', section.key,
        section.patientId, section.periodStart, section.periodEnd, sha256(JSON.stringify(section.content)),
        JSON.stringify(section.content), section.identityStatus, included]);
      if (included) includedDocuments += 1;
    }
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ status: previous.rowCount ? 'updated' : 'imported', importId, patientId,
    validationStatus, documentsStored: patientId ? sections.length : 0, includedDocuments,
    excludedDocuments: patientId ? sections.length - includedDocuments : 0,
    issueCodes: validationErrors.map(({ code }) => code) }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
