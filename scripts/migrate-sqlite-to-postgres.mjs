import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { openPostgres } from "../src/postgres/database.js";

export async function migrateSqlite(database, source, backupPath) {
  source = resolve(source);
  backupPath = resolve(backupPath);
  if (source === backupPath) throw new Error("Backup must be a separate file.");
  mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
  const original = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(original, backupPath);
    chmodSync(backupPath, 0o600);
  } finally {
    original.close();
  }
  const hash = createHash("sha256")
    .update(readFileSync(backupPath))
    .digest("hex");
  const sqlite = new DatabaseSync(backupPath, { readOnly: true });
  const has = (name) =>
    Boolean(
      sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    );
  const all = (name) =>
    has(name) ? sqlite.prepare(`SELECT * FROM "${name}"`).all() : [];
  const { table, transaction } = database;
  try {
    return await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${database.schema}:sqlite-import`,
      ]);
      const prior = await client.query(
        `SELECT counts FROM ${table("sqlite_imports")} WHERE source_hash=$1`,
        [hash],
      );
      if (prior.rows[0])
        return {
          alreadyImported: true,
          counts: prior.rows[0].counts,
          backupPath,
        };
      const counts = {};
      async function insert(name, row, keys = ["id"]) {
        const columns = Object.keys(row),
          values = columns.map((k) =>
            k === "data" ? JSON.stringify(row[k]) : row[k],
          );
        const where = keys.map((k, i) => `"${k}"=$${i + 1}`).join(" AND ");
        const existing = await client.query(
          `SELECT * FROM ${table(name)} WHERE ${where} FOR UPDATE`,
          keys.map((k) => row[k]),
        );
        if (existing.rows[0]) {
          if (!isDeepStrictEqual(existing.rows[0], row))
            throw new Error(
              `Import conflict in ${name}; existing records were not overwritten.`,
            );
        } else
          await client.query(
            `INSERT INTO ${table(name)}(${columns.map((k) => `"${k}"`).join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
            values,
          );
        counts[name] = (counts[name] || 0) + 1;
      }
      for (const name of [
        "workspace_patients",
        "workspace_prescriptions",
        "workspace_sessions",
        "workspace_recommendations",
        "workspace_translations",
      ]) {
        for (const row of all(name)) {
          if ("data" in row) row.data = JSON.parse(row.data);
          await insert(
            name,
            row,
            name === "workspace_recommendations"
              ? ["patient_id"]
              : name === "workspace_translations"
                ? ["hash", "language"]
                : ["id"],
          );
        }
      }
      for (const row of all("assessments")) {
        const answers = all("answers")
          .filter((a) => a.assessment_id === row.id)
          .sort((a, b) => a.question_number - b.question_number);
        const revisions = all("answer_revisions").filter(
          (a) => a.assessment_id === row.id,
        );
        const status =
          row.status === "completed"
            ? "completed"
            : row.review_ready
              ? "review"
              : "in_progress";
        await insert("legacy_sessions", {
          id: row.id,
          data: {
            id: row.id,
            formId: row.form_id,
            formVersion: row.form_version,
            language: row.language,
            mode: row.mode,
            collectionMethod: row.collection_method,
            demoPatientId: row.demo_patient_id,
            status,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            currentNumber: status === "in_progress" ? answers.length + 1 : null,
            answers: answers.map((a) => ({
              number: a.question_number,
              value: a.value,
              method: a.method,
              responseSummary: a.response_summary,
              answeredAt: a.answered_at,
            })),
            reviewChangeCount: revisions.length,
            answerRevisions: revisions.map((a) => ({
              number: a.question_number,
              previousValue: a.previous_value,
              finalValue: a.final_value,
              changedAt: a.changed_at,
            })),
            scores: row.scores_json ? JSON.parse(row.scores_json) : null,
          },
        });
      }
      for (const p of all("prescriptions"))
        await insert("legacy_prescriptions", {
          id: p.id,
          data: {
            id: p.id,
            demoPatientId: p.demo_patient_id,
            formId: p.form_id,
            createdAt: p.created_at,
            assessmentId: p.assessment_id,
          },
        });
      for (const s of all("draft_sessions")) {
        const answers = JSON.parse(s.answers_json);
        await insert("draft_sessions", {
          id: s.id,
          data: {
            id: s.id,
            formId: s.draft_id,
            formVersion: "imported-draft-v1",
            language: "en",
            mode: s.mode,
            collectionMethod:
              s.mode === "live"
                ? "conversational_inference"
                : "explicit_choice",
            status: s.status,
            startedAt: s.started_at,
            completedAt: s.completed_at,
            currentNumber:
              s.status === "in_progress" ? answers.length + 1 : null,
            answers,
            reviewChangeCount: s.review_change_count,
            scores: null,
            unscored: true,
          },
        });
      }
      await client.query(
        `INSERT INTO ${table("sqlite_imports")}(source_hash,counts) VALUES($1,$2)`,
        [hash, JSON.stringify(counts)],
      );
      return { alreadyImported: false, counts, backupPath };
    });
  } finally {
    sqlite.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let database;
  try {
    database = await openPostgres(process.env.DATABASE_URL);
    const source = process.argv[2] || "data/prototype.sqlite";
    const backupPath =
      process.argv[3] || `local-data/backups/prototype-${Date.now()}.sqlite`;
    console.log(
      JSON.stringify(
        await migrateSqlite(database, source, backupPath),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      `Migration failed (${error.code || "validation"}). No existing PostgreSQL records were overwritten.`,
    );
    process.exitCode = 1;
  } finally {
    await database?.close();
  }
}
