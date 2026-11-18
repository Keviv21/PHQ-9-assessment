import { createHash, randomUUID } from 'node:crypto';
import { patientImportRecord } from './patient-import.js';
import { createPatientRecord } from './state.js';
import { HttpError } from './errors.js';

export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value, depth = 0) {
  if (depth > 60) throw new HttpError(400, 'The report is nested too deeply.');
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]));
  return value;
}
export function reportHash(document) {
  return createHash('sha256').update(JSON.stringify(canonical(document))).digest('hex');
}
export function parsePatientDocument(input) {
  if (!object(input) || (input.patientId != null && (typeof input.patientId !== 'string' || !input.patientId || input.patientId.length > 200)))
    throw new HttpError(400, 'Choose a valid patient for the import.');
  const document = input?.document;
  if (!object(document) || Buffer.byteLength(JSON.stringify(document)) > MAX_REPORT_BYTES)
    throw new HttpError(400, 'Choose a JSON object up to 2 MB.');
  const contentHash = reportHash(document);
  const report = document.digital_twin_report;
  const profile = report?.sections?.clinical__notes_summary?.patient_profile;
  if (!object(report) || !object(report.sections) || !object(profile) ||
      typeof report.patient_id !== 'string' || !report.patient_id.trim() || report.patient_id.length > 200 ||
      typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 150)
    throw new HttpError(400, 'The report needs digital_twin_report.patient_id and a clinical__notes_summary.patient_profile with a name.');
  if (profile.age != null && (!Number.isInteger(profile.age) || profile.age < 0 || profile.age > 130))
    throw new HttpError(400, 'Patient age must be an integer from 0 to 130.');
  if (Object.values(report.sections).some(value => !object(value)))
    throw new HttpError(400, 'Each report section must be a JSON object.');
  let parsed;
  try { parsed = patientImportRecord(document); }
  catch { throw new HttpError(400, 'The patient report could not be read.'); }
  if (!parsed.historySummary.trim()) throw new HttpError(400, 'The report must include clinical history or a summary.');
  return {
    parsed: { ...parsed, externalId: parsed.externalId.trim(), sourceSystem: 'NeuroTwin' },
    document: structuredClone(document), contentHash,
    fileName: typeof input.fileName === 'string' ? input.fileName.split(/[\\/]/).pop().slice(0, 200) : null,
  };
}
export function matchesIdentity(patient, parsed) {
  return patient.externalId === parsed.externalId && (patient.sourceSystem || patient.source) === 'NeuroTwin';
}
export function importPreview(prepared, patients) {
  const { sourceProfile, ...profile } = prepared.parsed;
  return {
    profile,
    sections: Object.keys(prepared.document.digital_twin_report.sections),
    matchingPatients: patients.filter(p => matchesIdentity(p, profile)).map(({ id, name, recordVersion }) => ({ id, name, recordVersion })),
    summaryIsExcerpt: true,
  };
}
export function assertVersion(patient, version) {
  if (!Number.isInteger(version) || version !== patient.recordVersion)
    throw new HttpError(409, 'This patient record changed. Reload the patient or preview the import again.');
}
export function importedPatient(prepared, existing, input) {
  if (existing) {
    assertVersion(existing, input.expectedVersion);
    if (existing.externalId && !matchesIdentity(existing, prepared.parsed))
      throw new HttpError(409, 'The report patient ID does not match the selected patient. Choose the matching patient or create a new one.');
  }
  return {
    ...(existing || { id: randomUUID(), createdAt: new Date().toISOString() }),
    ...prepared.parsed,
    label: prepared.parsed.name,
    source: 'NeuroTwin',
    recordVersion: (existing?.recordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}
export function manualPatient(input) {
  if (!object(input)) throw new HttpError(400, 'Enter patient details.');
  return { ...createPatientRecord(input), recordVersion: 1 };
}
export function withNote(patient, input) {
  if (!object(input)) throw new HttpError(400, 'Enter a clinical history note.');
  assertVersion(patient, input.expectedVersion);
  if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 24000)
    throw new HttpError(400, 'Enter a clinical history note of up to 24,000 characters.');
  const note = input.summary.trim();
  const combined = `${patient.historySummary}\n\n${note}`;
  return {
    ...patient, recordVersion: patient.recordVersion + 1,
    historySummary: combined.slice(-24000), updatedAt: new Date().toISOString(),
  };
}
export function historyRecord(patient, type, { document = null, summary = patient.historySummary, fileName = null, contentHash = null } = {}) {
  const profile = Object.fromEntries(['name','recordedAge','gender','email','externalId','sourceSystem','source'].filter(key => patient[key] !== undefined).map(key => [key, patient[key]]));
  return {
    id: randomUUID(), patient_id: patient.id, version: patient.recordVersion,
    created_at: new Date().toISOString(), content_hash: contentHash,
    data: { type, summary, profile, document, fileName, recordedBy: 'Local app (no authenticated user)', actorAuthenticated: false },
  };
}
export function baselineRecord(patient) {
  const document = patient.sourceProfile ? { digital_twin_report: patient.sourceProfile } : null;
  return historyRecord(patient, 'baseline', { document });
}
export function publicRecord(row, full = false) {
  const { document, ...data } = row.data;
  return { id: row.id, patientId: row.patient_id, version: row.version, createdAt: row.created_at,
    ...data, hasDocument: !!document, ...(full ? { document } : {}) };
}
