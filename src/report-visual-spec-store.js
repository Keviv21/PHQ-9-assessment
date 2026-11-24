import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function openReportVisualSpecStore({ pool, path, schema = 'pod_assessment_prototype' } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid report visual spec schema name.');
  // PostgreSQL is the application backend. Load SQLite only for an explicitly
  // requested isolated test store, avoiding SQLite initialization in DB imports.
  const db = pool ? null : new (require('node:sqlite').DatabaseSync)(path);
  if (db) db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL');
  const table = name => pool ? `${schema}.${name}` : name;
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  const query = async (sql, params = [], client = pool) => {
    if (pool) return (await client.query(sql, params)).rows;
    const statement = db.prepare(sql.replace(/\$\d+/g, '?').replace(/::jsonb/g, ''));
    return /^\s*(SELECT|INSERT.*RETURNING)/is.test(sql) ? statement.all(...params) : (statement.run(...params), []);
  };

  return {
    async initialize() {
      if (pool) {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('report_visual_spec_versions')} (
          id TEXT PRIMARY KEY,
          assessment_id TEXT NOT NULL REFERENCES ${table('assessment_library')}(id),
          assessment_version_id TEXT NOT NULL REFERENCES ${table('assessment_versions')}(id),
          schema_version TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL,
          clinical_approved BOOLEAN NOT NULL DEFAULT FALSE,
          source_spec JSONB NOT NULL, runtime_spec JSONB NOT NULL, validation JSONB NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(assessment_id,content_hash))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('assessment_report_visual_specs')} (
          assessment_id TEXT PRIMARY KEY REFERENCES ${table('assessment_library')}(id),
          active_visual_spec_version_id TEXT NOT NULL REFERENCES ${table('report_visual_spec_versions')}(id),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('report_visual_spec_imports')} (
          import_hash TEXT PRIMARY KEY, manifest JSONB NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        return;
      }
      db.exec(`CREATE TABLE IF NOT EXISTS report_visual_spec_versions (
        id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, assessment_version_id TEXT NOT NULL,
        schema_version TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL,
        clinical_approved INTEGER NOT NULL, source_spec TEXT NOT NULL, runtime_spec TEXT NOT NULL,
        validation TEXT NOT NULL, imported_at TEXT NOT NULL, UNIQUE(assessment_id,content_hash));
        CREATE TABLE IF NOT EXISTS assessment_report_visual_specs (
          assessment_id TEXT PRIMARY KEY, active_visual_spec_version_id TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS report_visual_spec_imports (
          import_hash TEXT PRIMARY KEY, manifest TEXT NOT NULL, imported_at TEXT NOT NULL);`);
    },

    async importSpecs({ importHash, manifest, records }) {
      const client = pool ? await pool.connect() : null;
      let added = 0;
      try {
        if (pool) { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(728186495)'); }
        else db.exec('BEGIN IMMEDIATE');
        for (const record of records) {
          const existing = await query(`SELECT id FROM ${table('report_visual_spec_versions')} WHERE id=$1`, [record.id], client);
          if (!existing.length) {
            await query(`INSERT INTO ${table('report_visual_spec_versions')}
              (id,assessment_id,assessment_version_id,schema_version,content_hash,status,
               clinical_approved,source_spec,runtime_spec,validation,imported_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
            [record.id, record.assessmentId, record.assessmentVersionId, record.schemaVersion,
              record.contentHash, record.status, pool ? record.clinicalApproved : Number(record.clinicalApproved),
              JSON.stringify(record.sourceSpec), JSON.stringify(record.runtimeSpec),
              JSON.stringify(record.validation), new Date().toISOString()], client);
            added++;
          }
          await query(`INSERT INTO ${table('assessment_report_visual_specs')}
            (assessment_id,active_visual_spec_version_id,updated_at) VALUES ($1,$2,$3)
            ON CONFLICT(assessment_id) DO UPDATE SET
              active_visual_spec_version_id=excluded.active_visual_spec_version_id,
              updated_at=excluded.updated_at`,
          [record.assessmentId, record.id, new Date().toISOString()], client);
        }
        await query(`INSERT INTO ${table('report_visual_spec_imports')} (import_hash,manifest,imported_at)
          VALUES ($1,$2::jsonb,$3) ON CONFLICT(import_hash) DO NOTHING`,
        [importHash, JSON.stringify(manifest), new Date().toISOString()], client);
        if (pool) await client.query('COMMIT'); else db.exec('COMMIT');
        return { added, unchanged: records.length - added, active: records.length };
      } catch (error) {
        if (pool) await client.query('ROLLBACK'); else db.exec('ROLLBACK');
        throw error;
      } finally { client?.release(); }
    },

    async activeSpecs() {
      const rows = await query(`SELECT a.assessment_id, v.id AS visual_spec_version_id,
          v.assessment_version_id, v.runtime_spec, v.validation
        FROM ${table('assessment_report_visual_specs')} a
        JOIN ${table('report_visual_spec_versions')} v ON v.id=a.active_visual_spec_version_id
        ORDER BY a.assessment_id`);
      return rows.map(row => ({ assessmentId: row.assessment_id,
        visualSpecVersionId: row.visual_spec_version_id,
        assessmentVersionId: row.assessment_version_id,
        runtimeSpec: decode(row.runtime_spec), validation: decode(row.validation) }));
    },

    async readiness() {
      const rows = await query(`SELECT v.assessment_id, v.id AS visual_spec_version_id,
          v.status, v.clinical_approved, v.validation, v.runtime_spec
        FROM ${table('assessment_report_visual_specs')} a
        JOIN ${table('report_visual_spec_versions')} v ON v.id=a.active_visual_spec_version_id
        ORDER BY v.assessment_id`);
      const assessments = rows.map(row => ({ assessmentId: row.assessment_id,
        visualSpecVersionId: row.visual_spec_version_id, status: row.status,
        clinicalApproved: row.clinical_approved === true,
        validation: decode(row.validation),
        activeVariantIds: decode(row.runtime_spec).variants.map(variant => variant.id) }));
      return { summary: { assessments: assessments.length,
        rendererValidated: assessments.filter(row => row.validation.rendererEquivalent).length,
        clinicallyApproved: assessments.filter(row => row.clinicalApproved).length }, assessments };
    },

    async stats() {
      const names = ['report_visual_spec_versions', 'assessment_report_visual_specs', 'report_visual_spec_imports'];
      return Object.fromEntries(await Promise.all(names.map(async name => [name,
        Number((await query(`SELECT count(*) AS n FROM ${table(name)}`))[0].n)])));
    },
    async close() { db?.close(); },
  };
}
