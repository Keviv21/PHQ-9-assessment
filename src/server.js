import http from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { languages } from './assessment.js';
import { assessmentQuestion, getAssessmentForm } from './forms.js';
import { openStore } from './store.js';
import { GeminiBridge } from './gemini-bridge.js';
import { recommendAssessments } from './recommendation.js';
import { getDraftAssessment, getLiveDraftForm, listDraftAssessments } from './draft-library.js';
import { openDraftStore } from './draft-store.js';
import { openPostgresStores } from './postgres-stores.js';
import { answerDoctor, fallbackDoctor, validateDoctorMessage } from './doctor-chat.js';
import { getCatalogEntry } from './assessment-catalog.js';
import { getDefinition, listDefinitions, useStoredDefinitions, useStoredReportProfiles, useStoredReportVisualSpecs } from './definition-library.js';
import { openAssessmentLibrary } from './assessment-library-store.js';
import { openReportProfileStore } from './report-profile-store.js';
import { openReportVisualSpecStore } from './report-visual-spec-store.js';
import { publicDefinition, publicSession } from './assessment-content.js';
import { assetPath } from './assessment-assets.js';
import { buildDefinitionReport, definitionReportHtml } from './definition-report.js';
import { analysisPreviewReport, analysisCatalogue } from './analysis-preview.js';
import { definitionReportPdf } from './definition-report-pdf.js';
import { adaptLegacyPhq9, phq9PreviewStates } from './phq9-report.js';
import { phq9Id } from './report-profiles.js';
import { openDefinitionStore } from './definition-store.js';
import { createDefinitionVoiceStore, nextDefinitionItem, voiceDefinitionState } from './definition-voice.js';
import { isAllowedWebSocketOrigin, usesExplicitSqliteTestBackend, validateDeploymentEnvironment } from './deployment.js';
import { openPatientStore } from './patient-store.js';
import { suggestForPatient } from './patient-routing.js';
import { openPatientRecommendationService } from './patient-recommendations.js';

validateDeploymentEnvironment();

const root = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(root, 'public');
let phq9GraphDefinition = null;
const sqliteTestBackend = usesExplicitSqliteTestBackend();
const demoPatients = sqliteTestBackend ? await import('./demo-patients.js') : null;
const getDemoPatient = demoPatients?.getDemoPatient ?? (() => null);
const listDemoPatients = demoPatients?.listDemoPatients ?? (() => []);
const suggestForDemoPatient = demoPatients?.suggestForDemoPatient ?? (() => null);
const dbPath = sqliteTestBackend ? process.env.DB_PATH : null;
const postgres = process.env.DATABASE_URL ? openPostgresStores() : null;
const patientStore = postgres ? openPatientStore(postgres.pool) : null;
const patientRecommendationService = postgres ? openPatientRecommendationService(postgres.pool) : null;
const store = postgres?.store ?? openStore(dbPath);
const draftStore = postgres?.draftStore ?? openDraftStore(dbPath);
const definitionStore = openDefinitionStore(postgres ? { pool: postgres.pool } : { path: dbPath });
const assessmentLibrary = openAssessmentLibrary(postgres ? { pool: postgres.pool } : { path: dbPath });
const reportProfileStore = openReportProfileStore(postgres ? { pool: postgres.pool } : { path: dbPath });
const reportVisualSpecStore = openReportVisualSpecStore(postgres ? { pool: postgres.pool } : { path: dbPath });
const assetRoot = process.env.ASSESSMENT_ASSET_ROOT || join(root, 'local-data/assessment-assets');
const definitionVoiceStore = createDefinitionVoiceStore(definitionStore);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
const textModel = process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.5-flash-lite';
const scoredDraftIds = new Set(['phq9', 'gad7', 'pcl5'].map((id) => getCatalogEntry(id).catalogDraftId));
const port = Number(process.env.PORT || 4174);
const allowedStatic = new Set(['/', '/clinic.html', '/clinic.css', '/clinic-recommend.css', '/clinic.js', '/analytics.css', '/analytics.js', '/doctor-chat.css', '/doctor-chat.js', '/openmind-mark.svg', '/index.html', '/assessment.html', '/assessment-polish.css', '/assessment-unified.css', '/casebook.css', '/app.js', '/i18n.js', '/audio-worklet.js', '/report.html', '/report.js', '/report-view.js', '/report.css', '/report-polish.css', '/report-view.css', '/recommend.html', '/recommend.js', '/patient-suggest.html', '/patient-suggest.js', '/assessment-library.html', '/assessment-library.js', '/assessment-library.css', '/draft-live.html', '/draft-live.js', '/draft-live.css', '/definition.html', '/definition.js', '/definition-information.js', '/definition-voice.js', '/definition.css']);
const activeAssessments = new Set();
const listRuntimePatients = () => patientStore ? patientStore.list() : Promise.resolve(listDemoPatients());
const getRuntimePatient = (id) => patientStore ? patientStore.get(id) : Promise.resolve(getDemoPatient(id));
const suggestRuntimePatient = (patient, focus = '') => patientRecommendationService
  ? patientRecommendationService.suggest(patient)
  : Promise.resolve(suggestForPatient(patient, focus));

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 200_000) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new RangeError('Send JSON.');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new RangeError('Request is too large.');
  }
  return JSON.parse(body);
}

