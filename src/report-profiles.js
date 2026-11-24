import { readFileSync } from 'node:fs';
const phq9 = JSON.parse(readFileSync(new URL('../data/report-profiles/phq9.json', import.meta.url), 'utf8'));
export const phq9Id = phq9.assessmentId;
export function reportProfileFor(id) { return id === phq9Id ? structuredClone(phq9) : null; }
