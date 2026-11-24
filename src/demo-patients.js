import { readFileSync } from 'node:fs';
import { patientObservationCodes, suggestForPatient } from './patient-routing.js';

// Synthetic, de-identified summaries. No clinical text from the supplied Digital Twin report is copied here.
const patients = JSON.parse(readFileSync(new URL('../data/demo-patients.json', import.meta.url), 'utf8'));
if (new Set(patients.map((patient) => patient.id)).size !== patients.length ||
    patients.some((patient) => !/^demo-[a-z]$/.test(patient.id) || !patient.label || !patient.summary?.overview ||
      !['under19', '19to64', '65plus', 'unknown'].includes(patient.summary.ageGroup) ||
      !['notReported', 'uncertain', 'confirmed'].includes(patient.summary.traumaExposure) ||
      !['notReviewed', 'noneReported', 'concern'].includes(patient.summary.safetyStatus) ||
      !Array.isArray(patient.summary.observations) || patient.summary.observations.some((item) =>
        !patientObservationCodes.has(item.code) || !['current', 'historical'].includes(item.status) ||
        !item.description || !item.source))) {
  throw new Error('Demo patient summaries are invalid.');
}

export function listDemoPatients() {
  return patients.map(({ id, label }) => ({ id, label }));
}

export function getDemoPatient(id) {
  const patient = patients.find((entry) => entry.id === id);
  return patient ? structuredClone(patient) : null;
}

export function suggestForDemoPatient(id, focus = '') {
  return suggestForPatient(getDemoPatient(id), focus);
}
