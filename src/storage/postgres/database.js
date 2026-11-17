import pg from "pg";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

export const DEFAULT_SCHEMA = "assessments";
// Logical keys also identify the original SQLite tables for import compatibility.
export const TABLE_NAMES = Object.freeze({
  workspace_patients: "patients",
  workspace_prescriptions: "assessment_prescriptions",
  workspace_sessions: "assessment_sessions",
  workspace_recommendations: "assessment_recommendations",
  workspace_translations: "assessment_translations",
  legacy_sessions: "standard_assessment_sessions",
  legacy_prescriptions: "standard_assessment_prescriptions",
  draft_sessions: "draft_assessment_sessions",
  sqlite_imports: "data_imports",
});
export function schemaName(value = DEFAULT_SCHEMA) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error("Invalid database schema name.");
  return value;
}
export async function openPostgres(
  url,
  { schema = process.env.DATABASE_SCHEMA || DEFAULT_SCHEMA } = {},
) {
  if (!url || !/^postgres(?:ql)?:\/\//.test(url))
    throw new Error("Set DATABASE_URL to the PostgreSQL connection URL.");
  const target = new URL(url);
  // The configured Neon URL must retain certificate and hostname verification.
  if (target.hostname.endsWith(".neon.tech"))
    target.searchParams.set("sslmode", "verify-full");
  schema = schemaName(schema);
  setDefaultAutoSelectFamilyAttemptTimeout(3000);
  const pool = new pg.Pool({
    connectionString: target.href,
    max: 8,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    application_name: "pod-assessment-platform",
  });
  pool.on("error", () =>
    console.error(
      "An idle PostgreSQL connection was lost. Requests will reconnect.",
    ),
  );
  const table = (name) => {
    if (!Object.hasOwn(TABLE_NAMES, name)) throw new Error("Unknown application table.");
    return `"${schema}"."${TABLE_NAMES[name]}"`;
  };
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  try {
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${schema}:schema`,
      ]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      // Upgrade an existing app schema without duplicating or losing its records.
      for (const [oldName, newName] of Object.entries(TABLE_NAMES)) {
        const { rows: [existing] } = await client.query(
          "SELECT to_regclass($1) AS old_table, to_regclass($2) AS new_table",
          [`"${schema}"."${oldName}"`, table(oldName)],
        );
        if (existing.old_table && existing.new_table)
          throw new Error(`Both old and new tables exist for ${newName}; migration requires review.`);
        if (existing.old_table)
          await client.query(`ALTER TABLE "${schema}"."${oldName}" RENAME TO "${newName}"`);
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table("workspace_patients")}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("workspace_prescriptions")}(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES ${table("workspace_patients")}(id),assessment_id TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("workspace_sessions")}(id TEXT PRIMARY KEY,prescription_id TEXT NOT NULL UNIQUE REFERENCES ${table("workspace_prescriptions")}(id),data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("workspace_recommendations")}(patient_id TEXT PRIMARY KEY REFERENCES ${table("workspace_patients")}(id),context_hash TEXT NOT NULL,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("workspace_translations")}(hash TEXT NOT NULL,language TEXT NOT NULL,data JSONB NOT NULL,PRIMARY KEY(hash,language));
        CREATE TABLE IF NOT EXISTS ${table("legacy_sessions")}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("legacy_prescriptions")}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("draft_sessions")}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table("sqlite_imports")}(source_hash TEXT PRIMARY KEY,imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),counts JSONB NOT NULL);
        CREATE INDEX IF NOT EXISTS assessment_prescriptions_patient ON ${table("workspace_prescriptions")}(patient_id);
      `);
    });
    return {
      pool,
      table,
      transaction,
      schema,
      description: `${target.hostname}/${decodeURIComponent(target.pathname.slice(1))} (schema: ${schema})`,
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
