import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { contentHash, hashBytes, scoringRuntimeHash } from '../src/assessment-content.js';

const args = process.argv.slice(2);
const value = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const sourceDirectory = resolve(value('--source') || new URL('../local-data/assessment-reports-all/', import.meta.url).pathname);
const libraryPath = join(sourceDirectory, 'assessment-library.json');
const readinessPath = join(sourceDirectory, 'readiness.json');
const libraryBytes = await readFile(libraryPath);
const readinessBytes = await readFile(readinessPath);
const library = JSON.parse(libraryBytes);
const readiness = JSON.parse(readinessBytes);

if (library.schemaVersion !== 1 || !Array.isArray(library.records) || library.records.length !== 186) {
  throw new Error('Expected a compiled 186-assessment report library.');
}
if (readiness.manifest?.assessments !== 186 || !Array.isArray(readiness.assessments)) {
  throw new Error('Report readiness data is missing or incomplete.');
}
const readinessById = new Map(readiness.assessments.map((row) => [row.assessmentId, row]));
if (readinessById.size !== 186) throw new Error('Report readiness assessment IDs are incomplete.');
const importHash = hashBytes(Buffer.concat([libraryBytes, readinessBytes,
  Buffer.from('report-profile-import-v2-runtime-separated')]));

function runtimeProfile(sourceProfile, profileVersionId, validation) {
  const { sampleAnswers, sampleContext, sourceReport, ...safe } = structuredClone(sourceProfile);
  return {
    ...safe,
    profileVersionId,
    layout: {
      schemaVersion: 1,
      page: { size: 'A4', orientation: 'portrait', marginsMm: { top: 18, right: 16, bottom: 18, left: 16 } },
      sectionOrder: ['results', 'charts', 'score_summary', 'responses', 'coverage_and_limitations'],
      sourcePageCount: Math.max(0, ...(sourceReport?.reportSections || []).map((page) => page.page || 0)),
      sourceSections: sourceReport?.reportSections || [],
      pixelEquivalenceStatus: validation.fullEquivalence ? 'verified' : 'not_verified',
    },
    theme: {
      schemaVersion: 1,
      name: 'openmind-clinical-report',
      colours: { text: '#24364b', background: '#ffffff', accent: '#397aa0', grid: '#d9e3ec' },
      chartRendering: 'deterministic_svg',
    },
    sourceReport: {
      sampleAvailability: sourceReport?.sampleAvailability || 'no_available_sample',
      graphs: sourceReport?.graphs || [],
      reviewStatus: sourceReport?.reviewStatus || 'local_draft_not_approved',
      requiredFeatures: sourceReport?.interpretation?.requiredFeatures || {},
    },
    validation: {
      sourceComparison: validation.sourceComparison,
      matchedMetrics: validation.matchedMetrics,
      differences: validation.differences,
      fullEquivalence: validation.fullEquivalence,
      clinicalApproved: validation.clinicalApproved,
    },
  };
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const parsed = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get('sslmode') !== 'verify-full') {
  throw new Error('PostgreSQL requires sslmode=verify-full.');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
let addedDefinitions = 0;
let addedProfiles = 0;
try {
  const destination = await client.query("SELECT current_database() AS database, to_regnamespace('pod_assessment_prototype') IS NOT NULL AS schema_exists");
  const expected = value('--expected-database') || process.env.ASSESSMENT_DATABASE_NAME;
  if (expected && destination.rows[0].database !== expected) throw new Error('Connected database does not match the requested destination.');
  if (!destination.rows[0].schema_exists) throw new Error('The assessment prototype schema is missing.');
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(728186494)');
  const currentRows = await client.query(`SELECT a.id AS assessment_id, v.definition,
      v.runtime, v.bundle_hash, v.definition_version
    FROM pod_assessment_prototype.assessment_library a
    JOIN pod_assessment_prototype.assessment_versions v ON v.id=a.active_version_id
    ORDER BY a.id FOR UPDATE OF a`);
  if (currentRows.rowCount !== 186) throw new Error('The database assessment catalogue is incomplete.');
  const currentById = new Map(currentRows.rows.map((row) => [row.assessment_id, row]));
  const definitionRecords = [];
  const profileRecords = [];
  for (const compiled of library.records) {
    const profile = compiled.reporting?.analysisProfile;
    const validation = readinessById.get(compiled.id);
    if (!profile || profile.assessmentId !== compiled.id || profile.scoringHash !== scoringRuntimeHash(compiled)) {
      throw new Error(`Compiled report profile is stale: ${compiled.id}`);
    }
    const current = currentById.get(compiled.id);
    if (!current) throw new Error(`Assessment is not present in the database: ${compiled.id}`);
    if (current.runtime.sourceSha256 !== compiled.sourceSha256) {
      throw new Error(`Compiled report uses a different source bundle: ${compiled.id}`);
    }
    const compiledRuntime = structuredClone(compiled);
    delete compiledRuntime.reporting.analysisProfile;
    const { versionId: compiledSourceVersionId, ...compiledRuntimeContent } = compiledRuntime;
    compiledRuntime.versionId = contentHash({ sourceVersion: compiledSourceVersionId,
      runtime: compiledRuntimeContent, reportProfileStorage: 'separate_versioned_table' });
    definitionRecords.push({ id: compiledRuntime.versionId, assessment_id: compiled.id,
      definition_version: current.definition_version, content_hash: compiledRuntime.versionId,
      bundle_hash: current.bundle_hash, definition: current.definition, runtime: compiledRuntime,
      title: compiled.title });
    const profileContentHash = contentHash({ assessmentVersionId: compiledRuntime.versionId, profile });
    const profileVersionId = `report_${profileContentHash}`;
    const safeProfile = runtimeProfile(profile, profileVersionId, validation);
    profileRecords.push({ id: profileVersionId, assessment_id: compiled.id,
      assessment_version_id: compiledRuntime.versionId, profile_version: profile.version,
      scoring_hash: profile.scoringHash, content_hash: profileContentHash,
      renderer_version: 'analysis-report-2', status: profile.status,
      clinical_approved: profile.clinicalApproved === true, source_profile: profile,
      runtime_profile: safeProfile, validation });
  }
  const chunkSize = 12;
  for (let offset = 0; offset < definitionRecords.length; offset += chunkSize) {
    const definitions = definitionRecords.slice(offset, offset + chunkSize);
    const inserted = await client.query(`INSERT INTO pod_assessment_prototype.assessment_versions
      (id,assessment_id,definition_version,content_hash,bundle_hash,definition,runtime,imported_at)
      SELECT id,assessment_id,definition_version,content_hash,bundle_hash,definition,runtime,NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,assessment_id text,definition_version text,
        content_hash text,bundle_hash text,definition jsonb,runtime jsonb,title text)
      ON CONFLICT(id) DO NOTHING RETURNING id`, [JSON.stringify(definitions)]);
    addedDefinitions += inserted.rowCount;
    await client.query(`UPDATE pod_assessment_prototype.assessment_library a
      SET title=x.title, active_version_id=x.id
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,assessment_id text,title text)
      WHERE a.id=x.assessment_id`, [JSON.stringify(definitions.map(({ id, assessment_id, title }) => ({ id, assessment_id, title })))]);
  }
  for (let offset = 0; offset < profileRecords.length; offset += chunkSize) {
    const profiles = profileRecords.slice(offset, offset + chunkSize);
    const inserted = await client.query(`INSERT INTO pod_assessment_prototype.report_profile_versions
      (id,assessment_id,assessment_version_id,profile_version,scoring_hash,content_hash,
       renderer_version,status,clinical_approved,source_profile,runtime_profile,validation,imported_at)
      SELECT id,assessment_id,assessment_version_id,profile_version,scoring_hash,content_hash,
        renderer_version,status,clinical_approved,source_profile,runtime_profile,validation,NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,assessment_id text,assessment_version_id text,
        profile_version text,scoring_hash text,content_hash text,renderer_version text,status text,
        clinical_approved boolean,source_profile jsonb,runtime_profile jsonb,validation jsonb)
      ON CONFLICT(id) DO NOTHING RETURNING id`, [JSON.stringify(profiles)]);
    addedProfiles += inserted.rowCount;
    await client.query(`INSERT INTO pod_assessment_prototype.assessment_report_profiles
      (assessment_id,active_profile_version_id,updated_at)
      SELECT assessment_id,id,NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,assessment_id text)
      ON CONFLICT(assessment_id) DO UPDATE SET
        active_profile_version_id=excluded.active_profile_version_id, updated_at=NOW()`,
    [JSON.stringify(profiles.map(({ id, assessment_id }) => ({ id, assessment_id })))]);
  }
  const manifest = { ...library.manifest, importHash, sourceDirectory,
    reportProfileSchemaVersion: 1, rendererVersion: 'analysis-report-2',
    importedDefinitions: library.records.length };
  await client.query(`INSERT INTO pod_assessment_prototype.report_profile_imports
    (import_hash,manifest,imported_at) VALUES ($1,$2::jsonb,NOW())
    ON CONFLICT(import_hash) DO NOTHING`, [importHash, JSON.stringify(manifest)]);
  await client.query('COMMIT');
  const counts = await pool.query(`SELECT
    (SELECT count(*)::int FROM pod_assessment_prototype.assessment_report_profiles) AS active_profiles,
    (SELECT count(*)::int FROM pod_assessment_prototype.report_profile_versions) AS profile_versions,
    (SELECT count(*)::int FROM pod_assessment_prototype.assessment_library) AS assessments`);
  if (counts.rows[0].active_profiles !== 186 || counts.rows[0].assessments !== 186) throw new Error('Report profile import read-back failed.');
  console.log(JSON.stringify({ database: destination.rows[0].database, importHash,
    addedDefinitions, addedProfiles, ...counts.rows[0], readiness: readiness.manifest }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
