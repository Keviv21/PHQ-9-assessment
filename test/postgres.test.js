import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { openPostgres } from "../src/storage/postgres/database.js";
import { openPostgresWorkspace } from "../src/storage/postgres/workspace-store.js";
import { openPostgresLegacy } from "../src/storage/postgres/legacy-store.js";
import { openWorkspaceStore } from "../src/storage/sqlite/workspace-store.js";
import { openStore } from "../src/storage/sqlite/standard-store.js";
import { definition } from "../src/workspace/catalogue.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import { migrateSqlite } from "../scripts/database/migrate-sqlite.mjs";
import { createTranslationsService } from "../src/workspace/translations.js";
import { openApplicationStorage } from "../src/storage/index.js";
import { copyPostgresDatabase } from "../scripts/database/copy-postgres.mjs";
import { TABLE_NAMES } from "../src/storage/postgres/database.js";

test("Named tables preserve existing schemas and database copies reject conflicts", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  const sourceSchema = "copy_source_" + randomUUID().replaceAll("-", "");
  const targetSchema = "copy_target_" + randomUUID().replaceAll("-", "");
  let source = await openPostgres(url, { schema: sourceSchema, includeAuxiliary: true });
  let target;
  try {
    const store = await openPostgresWorkspace(source, { seed: false });
    const patient = await store.createPatient({ name: "Synthetic copy patient", historySummary: "Synthetic only" });
    const rx = await store.prescribe(patient.id, "GAD7");
    const session = await store.createSession(rx.id, definition("GAD7"), "en", "screen");
    // Simulate the previous release's schema, including its linked records.
    for (const [oldName, newName] of Object.entries(TABLE_NAMES))
      await source.pool.query(`ALTER TABLE "${sourceSchema}"."${newName}" RENAME TO "${oldName}"`);
    const counts = await copyPostgresDatabase(url, sourceSchema, url, targetSchema);
    assert.equal(counts.patients, 1);
    assert.equal(counts.assessment_sessions, 1);
    target = await openPostgres(url, { schema: targetSchema, includeAuxiliary: true });
    const copied = await openPostgresWorkspace(target, { seed: false });
    assert.deepEqual(await copied.get(session.id), session);
    assert.deepEqual(await copyPostgresDatabase(url, sourceSchema, url, targetSchema), counts);
    const reopened = await openPostgres(url, { schema: sourceSchema, includeAuxiliary: true });
    await source.close(); source = reopened;
    assert.deepEqual(await (await openPostgresWorkspace(source, { seed: false })).get(session.id), session);
    const oldTables = await source.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename LIKE 'workspace_%'", [sourceSchema]);
    assert.equal(oldTables.rows.length, 0);
    // A late conflict must roll back earlier inserts as well.
    await source.pool.query(`INSERT INTO ${source.table("workspace_patients")} VALUES ('new-copy-patient', $1)`, [JSON.stringify({ id: "new-copy-patient" })]);
    await target.pool.query(`UPDATE ${target.table("workspace_sessions")} SET data = data || '{"revision":99}'::jsonb`);
    await assert.rejects(() => copyPostgresDatabase(url, sourceSchema, url, targetSchema), /Copy verification failed/);
    assert.equal((await copied.listPatients()).length, 1);
    assert.equal((await copied.get(session.id)).revision, 99);
  } finally {
    await source.pool.query(`DROP SCHEMA IF EXISTS "${sourceSchema}" CASCADE`);
    await source.pool.query(`DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`);
    await target?.close(); await source.close();
  }
});

