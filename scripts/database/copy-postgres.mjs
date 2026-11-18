import pg from "pg";
import { isDeepStrictEqual } from "node:util";
import { openPostgres, schemaName, TABLE_NAMES } from "../../src/storage/postgres/database.js";

// The caller must stop app writers before cutover. No source records are changed.
export async function copyPostgresDatabase(sourceUrl, sourceSchema, targetUrl, targetSchema) {
  sourceSchema = schemaName(sourceSchema);
  targetSchema = schemaName(targetSchema);
  const from = new URL(sourceUrl), to = new URL(targetUrl);
  if (from.hostname === to.hostname && from.pathname === to.pathname && sourceSchema === targetSchema)
    throw new Error("Source and target must be separate.");
  if (from.hostname.endsWith(".neon.tech")) from.searchParams.set("sslmode", "verify-full");
  const target = await openPostgres(targetUrl, { schema: targetSchema, includeAuxiliary: true });
  const source = new pg.Client({ connectionString: from.href, connectionTimeoutMillis: 15000 });
  try {
    await source.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const counts = await target.transaction(async (client) => {
      await client.query(`LOCK TABLE ${Object.keys(TABLE_NAMES).map(target.table).join(",")} IN EXCLUSIVE MODE`);
      const counts = {};
      for (const [oldName, newName] of Object.entries(TABLE_NAMES)) {
        const oldTable = `"${sourceSchema}"."${oldName}"`, newTable = `"${sourceSchema}"."${newName}"`;
        const { rows: [existing] } = await source.query(
          "SELECT to_regclass($1) AS old_table, to_regclass($2) AS new_table", [oldTable, newTable],
        );
        if (Boolean(existing.old_table) === Boolean(existing.new_table))
          throw new Error(`Source must have exactly one table for ${newName}.`);
        const { rows } = await source.query(`SELECT * FROM ${existing.old_table ? oldTable : newTable}`);
        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error("Unexpected source column.");
          await client.query(
            `INSERT INTO ${target.table(oldName)} (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
            columns.map((c) => row[c]),
          );
        }
        const copied = (await client.query(`SELECT * FROM ${target.table(oldName)}`)).rows;
        const key = (row) => JSON.stringify(oldName === "workspace_translations" ? [row.hash, row.language] : row.id ?? row.patient_id ?? row.source_hash);
        const byKey = new Map(copied.map((row) => [key(row), row]));
        if (copied.length !== rows.length || rows.some((row) => !isDeepStrictEqual(byKey.get(key(row)), row)))
          throw new Error(`Copy verification failed for ${newName}; target changes rolled back.`);
        counts[newName] = rows.length;
      }
      return counts;
    });
    await source.query("COMMIT");
    return counts;
  } finally {
    await source.query("ROLLBACK").catch(() => {});
    await source.end();
    await target.close();
  }
}