const server = http.createServer(async (request, response) => {
  try {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/patients' && request.method === 'GET') {
    return json(response, 200, await listRuntimePatients());
  }
  const runtimePatientRoute = /^\/api\/patients\/([^/]+)\/(recommendations|prescriptions|reports|analytics|doctor-chat)$/.exec(url.pathname);
  if (runtimePatientRoute) {
    let patientId;
    try { patientId = decodeURIComponent(runtimePatientRoute[1]); }
    catch { return json(response, 400, { error: 'Invalid patient ID.' }); }
    const patient = await getRuntimePatient(patientId);
    if (!patient) return json(response, 404, { error: 'Patient not found.' });
    const action = runtimePatientRoute[2];
    if (action === 'recommendations' && request.method === 'GET') {
      try { return json(response, 200, await suggestRuntimePatient(patient, url.searchParams.get('focus') || '')); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    if (action === 'prescriptions' && request.method === 'GET') {
      return json(response, 200, [...await store.patientPrescriptions(patientId),
        ...await draftStore.patientPrescriptions(patientId),
        ...await definitionStore.patientPrescriptions(patientId)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (action === 'reports' && request.method === 'GET') {
      return json(response, 200, await store.patientResults(patientId));
    }
    if (action === 'analytics' && request.method === 'GET') {
      return json(response, 200, await store.patientAnalytics(patientId,
        [...await draftStore.patientAnalyticsRows(patientId),
          ...await definitionStore.patientAnalyticsRows(patientId)]));
    }
    if (action === 'prescriptions' && request.method === 'POST') {
      try {
        const { formId } = await readJson(request, 2000);
        const suggestion = await suggestRuntimePatient(patient);
        if (suggestion.status !== 'suggestions') return json(response, 409,
          { error: 'Clinical review is required before assigning an assessment.' });
        if (typeof formId === 'string' && formId.startsWith('draft:')) {
          const draftId = formId.slice('draft:'.length);
          if (scoredDraftIds.has(draftId) || !getLiveDraftForm(draftId)) {
            return json(response, 409, { error: 'This imported assessment is unavailable for assignment.' });
          }
          return json(response, 201, await draftStore.prescribe(patientId, draftId));
        }
        if (!suggestion.prescriptionChoices.some((item) => item.id === formId && item.availability === 'available')) {
          return json(response, 409, { error: 'This assessment is not available for assignment.' });
        }
        return json(response, 201, await store.prescribe(patientId, formId));
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
    if (action === 'doctor-chat' && request.method === 'POST') {
      try {
        const input = await readJson(request, 10_000);
        validateDoctorMessage(input.message, input.history);
        const routing = await suggestRuntimePatient(patient);
        if (routing.status !== 'suggestions') return json(response, 200,
          { reply: routing.message, suggestions: [], reviewedByDoctor: false });
        if (!apiKey) return json(response, 503, { error: 'Configure GEMINI_API_KEY to use the doctor conversation.' });
        return json(response, 200, await answerDoctor({ patient, ...input, apiKey, model: textModel }));
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
    return json(response, 405, { error: 'Method not allowed.' });
  }
  const runtimeDefinitionPatientRoute = /^\/api\/definition-patients\/([^/]+)\/prescriptions$/.exec(url.pathname);
  if (runtimeDefinitionPatientRoute && patientStore) {
    let patientId;
    try { patientId = decodeURIComponent(runtimeDefinitionPatientRoute[1]); }
    catch { return json(response, 400, { error: 'Invalid patient ID.' }); }
    const patient = await getRuntimePatient(patientId);
    if (!patient) return json(response, 404, { error: 'Patient not found.' });
    if (request.method === 'GET') return json(response, 200, await definitionStore.patientPrescriptions(patientId));
    if (request.method === 'POST') {
      try {
        const { formId } = await readJson(request, 2000);
        if ((await suggestRuntimePatient(patient)).status !== 'suggestions') return json(response, 409,
          { error: 'Clinical review is required before assigning an assessment.' });
        return json(response, 201, await definitionStore.prescribe(patientId, formId));
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
    return json(response, 405, { error: 'Method not allowed.' });
  }
  if (!sqliteTestBackend && url.pathname === '/api/demo-patients' && request.method === 'GET') {
    return json(response, 200, []);
  }
  if (!sqliteTestBackend && (url.pathname.startsWith('/api/demo-patients/') ||
      url.pathname.startsWith('/api/definition-patients/'))) {
    return json(response, 404, { error: 'Demo patients are unavailable when PostgreSQL is active.' });
  }
  if (process.env.ASSESSMENT_ANALYSIS_PREVIEW === 'true' && request.method === 'GET' && url.pathname.startsWith('/preview/analysis')) {
    if (url.pathname === '/preview/analysis') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(analysisCatalogue(listDefinitions().map(d => getDefinition(d.id))));
    }
    const match = /^\/preview\/analysis\/([a-z0-9-]+)(?:\.(html|json|pdf))?$/.exec(url.pathname);
    const d = match && getDefinition(match[1]);
    if (!d) return json(response, 404, { error: 'Assessment not found.' });
    const report = analysisPreviewReport(d, { repeated: url.searchParams.get('repeated') === '1' });
    if (match[2] === 'json') return json(response, 200, report);
    if (match[2] === 'pdf') {
      const pdf = await definitionReportPdf(report);
      response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="assessment-review.pdf"' });
      return response.end(pdf);
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'" });
    return response.end(definitionReportHtml(report));
  }
  if (url.pathname === '/api/definitions' && request.method === 'GET') return json(response, 200, listDefinitions());
  if (url.pathname === '/api/report-profiles/readiness' && request.method === 'GET') {
    return json(response, 200, await reportProfileStore.readiness());
  }
  if (url.pathname === '/api/report-visual-specs/readiness' && request.method === 'GET') {
    return json(response, 200, await reportVisualSpecStore.readiness());
  }
  if (url.pathname.startsWith('/api/definitions/') && request.method === 'GET') {
    let id;
    try { id = decodeURIComponent(url.pathname.slice('/api/definitions/'.length)); }
    catch { return json(response, 400, { error: 'Invalid ID.' }); }
    const definition = getDefinition(id);
    return definition ? json(response, 200, publicDefinition(definition)) : json(response, 404, { error: 'Assessment not found.' });
  }
  const assetRoute = /^\/api\/assessment-assets\/([a-f0-9]{64})\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (assetRoute && request.method === 'GET') {
    const version = await assessmentLibrary.getVersion(assetRoute[1]);
    const selected = version?.runtime.assets?.find(a => a.id === assetRoute[2]);
    const asset = selected && await assessmentLibrary.getAsset(selected.sha256);
    if (!asset || !['image/png', 'image/jpeg'].includes(asset.mime_type)) return json(response, 404, { error: 'Display image not found.' });
    const bytes = readFileSync(assetPath(assetRoot, asset.storage_key));
    response.writeHead(200, { 'content-type': asset.mime_type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' });
    return response.end(bytes);
  }
  const previewRoute = /^\/preview\/phq9-report(?:\.(html|json|pdf))?$/.exec(url.pathname);
  const legacyPhq9Route = /^\/api\/phq9-sessions\/([0-9a-f-]{36})\/report\.(html|json|pdf)$/.exec(url.pathname);
  if ((previewRoute || legacyPhq9Route) && request.method === 'GET') {
    let report, format;
    if (previewRoute) {
      const states = phq9PreviewStates(phq9GraphDefinition);
      report = buildDefinitionReport(states.at(-1), url.searchParams.get('single') === '1' ? [] : states.slice(0,-1));
      report.preview = true;
      report.reportPath = '/preview/phq9-report';
      report.downloadUrl = '/preview/phq9-report.pdf' + (url.searchParams.get('single') === '1' ? '?single=1' : '');
      format = previewRoute[1] || 'html';
    } else {
      const state = await store.get(legacyPhq9Route[1]);
      if (!state || state.status !== 'completed') return json(response, 404, { error: 'Completed PHQ-9 result not found.' });
      let adapted;
      try { adapted = adaptLegacyPhq9(state, phq9GraphDefinition); }
      catch (error) { return json(response, 422, { error: error.message }); }
      const summaries = state.demoPatientId ? await store.patientResults(state.demoPatientId) : [];
      const history = [];
      for (const row of summaries.filter(s => s.id !== state.id && s.formId === 'phq9' && s.language === state.language && s.formVersion === state.formVersion && s.completedAt <= state.completedAt)) {
        const earlier = await store.get(row.id);
        try { history.push(adaptLegacyPhq9(earlier, phq9GraphDefinition)); } catch { /* Incompatible historical responses stay in their original report. */ }
      }
      report = buildDefinitionReport(adapted, history);
      report.reportPath = `/api/phq9-sessions/${state.id}/report`;
      format = legacyPhq9Route[2];
    }
    if (format === 'json') return json(response, 200, report);
    if (format === 'pdf') {
      try {
        const bytes = await definitionReportPdf(report);
        response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="phq9-report.pdf"' });
        return response.end(bytes);
      } catch (error) { return json(response, error.status || 500, { error: error.message }); }
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'" });
    return response.end(definitionReportHtml(report));
  }
  const definitionReportRoute = /^\/api\/definition-sessions\/([0-9a-f-]{36})\/report\.(json|html|pdf)$/.exec(url.pathname);
  if (definitionReportRoute && request.method === 'GET') {
    const state = await definitionStore.getSession(definitionReportRoute[1]);
    if (!state) return json(response, 404, { error: 'Session not found.' });
    if (state.status !== 'completed') return json(response, 409, { error: 'Complete the assessment before generating a report.' });
    const patient = await getRuntimePatient(state.demoPatientId);
    const stateWithPatient = patient ? { ...state, patientDetails: patient.demographics } : state;
    const report = buildDefinitionReport(stateWithPatient, await definitionStore.patientSessions(state.demoPatientId));
    if (definitionReportRoute[2] === 'json') return json(response, 200, report);
    if (definitionReportRoute[2] === 'pdf') {
      try {
        const pdf = await definitionReportPdf(report);
        response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="assessment-${state.id}.pdf"` });
        return response.end(pdf);
      } catch (error) { return json(response, error.status || 500, { error: error.message }); }
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'" });
    return response.end(definitionReportHtml(report));
  }
  const definitionPatientRoute = /^\/api\/definition-patients\/(demo-[a-z])\/prescriptions$/.exec(url.pathname);
  if (definitionPatientRoute) {
    const patientId = definitionPatientRoute[1];
    if (!getDemoPatient(patientId)) return json(response, 404, { error: 'Patient not found.' });
    if (request.method === 'GET') return json(response, 200, await definitionStore.patientPrescriptions(patientId));
    if (request.method === 'POST') {
      try {
        const { formId } = await readJson(request, 2000);
        const suggestion = suggestForDemoPatient(patientId);
        if (suggestion?.status !== 'suggestions') return json(response, 409, { error: 'Clinical review required before assignment.' });
        return json(response, 201, await definitionStore.prescribe(patientId, formId));
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
  }
  const definitionPrescriptionRoute = /^\/api\/definition-prescriptions\/([0-9a-f-]{36})(\/start)?$/i.exec(url.pathname);
  if (definitionPrescriptionRoute) {
    const id = definitionPrescriptionRoute[1];
    if (request.method === 'GET' && !definitionPrescriptionRoute[2]) {
      const prescription = await definitionStore.getPrescription(id);
      return prescription ? json(response, 200, { ...prescription, patient: await getRuntimePatient(prescription.demoPatientId) }) :
        json(response, 404, { error: 'Assignment not found.' });
    }
    if (request.method === 'POST' && definitionPrescriptionRoute[2]) {
      try { return json(response, 200, publicSession(await definitionStore.start(id))); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
  }
  const definitionSessionRoute = /^\/api\/definition-sessions\/([0-9a-f-]{36})(\/finish)?$/i.exec(url.pathname);
  if (definitionSessionRoute) {
    const id = definitionSessionRoute[1];
    if (request.method === 'GET' && !definitionSessionRoute[2]) {
      const state = await definitionStore.getSession(id);
      return state ? json(response, 200, publicSession(state)) : json(response, 404, { error: 'Session not found.' });
    }
    if (request.method === 'PUT' || (request.method === 'POST' && definitionSessionRoute[2])) {
      try {
        const { answers, context } = await readJson(request);
        return json(response, 200, publicSession(await definitionStore.save(id, answers, Boolean(definitionSessionRoute[2]), context ?? null)));
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
  }
  if (url.pathname === '/api/draft-sessions' && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 1000) request.destroy(); });
    request.on('end', async () => {
      try {
        const { draftId, mode, prescriptionId } = JSON.parse(body);
        const state = prescriptionId ? await draftStore.startPrescription(prescriptionId, mode) : await draftStore.create(draftId, mode);
        return json(response, prescriptionId && state.answers.length ? 200 : 201, state);
      } catch (error) { return json(response, 400, { error: error.message }); }
    });
    return;
  }
  const patientPrescriptionsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/prescriptions$/.exec(url.pathname);
  if (patientPrescriptionsRoute && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 1000) request.destroy(); });
    request.on('end', async () => {
      let formId;
      try { ({ formId } = JSON.parse(body)); }
      catch { return json(response, 400, { error: 'Choose an assessment.' }); }
      const suggestion = suggestForDemoPatient(patientPrescriptionsRoute[1]);
      if (!suggestion) return json(response, 404, { error: 'Demo patient not found.' });
      if (suggestion.status !== 'suggestions') {
        return json(response, 409, { error: 'This assessment cannot be prescribed from the current patient summary.' });
      }
      if (typeof formId === 'string' && formId.startsWith('draft:')) {
        const draftId = formId.slice('draft:'.length);
        if (scoredDraftIds.has(draftId)) return json(response, 409, { error: 'Choose the scored version of this assessment.' });
        if (!getLiveDraftForm(draftId)) return json(response, 409, { error: 'This imported assessment needs complete source content before assignment.' });
        try { return json(response, 201, await draftStore.prescribe(patientPrescriptionsRoute[1], draftId)); }
        catch (error) { return json(response, 400, { error: error.message }); }
      }
      if (!suggestion.prescriptionChoices.some((item) => item.id === formId && item.availability === 'available')) {
        return json(response, 409, { error: 'This assessment is not available for assignment.' });
      }
      try { return json(response, 201, await store.prescribe(patientPrescriptionsRoute[1], formId)); }
      catch (error) { return json(response, 400, { error: error.message }); }
    });
    return;
  }
  const doctorChatRoute = /^\/api\/demo-patients\/(demo-[a-z])\/doctor-chat$/.exec(url.pathname);
  if (doctorChatRoute && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    const patient = getDemoPatient(doctorChatRoute[1]);
    if (!patient) return json(response, 404, { error: 'Demo patient not found.' });
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => { body += chunk; if (body.length > 10000) tooLarge = true; });
    request.on('end', async () => {
      if (tooLarge) return json(response, 413, { error: 'Conversation is too long.' });
      let input;
      try { input = JSON.parse(body); validateDoctorMessage(input.message, input.history); }
      catch (error) { return json(response, 400, { error: error.message }); }
      const routing = suggestForDemoPatient(patient.id);
      if (routing.status !== 'suggestions') return json(response, 200, {
        reply: routing.message, suggestions: [], reviewedByDoctor: false,
      });
      if (!apiKey) return json(response, 503, { error: 'Configure GEMINI_API_KEY to use the doctor conversation.' });
      try {
        return json(response, 200, await answerDoctor({ patient, ...input, apiKey, model: textModel }));
      } catch (error) {
        console.error('Doctor conversation failed:', error.message);
        return json(response, 200, fallbackDoctor(patient, input.message, input.history));
      }
    });
    return;
  }
  if (url.pathname === '/api/recommendations') {
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 4096) tooLarge = true;
    });
    request.on('end', () => {
      if (tooLarge) return json(response, 413, { error: 'Context is too large. Use only structured fields.' });
      try { return json(response, 200, recommendAssessments(JSON.parse(body))); }
      catch (error) { return json(response, 400, { error: error.message }); }
    });
    return;
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  if (url.pathname === '/api/health') {
    if (postgres) await postgres.health();
    return json(response, 200, { ok: true, database: postgres ? 'postgresql' : 'sqlite-test' });
  }
  if (url.pathname === '/api/draft-sessions') return json(response, 200, await draftStore.list());
  if (url.pathname.startsWith('/api/draft-sessions/')) {
    const id = url.pathname.slice('/api/draft-sessions/'.length);
    const state = await draftStore.get(id);
    return state ? json(response, 200, state) : json(response, 404, { error: 'Live review session not found.' });
  }
  if (url.pathname === '/api/assessment-library') return json(response, 200, postgres ? [] : listDraftAssessments());
  if (url.pathname.startsWith('/api/assessment-library/')) {
    if (postgres) return json(response, 404, { error: 'Assessment definitions are provided by PostgreSQL.' });
    let id;
    try { id = decodeURIComponent(url.pathname.slice('/api/assessment-library/'.length)); }
    catch { return json(response, 400, { error: 'Invalid assessment ID.' }); }
    const record = getDraftAssessment(id);
    return record ? json(response, 200, record) : json(response, 404, { error: 'Assessment not found.' });
  }
  if (url.pathname === '/api/demo-patients') return json(response, 200, listDemoPatients());
  if (url.pathname === '/api/analytics/overview') return json(response, 200,
    await store.analyticsOverview([...await draftStore.analyticsPrescriptionRows(),
      ...await definitionStore.analyticsPrescriptionRows()]));
  const patientAnalyticsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/analytics$/.exec(url.pathname);
  if (patientAnalyticsRoute) {
    return getDemoPatient(patientAnalyticsRoute[1])
      ? json(response, 200, await store.patientAnalytics(patientAnalyticsRoute[1],
        [...await draftStore.patientAnalyticsRows(patientAnalyticsRoute[1]),
          ...await definitionStore.patientAnalyticsRows(patientAnalyticsRoute[1])]))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  if (patientPrescriptionsRoute) {
    return getDemoPatient(patientPrescriptionsRoute[1])
      ? json(response, 200, [...await store.patientPrescriptions(patientPrescriptionsRoute[1]),
        ...await draftStore.patientPrescriptions(patientPrescriptionsRoute[1]),
        ...await definitionStore.patientPrescriptions(patientPrescriptionsRoute[1])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  const patientReportsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/reports$/.exec(url.pathname);
  if (patientReportsRoute) {
    return getDemoPatient(patientReportsRoute[1])
      ? json(response, 200, await store.patientResults(patientReportsRoute[1]))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  const prescriptionRoute = /^\/api\/prescriptions\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (prescriptionRoute) {
    const prescription = await store.getPrescription(prescriptionRoute[1]) || await draftStore.getPrescription(prescriptionRoute[1]) || await definitionStore.getPrescription(prescriptionRoute[1]);
    return prescription ? json(response, 200, { ...prescription, patient: await getRuntimePatient(prescription.demoPatientId) })
      : json(response, 404, { error: 'Prescription not found.' });
  }
  const patientRoute = /^\/api\/demo-patients\/(demo-[a-z])\/recommendations$/.exec(url.pathname);
  if (patientRoute) {
    try {
      const suggestion = suggestForDemoPatient(patientRoute[1], url.searchParams.get('focus') || '');
      return suggestion ? json(response, 200, suggestion) : json(response, 404, { error: 'Demo patient not found.' });
    } catch (error) { return json(response, 400, { error: error.message }); }
  }
  if (url.pathname === '/api/config') {
    return json(response, 200, { geminiConfigured: Boolean(apiKey), model, webcamFrameRate: 1, languages });
  }
  if (url.pathname === '/api/form') {
    let form;
    try { form = getAssessmentForm(url.searchParams.get('formId') || 'phq9', url.searchParams.get('language') || 'en'); }
    catch { return json(response, 400, { error: 'Unsupported assessment language.' }); }
    return json(response, 200, {
      formId: form.formId,
      language: form.language,
      version: form.version,
      title: form.title,
      instructions: form.instructions,
      referencePeriod: form.referencePeriod,
      options: form.options,
      questions: form.questions,
      questionCount: form.questions.length,
      source: form.source,
      scoringSource: form.scoringSource,
    });
  }
  if (url.pathname === '/api/results') return json(response, 200, await store.results());
  if (url.pathname.startsWith('/api/results/')) {
    const id = url.pathname.slice('/api/results/'.length);
    const assessment = await store.get(id);
    if (!assessment || assessment.status !== 'completed') return json(response, 404, { error: 'Result not found.' });
    return json(response, 200, assessment);
  }
  if (!allowedStatic.has(url.pathname)) return json(response, 404, { error: 'Not found.' });
  const filename = url.pathname === '/' ? 'clinic.html' : url.pathname === '/assessment.html' ? 'index.html' : url.pathname.slice(1);
  const path = join(publicRoot, filename);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  try {
    const content = readFileSync(path);
    response.writeHead(200, {
      'content-type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`,
      'cache-control': 'no-store',
    });
    response.end(content);
  } catch {
    json(response, 404, { error: 'File not found.' });
  }
  } catch (error) {
    console.error('Request failed:', error.message);
    if (!response.headersSent) json(response, 503, { error: 'Database request failed.' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
wss.on('connection', (socket, request) => {
  handleScoredConnection(socket, request).catch((error) => {
    console.error('Assessment connection failed:', error.message);
    socket.close(1011, 'Database request failed.');
  });
});
function matchOptionValue(text, form, currentNumber) {
  if (typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase().replace(/[.,!?;:]+$/, '');
  if (!clean) return null;
  const questions = form?.questions || [];
  const currentQuestion = questions[currentNumber - 1];
  const options = currentQuestion?.options || form?.options || [];
  if (!options.length) return null;

  const numMatch = clean.match(/^(?:option\s+|choice\s+|#)?([0-9]+)$/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    const found = options.find((opt) => opt.value === val);
    if (found !== undefined) return found.value;
  }

  const wordNums = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
  if (wordNums[clean] !== undefined) {
    const found = options.find((opt) => opt.value === wordNums[clean]);
    if (found !== undefined) return found.value;
  }

  for (const opt of options) {
    const label = (opt.label || '').toLowerCase().trim();
    const desc = (opt.description || '').toLowerCase().trim();
    if (clean === label || clean === desc) return opt.value;
  }

  for (const opt of options) {
    const label = (opt.label || '').toLowerCase().trim();
    if (label && (clean.includes(label) || label.includes(clean))) return opt.value;
  }

  if (/(ಖಂಡಿತವಾಗಿಯೂ ಇಲ್ಲ|ಸ್ವಲ್ಪವೂ ಇಲ್ಲ|ಒಂದು ದಿನವೂ ಇಲ್ಲ|ಇಲ್ಲವೇ ಇಲ್ಲ|बिल्कुल नहीं|एक भी दिन नहीं|अजिबात नाही)/u.test(clean)) {
    const opt0 = options.find((opt) => opt.value === 0);
    if (opt0 !== undefined) return 0;
  }
  if (/(ಕೆಲವು ದಿನ|ಕೆಲ ದಿನ|कई दिन|कुछ दिन|काही दिवस)/u.test(clean)) {
    const opt1 = options.find((opt) => opt.value === 1);
    if (opt1 !== undefined) return 1;
  }
  if (/(ಅರ್ಧಕ್ಕಿಂತ ಹೆಚ್ಚು|ಹೆಚ್ಚಿನ ದಿನ|आधे से अधिक|आधे से ज्यादा|निम्म्याहून अधिक)/u.test(clean)) {
    const opt2 = options.find((opt) => opt.value === 2);
    if (opt2 !== undefined) return 2;
  }
  if (/(ಬಹುತೇಕ ಪ್ರತಿದಿನ|ಪ್ರತಿದಿನ|ಎಲ್ಲಾ ದಿನ|लगभग हर दिन|हर दिन|रोज|जवळपास दररोज)/u.test(clean)) {
    const opt3 = options.find((opt) => opt.value === 3);
    if (opt3 !== undefined) return 3;
  }

  if (/^(never|none|not at all|not once|no days|hardly ever)\b/i.test(clean)) {
    const opt0 = options.find((opt) => opt.value === 0);
    if (opt0 !== undefined) return 0;
  }
  if (/^(several|few days|a few days|some days|several days)\b/i.test(clean)) {
    const opt1 = options.find((opt) => opt.value === 1);
    if (opt1 !== undefined) return 1;
  }
  if (/^(more than half|half the days|most days|over half)\b/i.test(clean)) {
    const opt2 = options.find((opt) => opt.value === 2);
    if (opt2 !== undefined) return 2;
  }
  if (/^(nearly every day|almost every day|every day|everyday|always|daily|all the time)\b/i.test(clean)) {
    const opt3 = options.find((opt) => opt.value === 3);
    if (opt3 !== undefined) return 3;
  }

  return null;
}

async function handleScoredConnection(socket, request) {
  if (!isAllowedWebSocketOrigin(request)) {
    socket.close(1008, 'Unexpected origin.');
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const mode = url.searchParams.get('mode');
  let language = url.searchParams.get('language') || 'en';
  const prescriptionId = url.searchParams.get('prescriptionId') || '';
  const prescription = await store.getPrescription(prescriptionId);
  const demoPatientId = prescription?.demoPatientId || null;
  const formId = prescription?.formId || null;
  let form;
  try { form = getAssessmentForm(formId, language); }
  catch { socket.close(1008, 'Unsupported assessment language.'); return; }
  if (!['demo', 'live'].includes(mode)) {
    socket.close(1008, 'Choose demo or live mode.');
    return;
  }
  if (!demoPatientId) {
    socket.close(1008, 'A valid prescription is required before starting PHQ-9.');
    return;
  }
  const suggestion = suggestForPatient(await getRuntimePatient(demoPatientId));
  if (!suggestion || suggestion.status !== 'suggestions' ||
      !suggestion.prescriptionChoices.some((item) => item.id === formId && item.availability === 'available')) {
    socket.close(1008, 'This assessment is not available for this demo patient.');
    return;
  }
  if (mode === 'live' && !apiKey) {
    socket.send(JSON.stringify({ type: 'error', message: 'Set GEMINI_API_KEY in .env before live mode.' }));
    socket.close(1008, 'Gemini API key missing.');
    return;
  }

  const requestedId = url.searchParams.get('assessmentId');
  if (requestedId && requestedId !== prescription.assessmentId) {
    socket.close(1008, 'Assessment does not belong to this prescription.');
    return;
  }
  const assessment = requestedId ? await store.get(requestedId) : await store.startPrescription(prescriptionId, mode, language);
  if (!assessment || assessment.formId !== formId || assessment.mode !== mode || assessment.demoPatientId !== demoPatientId || assessment.status === 'completed' || activeAssessments.has(assessment.id)) {
    socket.close(1008, 'Assessment cannot be resumed.');
    return;
  }
  if (assessment.language !== language) {
    store.updateLanguage?.(assessment.id, language);
    assessment.language = language;
    form = getAssessmentForm(formId, language);
  }
  activeAssessments.add(assessment.id);
  let pending = null;
  let lastVideoAt = 0;
  let bridge = null;

  function send(message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function sendState(state) {
    send({
      type: 'state',
      assessment: state,
      question: assessmentQuestion(formId, state.currentNumber, language),
    });
  }

  sendState(assessment);
  if (mode === 'live') {
    bridge = new GeminiBridge({ apiKey, model, socket, store, assessmentId: assessment.id, formId, language, onState: sendState });
    bridge.start().catch((error) => send({ type: 'error', message: error.message }));
  }

  let messageQueue = Promise.resolve();
  socket.on('message', (payload, isBinary) => {
    messageQueue = messageQueue.then(async () => {
    try {
      if (isBinary) {
        if (mode !== 'live' || !bridge || payload.length < 3) return;
        const kind = payload[0];
        const data = payload.subarray(1);
        if (kind === 1 && data.length % 2 === 0) bridge.sendAudio(data);
        if (kind === 2 && data[0] === 0xff && data[1] === 0xd8 &&
            data.at(-2) === 0xff && data.at(-1) === 0xd9 && Date.now() - lastVideoAt >= 950) {
          lastVideoAt = Date.now();
          bridge.sendVideo(data);
        }
        return;
      }

      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'select') {
        const state = await store.get(assessment.id);
        if (state.status !== 'in_progress') throw new Error('Assessment is completed.');
        const options = form.options || form.questions[state.currentNumber - 1]?.options || [];
        if (!Number.isInteger(message.value) || message.value < 0 || message.value >= options.length) {
          throw new Error(`Choose a value from 0 to ${options.length - 1}.`);
        }
        if (bridge) {
          const opt = options.find((o) => o.value === message.value) || options[message.value];
          const summary = opt?.label || String(message.value);
          bridge.pending = { number: state.currentNumber, value: message.value, method: 'screen', summary };
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          pending = { number: state.currentNumber, value: message.value };
          send({ type: 'proposal', number: pending.number, value: pending.value, label: options[pending.value].label });
        }
      } else if (message.type === 'say') {
        const state = await store.get(assessment.id);
        if (!state || state.status !== 'in_progress') throw new Error('Review the answers on screen.');
        const text = message.text?.trim() || '';
        if (bridge?.pending && /^(yes|yeah|yep|correct|right|confirm|that's right|thats right|haan|ha|sahi)\b/i.test(text)) {
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          const matchedValue = matchOptionValue(text, form, state.currentNumber);
          if (matchedValue !== null) {
            const options = form.options || form.questions[state.currentNumber - 1]?.options || [];
            const opt = options.find((o) => o.value === matchedValue) || options[matchedValue];
            const summary = opt?.label || text;
            if (bridge) {
              bridge.pending = { number: state.currentNumber, value: matchedValue, method: 'screen', summary };
              const result = await bridge.confirm();
              if (!result.accepted) throw new Error(result.error);
              bridge.afterConfirmation(result);
            } else {
              const nextState = await store.record(assessment.id, state.currentNumber, matchedValue, 'screen', summary);
              sendState(nextState);
            }
          } else {
            if (!bridge) throw new Error('Text conversation requires Live mode.');
            bridge.sendText(text);
          }
        }
      } else if (message.type === 'confirm') {
        if (bridge) {
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          if (!pending) throw new Error('Select an answer first.');
          const state = await store.record(assessment.id, pending.number, pending.value, 'demo');
          pending = null;
          sendState(state);
        }
      } else if (message.type === 'cancel') {
        if (bridge) { bridge.cancel(); await bridge.afterCancellation(); }
        else { pending = null; send({ type: 'proposal_cleared' }); }
      } else if (message.type === 'set_language') {
        const nextLang = message.language;
        try {
          const nextForm = getAssessmentForm(formId, nextLang);
          form = nextForm;
          language = nextLang;
          await store.updateLanguage(assessment.id, nextLang);
          if (bridge) {
            await bridge.setLanguage(nextLang, nextForm);
          }
          const currentState = await store.get(assessment.id);
          if (currentState) sendState(currentState);
        } catch (err) {
          send({ type: 'error', message: err.message });
        }
      } else if (message.type === 'finalize') {
        const state = await store.finalize(assessment.id, message.answers);
        sendState(state);
        bridge?.stop();
      } else {
        throw new Error('Unknown message type.');
      }
    } catch (error) {
      send({ type: 'error', message: error.message });
    }
    });
  });

  socket.on('close', () => {
    activeAssessments.delete(assessment.id);
    bridge?.stop();
  });
}

const draftWss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
const definitionWss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
server.on('upgrade', (request, socket, head) => {
  let pathname;
  try { pathname = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`).pathname; }
  catch { socket.destroy(); return; }
  const target = pathname === '/ws' ? wss : pathname === '/draft-ws' ? draftWss :
    pathname === '/definition-ws' ? definitionWss : null;
  if (!target) { socket.destroy(); return; }
  target.handleUpgrade(request, socket, head, (client) => target.emit('connection', client, request));
});
const activeDraftSessions = new Set();
const activeDefinitionSessions = new Set();
definitionWss.on('connection', (socket, request) => {
  handleDefinitionConnection(socket, request).catch((error) => {
    console.error('Definition voice connection failed:', error.message);
    socket.close(1011, 'Assessment voice connection failed.');
  });
});
async function handleDefinitionConnection(socket, request) {
  if (!isAllowedWebSocketOrigin(request)) {
    socket.close(1008, 'Unexpected origin.'); return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const sessionId = url.searchParams.get('sessionId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) { socket.close(1008, 'Session ID required.'); return; }
  const state = await definitionStore.getSession(sessionId);
  if (!state || state.status !== 'in_progress' || activeDefinitionSessions.has(sessionId)) {
    socket.close(1008, 'Assessment session is unavailable.'); return;
  }
  const prescription = await definitionStore.getPrescription(state.prescriptionId);
  if (!prescription || prescription.assessmentId !== sessionId || !getDemoPatient(prescription.demoPatientId)) {
    socket.close(1008, 'Assignment does not match this session.'); return;
  }
  if (!apiKey) { socket.close(1008, 'Gemini Live is not configured.'); return; }
  if (!nextDefinitionItem(state)) { socket.close(1008, 'Review the completed answers on screen.'); return; }
  activeDefinitionSessions.add(sessionId);
  const snapshot = state.formSnapshot;
  const form = { definition: true, formId: snapshot.id, title: snapshot.title,
    referencePeriod: snapshot.referencePeriod?.instruction_claims?.join(', ') || '',
    questions: snapshot.questions };
  let lastVideoAt = 0;
  let bridge;
  const send = (message) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); };
  const sendState = (current) => {
    const next = nextDefinitionItem(current);
    send({ type: 'state', assessment: publicSession(voiceDefinitionState(current)),
      question: next ? { number: next.number, total: snapshot.questions.length, ...next.item } : null });
  };
  sendState(state);
  bridge = new GeminiBridge({ apiKey, model, socket, store: definitionVoiceStore,
    assessmentId: sessionId, formId: form.formId, language: 'en', formOverride: form, onState: sendState });
  bridge.start().catch((error) => send({ type: 'error', message: error.message }));
  let queue = Promise.resolve();
  socket.on('message', (payload, isBinary) => {
    queue = queue.then(async () => {
      try {
        if (isBinary) {
          if (payload.length < 3) return;
          const data = payload.subarray(1);
          if (payload[0] === 1 && data.length % 2 === 0) bridge.sendAudio(data);
          // Camera frames are optional conversational context only.
          if (payload[0] === 2 && data[0] === 0xff && data[1] === 0xd8 &&
              data.at(-2) === 0xff && data.at(-1) === 0xd9 && Date.now() - lastVideoAt >= 950) {
            lastVideoAt = Date.now(); bridge.sendVideo(data);
          }
          return;
        }
        const message = JSON.parse(payload.toString('utf8'));
        if (message.type === 'say') bridge.sendText(message.text);
        else if (message.type === 'confirm') {
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else if (message.type === 'cancel') {
          bridge.cancel(); await bridge.afterCancellation();
        } else throw new Error('Unknown message type.');
      } catch (error) { send({ type: 'error', message: error.message }); }
    });
  });
  socket.on('close', () => { activeDefinitionSessions.delete(sessionId); bridge.stop(); });
}
draftWss.on('connection', (socket, request) => {
  handleDraftConnection(socket, request).catch((error) => {
    console.error('Imported assessment connection failed:', error.message);
    socket.close(1011, 'Database request failed.');
  });
});
async function handleDraftConnection(socket, request) {
  if (!isAllowedWebSocketOrigin(request)) {
    socket.close(1008, 'Unexpected origin.');
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const sessionId = url.searchParams.get('sessionId') || '';
  const draft = await draftStore.get(sessionId);
  const form = draft && getLiveDraftForm(draft.formId);
  if (!draft || !form || draft.status === 'completed' || activeDraftSessions.has(sessionId)) {
    socket.close(1008, 'Live review session is unavailable.');
    return;
  }
  if (draft.mode === 'live' && draft.status === 'in_progress' && !apiKey) {
    socket.close(1008, 'Gemini Live is not configured.');
    return;
  }
  activeDraftSessions.add(sessionId);
  let pending = null;
  let bridge = null;
  let lastVideoAt = 0;
  const bridgeStore = { get: (id) => draftStore.get(id), record: (...args) => draftStore.record(...args) };

  function send(message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  function sendState(state) {
    send({ type: 'state', assessment: state,
      question: state.currentNumber ? { number: state.currentNumber, total: form.questions.length, ...form.questions[state.currentNumber - 1] } : null });
  }

  sendState(draft);
  if (draft.mode === 'live' && draft.status === 'in_progress') {
    bridge = new GeminiBridge({ apiKey, model, socket, store: bridgeStore, assessmentId: sessionId,
      formId: form.formId, language: 'en', formOverride: form, onState: sendState });
    bridge.start().catch((error) => send({ type: 'error', message: error.message }));
  }

  let messageQueue = Promise.resolve();
  socket.on('message', (payload, isBinary) => {
    messageQueue = messageQueue.then(async () => {
    try {
      if (isBinary) {
        if (!bridge || payload.length < 3) return;
        const kind = payload[0];
        const data = payload.subarray(1);
        if (kind === 1 && data.length % 2 === 0) bridge.sendAudio(data);
        if (kind === 2 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff &&
            data.at(-1) === 0xd9 && Date.now() - lastVideoAt >= 950) {
          lastVideoAt = Date.now();
          bridge.sendVideo(data);
        }
        return;
      }
      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'select') {
        const state = await draftStore.get(sessionId);
        if (state.status !== 'in_progress') throw new Error('Review the answers on screen.');
        const options = form.questions[state.currentNumber - 1].options;
        if (!Number.isInteger(message.value) || message.value < 0 || message.value >= options.length) throw new RangeError('Choose an available option.');
        if (bridge) {
          const opt = options[message.value];
          const summary = opt?.label || String(message.value);
          bridge.pending = { number: state.currentNumber, value: message.value, method: 'screen', summary };
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          pending = { number: state.currentNumber, value: message.value };
          send({ type: 'proposal', number: pending.number, value: pending.value, label: options[pending.value].label });
        }
      } else if (message.type === 'say') {
        const state = await draftStore.get(sessionId);
        if (!state || state.status !== 'in_progress') throw new Error('Review the answers on screen.');
        const text = message.text?.trim() || '';
        if (bridge?.pending && /^(yes|yeah|yep|correct|right|confirm|that's right|thats right|haan|ha|sahi)\b/i.test(text)) {
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          const matchedValue = matchOptionValue(text, form, state.currentNumber);
          if (matchedValue !== null) {
            const options = form.questions[state.currentNumber - 1].options;
            const opt = options[matchedValue];
            const summary = opt?.label || text;
            if (bridge) {
              bridge.pending = { number: state.currentNumber, value: matchedValue, method: 'screen', summary };
              const result = await bridge.confirm();
              if (!result.accepted) throw new Error(result.error);
              bridge.afterConfirmation(result);
            } else {
              const nextState = await draftStore.record(sessionId, state.currentNumber, matchedValue, 'screen');
              sendState(nextState);
            }
          } else {
            if (!bridge) throw new Error('Text conversation requires Gemini Live.');
            bridge.sendText(text);
          }
        }
      } else if (message.type === 'confirm') {
        if (bridge) {
          const result = await bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          if (!pending) throw new Error('Choose an answer first.');
          const state = await draftStore.record(sessionId, pending.number, pending.value, 'demo');
          pending = null;
          sendState(state);
        }
      } else if (message.type === 'cancel') {
        if (bridge) { bridge.cancel(); await bridge.afterCancellation(); }
        else { pending = null; send({ type: 'proposal_cleared' }); }
      } else if (message.type === 'finalize') {
        const state = await draftStore.finalize(sessionId, message.answers);
        sendState(state);
        bridge?.stop();
      } else throw new Error('Unknown message type.');
    } catch (error) { send({ type: 'error', message: error.message }); }
    });
  });
  socket.on('close', () => { activeDraftSessions.delete(sessionId); bridge?.stop(); });
}

if (postgres) {
  if (process.env.ASSESSMENT_DATABASE_NAME) {
    const { rows } = await postgres.pool.query('SELECT current_database() AS name');
    if (rows[0].name !== process.env.ASSESSMENT_DATABASE_NAME) throw new Error('Connected database does not match ASSESSMENT_DATABASE_NAME.');
  }
  await postgres.initialize((client) => definitionStore.initialize(client));
}
await assessmentLibrary.initialize();
await reportProfileStore.initialize();
await reportVisualSpecStore.initialize();
const storedDefinitions = await assessmentLibrary.activeDefinitions();
let exportedDefinitions = [];
if (!postgres && process.env.ASSESSMENT_LIBRARY_FILE) {
  const exported = JSON.parse(readFileSync(process.env.ASSESSMENT_LIBRARY_FILE, 'utf8'));
  if (exported.schemaVersion !== 1 || !Array.isArray(exported.records)) throw new Error('Unsupported assessment library file.');
  exportedDefinitions = exported.records;
}
// A targeted database update must not hide the other definitions in the runtime file.
const storedLibraryLoaded = storedDefinitions.length > 0;
const fileLibraryLoaded = exportedDefinitions.length > 0;
useStoredDefinitions([...new Map([...exportedDefinitions, ...storedDefinitions].map(d => [d.id, d])).values()]);
const storedReportProfiles = await reportProfileStore.activeProfiles();
const loadedReportProfiles = useStoredReportProfiles(storedReportProfiles);
const storedReportVisualSpecs = await reportVisualSpecStore.activeSpecs();
const loadedReportVisualSpecs = useStoredReportVisualSpecs(storedReportVisualSpecs);
phq9GraphDefinition = getDefinition(phq9Id);
if (!postgres) await definitionStore.initialize();

export default server;

// Imports by the Vercel adapter must not open a second listening socket.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`OpenMind assessments: http://127.0.0.1:${port}`);
    console.log(`Voice assessment: ${apiKey ? 'ready' : 'unavailable; on-screen assessment available'}`);
    console.log(postgres ? `PostgreSQL database: connected (schema ${postgres.schema})` : `Explicit SQLite test database: ${dbPath}`);
    console.log(`Assessment library: ${storedLibraryLoaded ? 'versioned database definitions' : fileLibraryLoaded ? 'exported JSON definitions' : 'legacy bundled definitions; run library:import to upgrade'}`);
    console.log(`Report profiles: ${loadedReportProfiles} versioned database profiles`);
    console.log(`Report visual specs: ${loadedReportVisualSpecs} versioned database specs`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function shutdown() {
  for (const client of wss.clients) client.close();
  for (const client of draftWss.clients) client.close();
  for (const client of definitionWss.clients) client.close();
  wss.close();
  draftWss.close();
  definitionWss.close();
  server.close(async () => {
    await definitionStore.close();
    await assessmentLibrary.close();
    await reportProfileStore.close();
    await reportVisualSpecStore.close();
    if (postgres) await postgres.close();
    else { store.close(); draftStore.close(); }
  });
}
