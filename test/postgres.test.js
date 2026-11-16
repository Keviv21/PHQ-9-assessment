import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { openPostgres } from "../src/postgres/database.js";
import { openPostgresWorkspace } from "../src/postgres/workspace-store.js";
import { openPostgresLegacy } from "../src/postgres/legacy-store.js";
import { openWorkspaceStore } from "../src/workspace/store.js";
import { openStore } from "../src/store.js";
import { definition } from "../src/workspace/catalogue.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import { migrateSqlite } from "../scripts/migrate-sqlite-to-postgres.mjs";
import { createTranslationsService } from "../src/workspace/translations.js";
import { openApplicationStorage } from "../src/storage.js";

test(
  "PostgreSQL migration, shared sessions, concurrency, cache and HTTP reports",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const schema = "chandrika_test_" + randomUUID().replaceAll("-", "");
    const db = await openPostgres(process.env.TEST_DATABASE_URL, { schema });
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
