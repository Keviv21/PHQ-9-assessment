// Disposable local PostgreSQL rehearsal. Never reads .env or accepts a database URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--project', '--review', '--out', '--pg-bin'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/test-assessment-review-postgres.mjs [--project <checkout>] [--review <prepared-directory>] [--out <new-results-directory>] [--pg-bin <PostgreSQL-bin-directory>]');
  options.set(args[i], args[i + 1]);
}
const project = await realpath(resolve(options.get('--project') || fileURLToPath(new URL('..', import.meta.url))));
const reviewDir = await realpath(resolve(options.get('--review') || join(project, 'local-data/assessment-review')));
const pgBin = resolve(options.get('--pg-bin') || '/usr/lib/postgresql/14/bin');
const output = options.has('--out') ? resolve(options.get('--out')) : await mkdtemp('/tmp/assessment-postgres-results-');
if (options.has('--out')) await mkdir(output, { mode: 0o700 });
const load = name => import(pathToFileURL(join(project, 'src', name)).href);
const { hashBytes, contentHash } = await load('assessment-content.js');
const { openAssessmentLibrary } = await load('assessment-library-store.js');
const { openDefinitionStore } = await load('definition-store.js');
const { useStoredDefinitions } = await load('definition-library.js');
const { scoreDefinition } = await load('definition-scoring.js');
const { sampleAnswers, validateReportDefinition } = await load('assessment-review.js');
const { buildDefinitionReport } = await load('definition-report.js');
const { reviewReportHtml } = await load('assessment-review-html.js');
const { buildPatientAnalytics } = await load('analytics.js');
const checks = [];
async function check(name, fn) {
  const start = Date.now(); const passed = (await fn()) !== false;
  checks.push({ name, status: passed ? 'passed' : 'failed', durationMs: Date.now() - start });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
}
function execute(binary, argv, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${binary} exited ${code}: ${output}`)); });
  });
}
const candidate = JSON.parse(await readFile(join(reviewDir, 'import-candidate.json'), 'utf8'));
const audits = JSON.parse(await readFile(join(reviewDir, 'readiness.json'), 'utf8'));
assert.equal(candidate.kind, 'review_only_not_authorized_for_import');
assert.equal(candidate.records.length, 186);
await check('Prepared artifact checksums and definition identities', async () => {
  for (const item of JSON.parse(await readFile(join(reviewDir, 'checksums.json'), 'utf8'))) {
    const file = await realpath(resolve(reviewDir, item.path)), rel = relative(reviewDir, file);
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel));
    assert.equal(hashBytes(await readFile(file)), item.sha256, item.path);
  }
  for (const { raw, runtime } of candidate.records) {
    assert.deepEqual(validateReportDefinition(runtime), []);
    const { versionId, sourceSha256, ...runtimeContent } = runtime;
    assert.equal(versionId, contentHash({ raw, displayAssets: [], runtimeContent }));
  }
});
const cluster = await mkdtemp('/tmp/assessment-pg-rehearsal-');
const data = join(cluster, 'data'), socket = join(cluster, 'socket');
await mkdir(socket, { mode: 0o700 });
const connection = { host: socket, port: 55439, user: 'review_runner', password: '', ssl: false, max: 4, connectionTimeoutMillis: 10000 };
let started = false, pool, admin, browser;
let definitions, savedSessions = [], generatedReports = 0, pdfs = 0, fixtureAssertions = 0, knownGaps = 0, finalStats;
let failure;
const submissionFailures = [];
const oldDraftSetting = process.env.ASSESSMENT_DRAFT_SCORES;
process.env.ASSESSMENT_DRAFT_SCORES = 'true';
try {
  console.log('Creating a new private PostgreSQL cluster; TCP listening disabled.');
  await execute(join(pgBin, 'initdb'), ['-D', data, '-U', 'review_runner', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  await execute(join(pgBin, 'pg_ctl'), ['-D', data, '-l', join(cluster, 'server.log'), '-o', `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -p 55439`, '-w', 'start']);
  started = true;
  admin = new pg.Pool({ ...connection, database: 'postgres' });
  await check('Connection is the newly created socket-only local cluster', async () => {
    assert.equal((await admin.query('SHOW data_directory')).rows[0].data_directory, data);
    assert.equal((await admin.query('SHOW listen_addresses')).rows[0].listen_addresses, '');
    assert.equal((await admin.query('SELECT inet_server_addr() AS addr')).rows[0].addr, null);
  });
  await admin.query('CREATE DATABASE assessment_review');
  await admin.end(); admin = null;
  pool = new pg.Pool({ ...connection, database: 'assessment_review' });
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'assessment_review');
  const library = openAssessmentLibrary({ pool });
  await library.initialize();
  await check('All 186 definitions and asset metadata import into PostgreSQL', async () => {
    const first = await library.importBundle(candidate);
    assert.equal(first.added, 186);
    definitions = await library.activeDefinitions();
    assert.equal(definitions.length, 186);
    for (const { raw, runtime } of candidate.records) {
      assert.equal(contentHash(definitions.find(d => d.id === runtime.id)), contentHash(runtime));
      assert.equal(contentHash((await library.getVersion(runtime.versionId)).definition), contentHash(raw));
    }
    const stats = await library.stats();
    assert.equal(stats.assessment_assets, candidate.assets.length);
    assert.equal(stats.assessment_version_assets, candidate.records.reduce((n, r) => n + r.links.length, 0));
    await writeFile(join(output, 'initial-table-counts.json'), JSON.stringify(stats, null, 2) + '\n');
  });
  await check('Repeat imports are idempotent, including concurrent retries', async () => {
    const before = await library.stats();
    const results = await Promise.all([library.importBundle(candidate), library.importBundle(candidate)]);
    assert.ok(results.every(r => r.added === 0 && r.unchanged === 186));
    assert.deepEqual(await library.stats(), before);
  });
  await check('137 source score assertions and three known gaps using DB-loaded JSON', async () => {
    const fixtures = JSON.parse(await readFile(join(project, 'test/fixtures/scoring-benchmarks.json'), 'utf8'));
    for (const fixture of fixtures.assessments) {
      const d = definitions.find(d => d.id === fixture.assessment_id);
      for (const example of fixture.cases) {
        const scores = scoreDefinition(d, example.answers, example.context || {}, { draftScores: true });
        for (const [id, expected] of Object.entries(example.expected_scores)) {
          const actual = scores.metrics.find(m => m.id === id).value;
          if (example.kind === 'known_source_gap') { assert.equal(actual, null); knownGaps++; }
          else { assert.equal(actual, expected, `${fixture.assessment_id}/${example.id}/${id}`); fixtureAssertions++; }
        }
      }
    }
    assert.equal(fixtureAssertions, 137); assert.equal(knownGaps, 3);
  });
  useStoredDefinitions(definitions);
  const store = openDefinitionStore({ pool });
  await store.initialize();
  await mkdir(join(output, 'reports'), { mode: 0o700 });
  await check('Save, reload and report two visits for every available questionnaire', async () => {
    for (const [i, d] of definitions.entries()) {
      if (!d.questions.length) {
        await assert.rejects(store.prescribe('demo-a', d.id), /unavailable/); continue;
      }
      const history = [];
      for (const variant of ['first', 'last']) {
        const { answers, context } = sampleAnswers(d, variant);
        const prescription = await store.prescribe('demo-a', d.id);
        const state = await store.start(prescription.id);
        assert.equal((await store.start(prescription.id)).id, state.id, 'starting again must resume');
        await store.save(state.id, answers, false, context);
        let completed;
        try { completed = await store.save(state.id, answers, true, context); }
        catch (error) {
          submissionFailures.push({ assessmentId: d.id, title: d.title, scenario: variant, stage: 'finish', error: error.message });
          console.log(`FAIL submission: ${d.title} (${variant}): ${error.message}`);
          assert.equal((await store.getSession(state.id)).status, 'in_progress');
          continue;
        }
        const persisted = await store.getSession(state.id);
        assert.equal(contentHash(persisted), contentHash(completed));
        assert.equal(contentHash(persisted.formSnapshot), contentHash(d));
        assert.deepEqual(persisted.scores, scoreDefinition(d, persisted.answers, context, { draftScores: true }));
        const report = buildDefinitionReport(persisted, history);
        assert.equal(report.visits.length, history.length + 1);
        assert.equal(report.responses.length, d.questions.length);
        for (const metric of report.metrics) assert.equal(metric.value, persisted.scores.metrics.find(m => m.id === metric.id).value);
        if (variant === 'last' || d.reporting.mode !== 'numeric_scores') {
          const audit = audits.assessments.find(a => a.assessmentId === d.id);
          const html = reviewReportHtml(d, report, audit, 'repeated');
          assert.ok(html.includes('SYNTHETIC DATA'));
          assert.ok(!/(?:cx|cy|points)="[^"]*(?:NaN|Infinity|undefined)/.test(html));
          await writeFile(join(output, 'reports', `${d.id}.html`), html, { mode: 0o600 });
          if (!history.length || d.reporting.mode === 'numeric_scores') generatedReports++;
        }
        assert.equal(contentHash(await store.getSession(state.id)), contentHash(persisted), 'rendering must not rewrite responses');
        savedSessions.push(persisted); history.push(persisted);
      }
      if ((i + 1) % 30 === 0) console.log(`Saved response/report checks: ${i + 1}/186`);
    }
    assert.equal(savedSessions.length + submissionFailures.length, 370);
    const patientSessions = await store.patientSessions('demo-a');
    assert.equal(patientSessions.filter(s => s.status === 'completed').length, savedSessions.length);
    assert.equal(patientSessions.filter(s => s.status === 'in_progress').length, submissionFailures.length);
    return submissionFailures.length === 0;
  });
  await check('Analytics use persisted sessions and retain assessment-specific scales', async () => {
    const rows = await store.patientAnalyticsRows('demo-a');
    const result = buildPatientAnalytics('demo-a', rows);
    assert.equal(result.totalCompleted, savedSessions.length);
    const phq = definitions.find(d => d.id.startsWith('patient-health-questionnaire-depression-phq-9--'));
    const series = result.series.find(s => s.formId === `definition:${phq.id}`);
    assert.equal(series.points.length, 2);
    await writeFile(join(output, 'analytics-summary.json'), JSON.stringify({ totalCompleted: result.totalCompleted, series: result.series.length, phq9Points: series.points.length }, null, 2));
  });
  await check('Completed responses and incomplete submissions are protected', async () => {
    const phq = definitions.find(d => d.id.startsWith('patient-health-questionnaire-depression-phq-9--'));
    const completed = savedSessions.find(s => s.formId === phq.id);
    await assert.rejects(store.save(completed.id, {}, true), /unavailable/);
    assert.equal(contentHash(await store.getSession(completed.id)), contentHash(completed));
    const p = await store.prescribe('demo-b', phq.id), s = await store.start(p.id);
    await assert.rejects(store.save(s.id, {}, true), /Answer/);
    assert.equal(contentHash(await store.getSession(s.id)), contentHash(s));
  });
  await check('Version changes preserve earlier definitions and patient snapshots', async () => {
    const original = candidate.records[0], changed = structuredClone(original);
    changed.runtime.reporting.reportPlan.version = '1.0.0-postgres-rehearsal.2';
    const { versionId, sourceSha256, ...runtimeContent } = changed.runtime;
    changed.runtime.versionId = contentHash({ raw: changed.raw, displayAssets: [], runtimeContent });
    assert.equal((await library.importBundle({ ...candidate, records: [changed], assets: [] })).added, 1);
    assert.equal(contentHash((await library.getVersion(original.runtime.versionId)).runtime), contentHash(original.runtime));
    assert.equal((await library.activeDefinitions()).find(d => d.id === original.runtime.id).versionId, changed.runtime.versionId);
    const historical = savedSessions.find(s => s.formId === original.runtime.id);
    assert.equal(contentHash(await store.getSession(historical.id)), contentHash(historical));
    const before = await library.stats();
    const bad = structuredClone(changed);
    bad.runtime.versionId = 'rollback-test-version';
    bad.links = [{ id: 'missing-asset', sha256: 'missing-test-hash', metadata: {} }];
    // First row would change the pointer back. The failed second row must roll it back too.
    await assert.rejects(library.importBundle({ ...candidate, records: [original, bad], assets: [] }));
    assert.deepEqual(await library.stats(), before);
    assert.equal((await library.activeDefinitions()).find(d => d.id === original.runtime.id).versionId, changed.runtime.versionId);
    await library.importBundle({ ...candidate, records: [original], assets: [] });
    assert.equal((await library.activeDefinitions()).find(d => d.id === original.runtime.id).versionId, original.runtime.versionId);
  });
  await check('Reports render from PostgreSQL-read saved results; representative PDFs generate', async () => {
    browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome' });
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const targets = ['patient-health-questionnaire-depression-phq-9--', 'adult-adhd-self-report-scale-asrs--', 'life-events-checklist-5'];
    for (const prefix of targets) {
      const d = definitions.find(d => d.id.startsWith(prefix));
      assert.ok(d, prefix);
      await page.setContent(await readFile(join(output, 'reports', `${d.id}.html`), 'utf8'));
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      await writeFile(join(output, 'reports', `${d.id}.pdf`), pdf, { mode: 0o600 }); pdfs++;
    }
    await browser.close(); browser = null;
  });
  finalStats = await library.stats();
  await store.close(); await library.close();
} catch (error) { failure = error; console.error(error.stack); }
finally {
  await browser?.close();
  await pool?.end(); await admin?.end();
  if (started) {
    try { await execute(join(pgBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; }
    catch (error) { failure ||= error; }
  }
  if (oldDraftSetting === undefined) delete process.env.ASSESSMENT_DRAFT_SCORES;
  else process.env.ASSESSMENT_DRAFT_SCORES = oldDraftSetting;
}
const result = { status: failure || submissionFailures.length ? 'failed' : 'passed', database: 'disposable local PostgreSQL', postgresVersion: (await execute(join(pgBin, 'postgres'), ['--version'])).trim(),
  networkListening: false, sharedDatabaseAccess: false, environmentFilesRead: false, clusterDirectory: cluster, serverStopped: !started,
  definitions: candidate.records.length, savedCompletedSyntheticSessions: savedSessions.length, generatedReports, pdfs,
  sourceFixtureAssertions: fixtureAssertions, knownSourceGapsWithheld: knownGaps, tables: finalStats, checks,
  submissionFailures,
  clinicalValidation: 'Not established by these technical tests.', applicationHttpRoutesTested: false,
  reportRenderer: 'Prepared review renderer reading embedded database definition; existing live app routes unchanged.',
  ...(failure ? { error: failure.message } : {}) };
await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(`Results: ${join(output, 'results.json')}`);
console.log(JSON.stringify({ status: result.status, completedChecks: checks.length, definitions: 186, savedCompletedSyntheticSessions: savedSessions.length, generatedReports, pdfs, serverStopped: result.serverStopped, sharedDatabaseAccess: false }, null, 2));
if (failure || submissionFailures.length) process.exitCode = 1;
