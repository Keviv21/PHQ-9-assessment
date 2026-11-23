import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importContent } from '../src/content-db.js';

const args = process.argv.slice(2);
const sqliteOnly = args.includes('--sqlite');
const ifEmpty = args.includes('--if-empty');
const paths = args.filter((arg) => !arg.startsWith('--'));
if (paths.length > 2) throw new Error('Usage: import-content.mjs [--sqlite] [--if-empty] [assessment-json] [patients-json]');
const assessmentsPath = paths[0] || fileURLToPath(new URL('../data/all-assessments.json', import.meta.url));
const patientsPath = paths[1] || fileURLToPath(new URL('../data/demo-patients.json', import.meta.url));
const bundle = JSON.parse(readFileSync(assessmentsPath, 'utf8'));
const patients = JSON.parse(readFileSync(patientsPath, 'utf8'));
const result = await importContent(bundle, patients, { sqliteOnly, ifEmpty });
console.log(result.skipped
  ? `Content already imported: ${result.assessments} active assessments.`
  : `Imported ${result.assessments} assessment versions and ${result.patients} sample patients into ${sqliteOnly || !process.env.DATABASE_URL ? 'SQLite' : 'PostgreSQL'}.`);
