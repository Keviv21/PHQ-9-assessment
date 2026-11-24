import { DatabaseSync } from 'node:sqlite';

export function openReportProfileStore({ pool, path, schema = 'pod_assessment_prototype' } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid report profile schema name.');
  const db = pool ? null : new DatabaseSync(path);
  if (db) db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL');
  const table = (name) => pool ? `${schema}.${name}` : name;
  const decode = (value) => typeof value === 'string' ? JSON.parse(value) : value;
  const query = async (sql, params = [], client = pool) => {
    if (pool) return (await client.query(sql, params)).rows;
    const statement = db.prepare(sql.replace(/\$\d+/g, '?').replace(/::jsonb/g, ''));
    return /^\s*(SELECT|INSERT.*RETURNING)/is.test(sql) ? statement.all(...params) : (statement.run(...params), []);
  };

  return {
    async initialize() {
      if (pool) {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('report_profile_versions')} (
          id TEXT PRIMARY KEY,
          assessment_id TEXT NOT NULL REFERENCES ${table('assessment_library')}(id),
          assessment_version_id TEXT NOT NULL REFERENCES ${table('assessment_versions')}(id),
          profile_version TEXT NOT NULL, scoring_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
          renderer_version TEXT NOT NULL, status TEXT NOT NULL,
          clinical_approved BOOLEAN NOT NULL DEFAULT FALSE,
          source_profile JSONB NOT NULL, runtime_profile JSONB NOT NULL, validation JSONB NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(assessment_id,content_hash))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('assessment_report_profiles')} (
          assessment_id TEXT PRIMARY KEY REFERENCES ${table('assessment_library')}(id),
          active_profile_version_id TEXT NOT NULL REFERENCES ${table('report_profile_versions')}(id),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ${table('report_profile_imports')} (
          import_hash TEXT PRIMARY KEY, manifest JSONB NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        return;
      }
      db.exec(`CREATE TABLE IF NOT EXISTS report_profile_versions (
        id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, assessment_version_id TEXT NOT NULL,
        profile_version TEXT NOT NULL, scoring_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
        renderer_version TEXT NOT NULL, status TEXT NOT NULL, clinical_approved INTEGER NOT NULL,
        source_profile TEXT NOT NULL, runtime_profile TEXT NOT NULL, validation TEXT NOT NULL,
        imported_at TEXT NOT NULL, UNIQUE(assessment_id,content_hash));
        CREATE TABLE IF NOT EXISTS assessment_report_profiles (
          assessment_id TEXT PRIMARY KEY, active_profile_version_id TEXT NOT NULL,
          updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS report_profile_imports (
          import_hash TEXT PRIMARY KEY, manifest TEXT NOT NULL, imported_at TEXT NOT NULL);`);
    },

    async importProfiles({ importHash, manifest, records }) {
      const client = pool ? await pool.connect() : null;
      let added = 0;
      try {
        if (pool) {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(728186493)');
        } else db.exec('BEGIN IMMEDIATE');
        for (const record of records) {
          const existing = await query(`SELECT id FROM ${table('report_profile_versions')} WHERE id=$1`, [record.id], client);
          if (!existing.length) {
            await query(`INSERT INTO ${table('report_profile_versions')}
              (id,assessment_id,assessment_version_id,profile_version,scoring_hash,content_hash,
               renderer_version,status,clinical_approved,source_profile,runtime_profile,validation,imported_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)`,
            [record.id, record.assessmentId, record.assessmentVersionId, record.profileVersion,
              record.scoringHash, record.contentHash, record.rendererVersion, record.status,
              pool ? record.clinicalApproved : Number(record.clinicalApproved), JSON.stringify(record.sourceProfile),
              JSON.stringify(record.runtimeProfile), JSON.stringify(record.validation),
              new Date().toISOString()], client);
            added++;
          }
          await query(`INSERT INTO ${table('assessment_report_profiles')}
            (assessment_id,active_profile_version_id,updated_at) VALUES ($1,$2,$3)
            ON CONFLICT(assessment_id) DO UPDATE SET
              active_profile_version_id=excluded.active_profile_version_id,
              updated_at=excluded.updated_at`,
          [record.assessmentId, record.id, new Date().toISOString()], client);
        }
        await query(`INSERT INTO ${table('report_profile_imports')} (import_hash,manifest,imported_at)
          VALUES ($1,$2::jsonb,$3) ON CONFLICT(import_hash) DO NOTHING`,
        [importHash, JSON.stringify(manifest), new Date().toISOString()], client);
        if (pool) await client.query('COMMIT'); else db.exec('COMMIT');
        return { added, unchanged: records.length - added, active: records.length };
      } catch (error) {
        if (pool) await client.query('ROLLBACK'); else db.exec('ROLLBACK');
        throw error;
      } finally { client?.release(); }
    },

    async activeProfiles() {
      const rows = await query(`SELECT p.assessment_id, v.id AS profile_version_id,
          v.assessment_version_id, v.runtime_profile, v.validation
        FROM ${table('assessment_report_profiles')} p
        JOIN ${table('report_profile_versions')} v ON v.id=p.active_profile_version_id
        ORDER BY p.assessment_id`);
      return rows.map((row) => ({ assessmentId: row.assessment_id,
        profileVersionId: row.profile_version_id, assessmentVersionId: row.assessment_version_id,
        runtimeProfile: decode(row.runtime_profile), validation: decode(row.validation) }));
    },

    async readiness() {
      const rows = await query(pool ? `SELECT a.id AS assessment_id, a.title,
          v.id AS profile_version_id, v.status, v.clinical_approved, v.validation,
          v.runtime_profile
        FROM ${table('assessment_report_profiles')} p
        JOIN ${table('assessment_library')} a ON a.id=p.assessment_id
        JOIN ${table('report_profile_versions')} v ON v.id=p.active_profile_version_id
        ORDER BY a.title` : `SELECT p.assessment_id, p.assessment_id AS title,
          v.id AS profile_version_id, v.status, v.clinical_approved, v.validation,
          v.runtime_profile
        FROM assessment_report_profiles p
        JOIN report_profile_versions v ON v.id=p.active_profile_version_id
        ORDER BY p.assessment_id`);
      const assessments = rows.map((row) => {
        const validation = decode(row.validation);
        const profile = decode(row.runtime_profile);
        const exceptions = [];
        if (validation.sampleAvailability === 'image_only') exceptions.push('sample_report_image_only');
        if (validation.sampleAvailability === 'no_available_sample') exceptions.push('sample_report_unavailable');
        if (validation.differences > 0) exceptions.push('source_score_difference');
        if (validation.recoveredAnswers < validation.questions) exceptions.push('sample_answers_incomplete');
        if (validation.missingGraphs > 0) exceptions.push('source_graph_configuration_incomplete');
        if (!validation.fullEquivalence) exceptions.push('full_report_equivalence_not_verified');
        if (!row.clinical_approved) exceptions.push('clinical_approval_pending');
        return { assessmentId: row.assessment_id, title: row.title,
          profileVersionId: row.profile_version_id, status: row.status,
          sampleAvailability: validation.sampleAvailability,
          sourceComparison: validation.sourceComparison,
          questions: validation.questions, recoveredAnswers: validation.recoveredAnswers,
          metrics: validation.metrics, matchedMetrics: validation.matchedMetrics,
          differences: validation.differences, availableGraphs: validation.availableGraphs,
          missingGraphs: validation.missingGraphs,
          sourcePageCount: profile.layout?.sourcePageCount ?? 0,
          fullEquivalence: validation.fullEquivalence === true,
          clinicalApproved: row.clinical_approved === true,
          draftReportAvailable: validation.questions > 0,
          exceptions };
      });
      return { summary: {
        assessments: assessments.length,
        draftReportAvailable: assessments.filter((row) => row.draftReportAvailable).length,
        readableSamples: assessments.filter((row) => row.sampleAvailability === 'readable_pdf').length,
        imageOnlySamples: assessments.filter((row) => row.sampleAvailability === 'image_only').length,
        noSamples: assessments.filter((row) => row.sampleAvailability === 'no_available_sample').length,
        withMatchedMetrics: assessments.filter((row) => row.matchedMetrics > 0).length,
        withDifferences: assessments.filter((row) => row.differences > 0).length,
        fullEquivalenceVerified: assessments.filter((row) => row.fullEquivalence).length,
        clinicallyApproved: assessments.filter((row) => row.clinicalApproved).length,
      }, assessments };
    },

    async stats() {
      const names = ['report_profile_versions', 'assessment_report_profiles', 'report_profile_imports'];
      return Object.fromEntries(await Promise.all(names.map(async (name) => [name,
        Number((await query(`SELECT count(*) AS n FROM ${table(name)}`))[0].n)])));
    },
    async close() { db?.close(); },
  };
}
