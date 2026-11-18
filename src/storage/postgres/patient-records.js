import { HttpError } from '../../workspace/errors.js';
import { parsePatientDocument, importPreview, matchesIdentity, importedPatient, manualPatient, withNote, historyRecord, baselineRecord, publicRecord } from '../../workspace/patient-records.js';

export function postgresPatientRecords({ pool, table, transaction }) {
  const patients = table('workspace_patients'), records = table('workspace_patient_records');
  async function get(client, id) {
    const row = (await client.query(`SELECT data FROM ${patients} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new HttpError(404, 'Patient not found.');
    return row.data;
  }
  async function insertRecord(client, row) {
    await client.query(`INSERT INTO ${records}(id,patient_id,version,created_at,content_hash,data) VALUES($1,$2,$3,$4,$5,$6)`,
      [row.id,row.patient_id,row.version,row.created_at,row.content_hash,JSON.stringify(row.data)]);
  }
  async function update(client, patient, row) {
    await insertRecord(client, row);
    await client.query(`UPDATE ${patients} SET data=$2 WHERE id=$1`, [patient.id,JSON.stringify(patient)]);
    return patient;
  }
  return {
    async backfill() {
      await transaction(async client => {
        const rows = (await client.query(`SELECT data FROM ${patients} ORDER BY id FOR UPDATE`)).rows;
        for (const { data } of rows) {
          const present = (await client.query(`SELECT 1 FROM ${records} WHERE patient_id=$1 LIMIT 1`, [data.id])).rowCount;
          if (!present) {
            const patient = { ...data, recordVersion: 1 };
            await update(client, patient, baselineRecord(patient));
          }
        }
      });
    },
    async createPatient(input) {
      const patient = manualPatient(input);
      return transaction(async client => {
        await client.query(`INSERT INTO ${patients}(id,data) VALUES($1,$2)`,[patient.id,JSON.stringify(patient)]);
        await insertRecord(client,historyRecord(patient,'manual'));
        return patient;
      });
    },
    async previewPatientImport(input) {
      const prepared = parsePatientDocument(input);
      const rows = (await pool.query(`SELECT data FROM ${patients}`)).rows;
      return importPreview(prepared,rows.map(row=>row.data));
    },
    async importPatient(input) {
      const prepared = parsePatientDocument(input);
      return transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${patients}:NeuroTwin:${prepared.parsed.externalId}`]);
        const matches = (await client.query(`SELECT data FROM ${patients} WHERE data->>'externalId'=$1`,[prepared.parsed.externalId])).rows.map(row=>row.data).filter(p=>matchesIdentity(p,prepared.parsed));
        if (matches.some(p=>p.id!==input.patientId)) throw new HttpError(409,'This external patient ID already exists. Choose the matching patient in the import preview.');
        const existing = input.patientId ? await get(client,input.patientId) : null;
        if (existing) {
          const duplicate=(await client.query(`SELECT id FROM ${records} WHERE patient_id=$1 AND content_hash=$2`,[existing.id,prepared.contentHash])).rows[0];
          if (duplicate) return { patient: existing, duplicate: true, recordId: duplicate.id };
        }
        const patient=importedPatient(prepared,existing,input);
        const record=historyRecord(patient,'json_import',{document:prepared.document,fileName:prepared.fileName,contentHash:prepared.contentHash});
        if (!existing) await client.query(`INSERT INTO ${patients}(id,data) VALUES($1,$2)`,[patient.id,JSON.stringify(patient)]);
        await update(client,patient,record);
        return { patient, duplicate: false, recordId: record.id };
      });
    },
    async addPatientNote(id,input) {
      return transaction(async client => {
        const patient=withNote(await get(client,id),input);
        return update(client,patient,historyRecord(patient,'manual',{summary:input.summary.trim()}));
      });
    },
    async patientRecords(id) {
      if (!(await pool.query(`SELECT 1 FROM ${patients} WHERE id=$1`,[id])).rowCount) throw new HttpError(404,'Patient not found.');
      return (await pool.query(`SELECT id,patient_id,version,created_at,data - 'document' AS data, data->'document' IS NOT NULL AND data->'document' <> 'null'::jsonb AS has_document FROM ${records} WHERE patient_id=$1 ORDER BY version DESC`,[id])).rows.map(row=>({...publicRecord(row),hasDocument:row.has_document}));
    },
    async patientRecord(id,recordId) {
      const row=(await pool.query(`SELECT * FROM ${records} WHERE patient_id=$1 AND id=$2`,[id,recordId])).rows[0];
      if(!row)throw new HttpError(404,'Patient record not found.');
      return publicRecord(row,true);
    },
  };
}