test(
  "PostgreSQL migration, shared sessions, concurrency, cache and HTTP reports",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const schema = "chandrika_test_" + randomUUID().replaceAll("-", "");
    const db = await openPostgres(process.env.TEST_DATABASE_URL, { schema, includeAuxiliary: true });
    const dir = mkdtempSync(join(tmpdir(), "assessment-pg-test-"));
    let server, api;
    try {
      const source = join(dir, "source.sqlite");
      const sqlite = openWorkspaceStore(source, { seed: false });
      const p = sqlite.createPatient({
        name: "Synthetic migration patient",
        historySummary: "Synthetic only",
      });
      const rx = sqlite.prescribe(p.id, "GAD7");
      let s = sqlite.createSession(rx.id, definition("GAD7"), "en", "screen");
      s = sqlite.answer(s.id, {
        questionId: s.definition.questions[0].id,
        value: 0,
        revision: 0,
      });
      const original = s;
      sqlite.close();
      const legacySqlite = openStore(source);
      const legacyRx = legacySqlite.prescribe("demo-a", "phq9");
      legacySqlite.close();
      const imported = await migrateSqlite(
        db,
        source,
        join(dir, "backup.sqlite"),
      );
      assert.equal(imported.counts.workspace_patients, 1);
      assert.equal(imported.counts.workspace_sessions, 1);
      const store = await openPostgresWorkspace(db, { seed: false });
      assert.deepEqual(await store.get(s.id), original);
      assert.equal(
        (await migrateSqlite(db, source, join(dir, "backup2.sqlite")))
          .alreadyImported,
        true,
      );
      const other = await openPostgresWorkspace(db, { seed: false });
      const q = s.definition.questions[1];
      const saves = await Promise.allSettled([
        store.answer(s.id, {
          questionId: q.id,
          value: 1,
          revision: s.revision,
        }),
        other.answer(s.id, {
          questionId: q.id,
          value: 2,
          revision: s.revision,
        }),
      ]);
      assert.equal(saves.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        saves.find((r) => r.status === "rejected").reason.status,
        409,
      );
      s = await other.get(s.id);
      for (const q of s.definition.questions.slice(2))
        s = await store.answer(s.id, {
          questionId: q.id,
          value: q.options[0].value,
          revision: s.revision,
        });
      s = await store.finalize(s.id, s.revision);
      assert.equal(s.status, "completed");
      await assert.rejects(
        () =>
          other.answer(s.id, {
            questionId: s.definition.questions[0].id,
            value: 1,
            revision: s.revision,
          }),
        { status: 409 },
      );
      assert.equal((await other.analytics(p.id)).completed, 1);
      // Re-importing the same source cannot overwrite newer PostgreSQL answers.
      await migrateSqlite(db, source, join(dir, "backup3.sqlite"));
      assert.equal((await other.get(s.id)).status, "completed");
      const newRx = await store.prescribe(p.id, "GAD7");
      const starts = await Promise.all([
        store.createSession(newRx.id, definition("GAD7"), "en", "screen"),
        other.createSession(newRx.id, definition("GAD7"), "en", "screen"),
      ]);
      assert.equal(starts[0].id, starts[1].id);
      await store.saveRecommendation(p.id, "hash", { suggestions: [] });
      assert.deepEqual(await other.recommendation(p.id, "hash"), {
        suggestions: [],
      });
      const translations = createTranslationsService(store, { apiKey: "" });
      assert.equal(
        (await translations.localize(definition("GAD7"), "en")).id,
        "GAD7",
      );
      await store.saveTranslation("hash", "es", { language: "es" });
      assert.deepEqual(await other.translation("hash", "es"), {
        language: "es",
      });
      const css = definition("client-satisfaction-survey-css--5a9e654edbc6");
      const cr = await store.prescribe(p.id, css.id);
      let cs = await store.createSession(cr.id, css, "en", "screen");
      for (const [i, q] of css.questions.entries())
        cs = await store.answer(cs.id, {
          questionId: q.id,
          value:
            i === 6
              ? { skipped: true, reason: "not_applicable" }
              : i >= 8
                ? "Synthetic written feedback"
                : q.options[0].value,
          revision: cs.revision,
        });
      cs = await store.finalize(cs.id, cs.revision);
      assert.equal(cs.answers[8], "Synthetic written feedback");
      assert.equal(cs.score, null);
      const legacy = openPostgresLegacy(db),
        legacyStart = await legacy.startPrescription(legacyRx.id, "demo", "en");
      let ls = legacyStart;
      for (let n = 1; n <= 9; n++)
        ls = await legacy.record(ls.id, n, 0, "demo");
      ls = await legacy.finalize(ls.id, Array(9).fill(0));
      assert.equal(ls.scores.rawTotal, 0);
      assert.equal((await legacy.patientResults("demo-a")).length, 1);
      api = createWorkspaceApi(null, { store, apiKey: "" });
      server = http.createServer((req, res) => {
        api.handle(req, res);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/workspace`;
      const patients = await (await fetch(base + "/patients")).json();
      assert.equal(patients[0].name, p.name);
      const report = await (
        await fetch(base + `/sessions/${cs.id}/report`)
      ).text();
      assert.ok(report.includes("Synthetic written feedback"));
      const completed = await (
        await fetch(base + `/patients/${p.id}/analytics`)
      ).json();
      assert.equal(completed.completed, 2);
      const pending = await store.prescribe(p.id, "GAD7");
      const prescriptions = await (await fetch(base + `/patients/${p.id}/prescriptions`)).json();
      assert.equal(prescriptions.filter(r => r.status === "completed").length, 2);
      assert.equal(prescriptions.find(r => r.id === pending.id).status, "assigned");
      assert.ok(prescriptions.every(r => !("answers" in r)));
      const overview = await (await fetch(base + "/analytics/overview")).json();
      assert.equal(overview.totals.completed, 2);
      assert.equal(overview.totals.notStarted, 1);
      // Failed migrations roll back earlier inserts and never overwrite conflicts.
      const conflict = join(dir, "conflict.sqlite"),
        conflictStore = openWorkspaceStore(conflict, { seed: false });
      conflictStore.createPatient({
        name: "Would be rolled back",
        historySummary: "Synthetic only",
      });
      conflictStore.close();
      const { DatabaseSync } = await import("node:sqlite");
      const c = new DatabaseSync(conflict);
      c.prepare("INSERT INTO workspace_patients VALUES(?,?)").run(
        p.id,
        JSON.stringify({ ...p, name: "Conflict" }),
      );
      c.close();
      await assert.rejects(
        () => migrateSqlite(db, conflict, join(dir, "conflict-backup.sqlite")),
        /Import conflict/,
      );
      assert.equal((await store.listPatients()).length, 1);
      assert.equal((await store.patient(p.id)).name, p.name);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      api?.close();
      await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("Missing database configuration fails instead of silently opening SQLite", async () => {
  await assert.rejects(() => openApplicationStorage({}), /Set DATABASE_URL/);
});
