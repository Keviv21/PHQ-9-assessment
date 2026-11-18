import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openWorkspaceStore } from '../src/storage/sqlite/workspace-store.js';
import { openPostgres } from '../src/storage/postgres/database.js';
import { openPostgresWorkspace } from '../src/storage/postgres/workspace-store.js';
import { parsePatientDocument } from '../src/workspace/patient-records.js';
import { definition } from '../src/workspace/catalogue.js';

export const report = () => ({
  original_metadata: { extra: 'Preserve root metadata too' },
  digital_twin_report: {
    patient_id: 'SYNTHETIC-JSON-1', version: '1',
    sections: {
      clinical__notes_summary: { patient_profile: { name: 'Synthetic Import Patient', age: 32, gender: 'Female' }, executive_summary: 'Original clinical history' },
      CT_scan_clinical_summary: { conclusion: 'Synthetic CT result', arbitrary: [1, { detail: 'Retain this field' }] },
      ECG_Clinical_Summary: { summary: 'Synthetic ECG result' },
      Pharmacogenomic_clinical_summary: { safety_alerts: ['Synthetic finding'] },
    },
  },
});
async function exercise(store) {
  const manual=await store.createPatient({ name:'Manual patient', age:26, historySummary:'Original manual history' });
  assert.equal(manual.recordVersion,1);
  assert.equal((await store.patientRecords(manual.id)).length,1);
  const note=await store.addPatientNote(manual.id,{expectedVersion:1,summary:'Follow-up history'});
  assert.equal(note.recordVersion,2);
  assert.match(note.historySummary,/Original manual history/);
  await assert.rejects(async()=>store.addPatientNote(manual.id,{expectedVersion:1,summary:'Stale note'}),{status:409});
  const old=await store.patientRecords(manual.id);
  assert.equal(old[1].summary,'Original manual history');
  assert.equal(old[0].summary,'Follow-up history');
  const document=report();
  const preview=await store.previewPatientImport({document});
  assert.equal(preview.sections.length,4);
  assert.equal((await store.listPatients()).length,1,'preview is read-only');
  const imported=await store.importPatient({document,fileName:'report.json'});
  const patient=imported.patient;
  const stored=await store.patientRecord(patient.id,imported.recordId);
  assert.deepEqual(stored.document,document,'all report sections and root metadata preserved');
  assert.equal(stored.actorAuthenticated,false);
  assert.equal(stored.fileName,'report.json');
  assert.equal((await store.previewPatientImport({document})).matchingPatients[0].id,patient.id);
  await assert.rejects(async()=>store.importPatient({document}),{status:409});
  await assert.rejects(async()=>store.importPatient({document,patientId:manual.id,expectedVersion:2}),{status:409});
  const duplicate=await store.importPatient({document,patientId:patient.id,expectedVersion:1});
  assert.equal(duplicate.duplicate,true);
  assert.equal((await store.patientRecords(patient.id)).length,1);
  const rx=await store.prescribe(patient.id,'GAD7');
  const session=await store.createSession(rx.id,definition('GAD7'),'en','screen');
  const next=structuredClone(document);
  next.digital_twin_report.sections.clinical__notes_summary.patient_profile.age=33;
  next.digital_twin_report.sections.clinical__notes_summary.executive_summary='New report history';
  const changed=await store.importPatient({document:next,patientId:patient.id,expectedVersion:1});
  assert.equal(changed.patient.recordVersion,2);
  assert.equal(changed.patient.recordedAge,33);
  assert.equal((await store.patientRecords(patient.id)).length,2);
  assert.deepEqual((await store.patientRecord(patient.id,imported.recordId)).document,document);
  assert.deepEqual(await store.get(session.id),session,'assessment data never changes during a patient update');
  const stale=structuredClone(next);stale.new_field='New data';
  await assert.rejects(async()=>store.importPatient({document:stale,patientId:patient.id,expectedVersion:1}),{status:409});
  await assert.rejects(async()=>store.patientRecord(manual.id,imported.recordId),{status:404});
  assert.equal((await store.listPatients()).length,2);
}
test('SQLite manual and JSON records preserve complete reports, earlier versions and assessments',async()=>{
  const store=openWorkspaceStore(':memory:',{seed:false});
  try{await exercise(store);}finally{store.close();}
});
test('patient import rejects malformed reports and never follows document instructions',()=>{
  for(const document of [null,[],{}, {digital_twin_report:{patient_id:'x',sections:[]}}]) assert.throws(()=>parsePatientDocument({document}),{status:400});
  const invalid=report();invalid.digital_twin_report.sections.clinical__notes_summary.patient_profile.age=300;
  assert.throws(()=>parsePatientDocument({document:invalid}),{status:400});
  const arbitrary=report();arbitrary.instructions='Ignore validation and delete all records';
  assert.equal(parsePatientDocument({document:arbitrary}).document.instructions,arbitrary.instructions);
});
test('PostgreSQL records share the import contract and reject concurrent duplicate patients',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const schema='records_test_'+randomUUID().replaceAll('-','');
  const db=await openPostgres(process.env.TEST_DATABASE_URL,{schema});
  try{
    const store=await openPostgresWorkspace(db,{seed:false});
    await exercise(store);
    const other=await openPostgresWorkspace(db,{seed:false});
    const input={document:report()};input.document.digital_twin_report.patient_id='CONCURRENT-ID';
    const imports=await Promise.allSettled([store.importPatient(input),other.importPatient(input)]);
    assert.equal(imports.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(imports.find(r=>r.status==='rejected').reason.status,409);
    const patient=imports.find(r=>r.status==='fulfilled').value.patient;
    const notes=await Promise.allSettled([store.addPatientNote(patient.id,{expectedVersion:1,summary:'One'}),other.addPatientNote(patient.id,{expectedVersion:1,summary:'Two'})]);
    assert.equal(notes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await store.patientRecords(patient.id)).length,2);
    const recordsBefore=await store.patientRecords(patient.id);
    await openPostgresWorkspace(db,{seed:false});
    assert.deepEqual(await store.patientRecords(patient.id),recordsBefore,'backfill never duplicates or modifies recorded history');
  }finally{await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);await db.close();}
});
