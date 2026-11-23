import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const schema = 'pod_assessment_content';
const defaultSqlitePath = fileURLToPath(new URL('../data/content.sqlite', import.meta.url));
const missingContent = 'Assessment content database is empty. Run npm run db:import-content before starting the app.';

function sqlitePath(options) {
  return resolve(options.path || process.env.CONTENT_DB_PATH || defaultSqlitePath);
}

function postgresPool() {
  const connectionString = process.env.DATABASE_URL;
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with sslmode=verify-full.');
  }
  return new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 1000, allowExitOnIdle: true });
}

function validateSource(bundle, patients) {
  const entries = bundle?.assessments;
  if (!Array.isArray(entries) || entries.length !== 186 ||
      new Set(entries.map((entry) => entry.assessment_id)).size !== 186 ||
      entries.some((entry) => !entry.assessment_id || !entry.definition_version) ||
      !bundle.appMetadata?.categories || !Array.isArray(bundle.appMetadata?.recommendationCatalog) ||
      !Array.isArray(bundle.appMetadata?.legacyDraftRecords) || !Array.isArray(patients) ||
      !patients.length || new Set(patients.map((patient) => patient.id)).size !== patients.length) {
    throw new Error('Assessment or patient import data is incomplete.');
  }
}

function hash(entry) {
  return createHash('sha256').update(JSON.stringify(entry)).digest('hex');
}

function metadata(bundle) {
  return { bundle_version: bundle.bundle_version, appMetadata: bundle.appMetadata };
}

function validateLoaded(meta, assessments, patients) {
  if (!meta || assessments.length !== 186 || patients.length === 0) throw new Error(missingContent);
  return { ...meta, assessments, patients };
}

export async function loadContent(options = {}) {
  if (process.env.DATABASE_URL && !options.sqliteOnly) {
    const pool = postgresPool();
    try {
      const [meta, assessments, patients] = await Promise.all([
        pool.query(`SELECT value FROM ${schema}.content_metadata WHERE key = 'catalogue'`),
        pool.query(`SELECT payload FROM ${schema}.assessment_versions WHERE active = TRUE ORDER BY assessment_id`),
        pool.query(`SELECT profile FROM ${schema}.content_patients ORDER BY id`),
      ]);
      return validateLoaded(meta.rows[0]?.value, assessments.rows.map((row) => row.payload),
        patients.rows.map((row) => row.profile));
    } catch (error) {
      if (error.code === '42P01' || error.code === '3F000') throw new Error(missingContent, { cause: error });
      throw error;
    } finally { await pool.end(); }
  }

  const path = sqlitePath(options);
  if (!existsSync(path)) throw new Error(missingContent);
  const db = new DatabaseSync(path);
  try {
    const meta = db.prepare("SELECT value_json FROM content_metadata WHERE key = 'catalogue'").get();
    const assessments = db.prepare('SELECT payload_json FROM assessment_versions WHERE active = 1 ORDER BY assessment_id').all();
    const patients = db.prepare('SELECT profile_json FROM content_patients ORDER BY id').all();
    return validateLoaded(meta && JSON.parse(meta.value_json), assessments.map((row) => JSON.parse(row.payload_json)),
      patients.map((row) => JSON.parse(row.profile_json)));
  } catch (error) {
    if (/no such table/.test(error.message)) throw new Error(missingContent, { cause: error });
    throw error;
  } finally { db.close(); }
}

export async function importContent(bundle, patients, options = {}) {
  validateSource(bundle, patients);
  if (process.env.DATABASE_URL && !options.sqliteOnly) {
    const pool = postgresPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(764920011)');
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.assessment_versions (
        assessment_id TEXT NOT NULL, definition_version TEXT NOT NULL,
        source_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (assessment_id, definition_version))`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS active_assessment_version
        ON ${schema}.assessment_versions (assessment_id) WHERE active`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.content_metadata (
        key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.content_patients (
        id TEXT PRIMARY KEY, profile JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      const count = await client.query(`SELECT COUNT(*)::integer AS total FROM ${schema}.assessment_versions WHERE active`);
      if (options.ifEmpty && count.rows[0].total === 186) { await client.query('COMMIT'); return { skipped: true, assessments: 186 }; }
      for (const entry of bundle.assessments) {
        const previous = await client.query(`SELECT source_hash FROM ${schema}.assessment_versions
          WHERE assessment_id = $1 AND definition_version = $2`, [entry.assessment_id, entry.definition_version]);
        if (previous.rows[0] && previous.rows[0].source_hash !== hash(entry)) {
          throw new Error(`Assessment ${entry.assessment_id} changed without a new definition_version.`);
        }
      }
      await client.query(`UPDATE ${schema}.assessment_versions SET active = FALSE WHERE active`);
      for (const entry of bundle.assessments) {
        await client.query(`INSERT INTO ${schema}.assessment_versions
          (assessment_id, definition_version, source_hash, active, payload)
          VALUES ($1,$2,$3,TRUE,$4::jsonb)
          ON CONFLICT (assessment_id, definition_version) DO UPDATE SET active = TRUE`,
        [entry.assessment_id, entry.definition_version, hash(entry), JSON.stringify(entry)]);
      }
      await client.query(`INSERT INTO ${schema}.content_metadata (key,value) VALUES ('catalogue',$1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(metadata(bundle))]);
      for (const patient of patients) {
        await client.query(`INSERT INTO ${schema}.content_patients (id,profile) VALUES ($1,$2::jsonb)
          ON CONFLICT (id) DO NOTHING`, [patient.id, JSON.stringify(patient)]);
      }
      await client.query('COMMIT');
      return { skipped: false, assessments: bundle.assessments.length, patients: patients.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); await pool.end(); }
  }

  const path = sqlitePath(options);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS assessment_versions (
      assessment_id TEXT NOT NULL, definition_version TEXT NOT NULL,
      source_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (assessment_id, definition_version))`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS active_assessment_version ON assessment_versions (assessment_id) WHERE active = 1');
    db.exec('CREATE TABLE IF NOT EXISTS content_metadata (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS content_patients (id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const count = db.prepare('SELECT COUNT(*) AS total FROM assessment_versions WHERE active = 1').get().total;
    if (options.ifEmpty && count === 186) return { skipped: true, assessments: 186 };
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare('SELECT source_hash FROM assessment_versions WHERE assessment_id = ? AND definition_version = ?');
      for (const entry of bundle.assessments) {
        const row = prior.get(entry.assessment_id, entry.definition_version);
        if (row && row.source_hash !== hash(entry)) {
          throw new Error(`Assessment ${entry.assessment_id} changed without a new definition_version.`);
        }
      }
      db.exec('UPDATE assessment_versions SET active = 0 WHERE active = 1');
      const insert = db.prepare(`INSERT INTO assessment_versions
        (assessment_id, definition_version, source_hash, active, payload_json) VALUES (?,?,?,?,?)
        ON CONFLICT (assessment_id, definition_version) DO UPDATE SET active = 1`);
      for (const entry of bundle.assessments) {
        insert.run(entry.assessment_id, entry.definition_version, hash(entry), 1, JSON.stringify(entry));
      }
      db.prepare(`INSERT INTO content_metadata (key,value_json) VALUES ('catalogue',?)
        ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify(metadata(bundle)));
      const insertPatient = db.prepare('INSERT OR IGNORE INTO content_patients (id,profile_json) VALUES (?,?)');
      for (const patient of patients) insertPatient.run(patient.id, JSON.stringify(patient));
      db.exec('COMMIT');
      return { skipped: false, assessments: bundle.assessments.length, patients: patients.length };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
