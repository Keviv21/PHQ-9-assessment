import { DatabaseSync } from 'node:sqlite';

export function openAssessmentLibrary({ pool, path, schema = 'pod_assessment_prototype' } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid library schema name.');
  const db = pool ? null : new DatabaseSync(path);
  if (db) db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL');
  const table = name => pool ? `${schema}.${name}` : name;
  const query = async (sql, params = [], client = pool) => {
    if (pool) return (await client.query(sql, params)).rows;
    const statement = db.prepare(sql.replace(/\$\d+/g, '?').replace(/::jsonb/g, ''));
    return /^\s*(SELECT|INSERT.*RETURNING)/is.test(sql) ? statement.all(...params) : (statement.run(...params), []);
  };
  const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
  return {
    async initialize() {
      if (pool) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      const json = pool ? 'JSONB' : 'TEXT';
      for (const sql of [
        `CREATE TABLE IF NOT EXISTS ${table('assessment_versions')} (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, definition_version TEXT NOT NULL, content_hash TEXT NOT NULL, bundle_hash TEXT NOT NULL, definition ${json} NOT NULL, runtime ${json} NOT NULL, imported_at TEXT NOT NULL, UNIQUE(assessment_id,content_hash))`,
        `CREATE TABLE IF NOT EXISTS ${table('assessment_library')} (id TEXT PRIMARY KEY, title TEXT NOT NULL, active_version_id TEXT NOT NULL REFERENCES ${table('assessment_versions')}(id))`,
        `CREATE TABLE IF NOT EXISTS ${table('assessment_assets')} (sha256 TEXT PRIMARY KEY, storage_key TEXT NOT NULL, mime_type TEXT, byte_size BIGINT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS ${table('assessment_version_assets')} (version_id TEXT NOT NULL REFERENCES ${table('assessment_versions')}(id), asset_id TEXT NOT NULL, sha256 TEXT REFERENCES ${table('assessment_assets')}(sha256), metadata ${json} NOT NULL, PRIMARY KEY(version_id,asset_id))`,
        `CREATE TABLE IF NOT EXISTS ${table('assessment_imports')} (bundle_hash TEXT PRIMARY KEY, manifest ${json} NOT NULL, imported_at TEXT NOT NULL)`,
      ]) {
        if (pool) await pool.query(sql); else db.exec(sql);
      }
    },
    async importBundle({ bundleHash, records, assets, manifest }) {
      const client = pool ? await pool.connect() : null;
      let added = 0;
      try {
        if (pool) { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(728186492)'); }
        else db.exec('BEGIN IMMEDIATE');
        for (const asset of assets) await query(`INSERT INTO ${table('assessment_assets')} (sha256,storage_key,mime_type,byte_size) VALUES ($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING`, [asset.sha256, asset.storageKey, asset.mimeType, asset.byteSize], client);
        for (const { raw, runtime, links } of records) {
          const id = runtime.versionId;
          const existing = await query(`SELECT id FROM ${table('assessment_versions')} WHERE id=$1`, [id], client);
          if (!existing.length) {
            await query(`INSERT INTO ${table('assessment_versions')} (id,assessment_id,definition_version,content_hash,bundle_hash,definition,runtime,imported_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
              [id, raw.assessment_id, raw.definition_version, id, bundleHash, JSON.stringify(raw), JSON.stringify(runtime), new Date().toISOString()], client);
            for (const link of links) await query(`INSERT INTO ${table('assessment_version_assets')} (version_id,asset_id,sha256,metadata) VALUES ($1,$2,$3,$4::jsonb)`, [id, link.id, link.sha256, JSON.stringify(link.metadata)], client);
            added++;
          }
          await query(`INSERT INTO ${table('assessment_library')} (id,title,active_version_id) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET title=excluded.title, active_version_id=excluded.active_version_id`, [raw.assessment_id, runtime.title, id], client);
        }
        await query(`INSERT INTO ${table('assessment_imports')} (bundle_hash,manifest,imported_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT(bundle_hash) DO NOTHING`, [bundleHash, JSON.stringify(manifest), new Date().toISOString()], client);
        if (pool) await client.query('COMMIT'); else db.exec('COMMIT');
        return { added, unchanged: records.length - added, assets: assets.length };
      } catch (error) {
        if (pool) await client.query('ROLLBACK'); else db.exec('ROLLBACK');
        throw error;
      } finally { client?.release(); }
    },
    async activeDefinitions() {
      const definitions = [];
      let afterId = '';
      while (true) {
        const rows = await query(`SELECT a.id,v.runtime FROM ${table('assessment_library')} a
          JOIN ${table('assessment_versions')} v ON v.id=a.active_version_id
          WHERE a.id>$1 ORDER BY a.id LIMIT 25`, [afterId]);
        definitions.push(...rows.map(row => decode(row.runtime)));
        if (rows.length < 25) return definitions;
        afterId = rows.at(-1).id;
      }
    },
    async getVersion(id) {
      const [row] = await query(`SELECT definition,runtime FROM ${table('assessment_versions')} WHERE id=$1`, [id]);
      return row ? { definition: decode(row.definition), runtime: decode(row.runtime) } : null;
    },
    async getAsset(hash) {
      return (await query(`SELECT * FROM ${table('assessment_assets')} WHERE sha256=$1`, [hash]))[0] ?? null;
    },
    async stats() {
      const counts = {};
      for (const name of ['assessment_library', 'assessment_versions', 'assessment_assets', 'assessment_version_assets', 'assessment_imports']) counts[name] = Number((await query(`SELECT count(*) AS n FROM ${table(name)}`))[0].n);
      return counts;
    },
    async close() { db?.close(); },
  };
}
