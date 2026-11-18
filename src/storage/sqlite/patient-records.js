import { HttpError } from '../../workspace/errors.js';
import { parsePatientDocument, importPreview, matchesIdentity, importedPatient, manualPatient, withNote, historyRecord, baselineRecord, publicRecord } from '../../workspace/patient-records.js';

export function sqlitePatientRecords(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_patient_records(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES workspace_patients(id),version INTEGER NOT NULL,created_at TEXT NOT NULL,content_hash TEXT,data TEXT NOT NULL,UNIQUE(patient_id,version),UNIQUE(patient_id,content_hash));`);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {const result=work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
  }
  function get(id) {
    const row=db.prepare('SELECT data FROM workspace_patients WHERE id=?').get(id);
    if(!row)throw new HttpError(404,'Patient not found.');
    return JSON.parse(row.data);
  }
  function all() {return db.prepare('SELECT data FROM workspace_patients').all().map(row=>JSON.parse(row.data));}
  function insert(row) {
    db.prepare('INSERT INTO workspace_patient_records(id,patient_id,version,created_at,content_hash,data) VALUES(?,?,?,?,?,?)').run(row.id,row.patient_id,row.version,row.created_at,row.content_hash,JSON.stringify(row.data));
  }
  function update(patient,row) {
    insert(row);db.prepare('UPDATE workspace_patients SET data=? WHERE id=?').run(JSON.stringify(patient),patient.id);return patient;
  }
  return {
    backfill() {transaction(()=>{for(const data of all())if(!db.prepare('SELECT 1 FROM workspace_patient_records WHERE patient_id=? LIMIT 1').get(data.id)) {const patient={...data,recordVersion:1};update(patient,baselineRecord(patient));}});},
    createPatient(input) {const patient=manualPatient(input);return transaction(()=>{db.prepare('INSERT INTO workspace_patients VALUES(?,?)').run(patient.id,JSON.stringify(patient));insert(historyRecord(patient,'manual'));return patient;});},
    previewPatientImport(input) {return importPreview(parsePatientDocument(input),all());},
    importPatient(input) {
      const prepared=parsePatientDocument(input);
      return transaction(()=>{
        if(all().some(p=>matchesIdentity(p,prepared.parsed)&&p.id!==input.patientId))throw new HttpError(409,'This external patient ID already exists. Choose the matching patient in the import preview.');
        const existing=input.patientId?get(input.patientId):null;
        if(existing){const duplicate=db.prepare('SELECT id FROM workspace_patient_records WHERE patient_id=? AND content_hash=?').get(existing.id,prepared.contentHash);if(duplicate)return {patient:existing,duplicate:true,recordId:duplicate.id};}
        const patient=importedPatient(prepared,existing,input);
        const row=historyRecord(patient,'json_import',{document:prepared.document,fileName:prepared.fileName,contentHash:prepared.contentHash});
        if(!existing)db.prepare('INSERT INTO workspace_patients VALUES(?,?)').run(patient.id,JSON.stringify(patient));
        update(patient,row);return {patient,duplicate:false,recordId:row.id};
      });
    },
    addPatientNote(id,input) {return transaction(()=>{const patient=withNote(get(id),input);return update(patient,historyRecord(patient,'manual',{summary:input.summary.trim()}));});},
    patientRecords(id) {get(id);return db.prepare('SELECT * FROM workspace_patient_records WHERE patient_id=? ORDER BY version DESC').all(id).map(row=>publicRecord({...row,data:JSON.parse(row.data)}));},
    patientRecord(id,recordId) {const row=db.prepare('SELECT * FROM workspace_patient_records WHERE patient_id=? AND id=?').get(id,recordId);if(!row)throw new HttpError(404,'Patient record not found.');return publicRecord({...row,data:JSON.parse(row.data)},true);},
  };
}
