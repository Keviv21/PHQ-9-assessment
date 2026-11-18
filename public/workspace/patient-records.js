import { $, el, api, date } from '../shared/api.js';

export function setupPatientRecords({ onSaved }) {
  let prepared = null, target = null, notePatient = null, previewVersion = 0;
  const importDialog = $('patient-import-dialog'), noteDialog = $('patient-note-dialog');
  function resetPreview() {
    previewVersion++;
    prepared = null;
    target = null;
    $('patient-import-preview').hidden = true;
    $('save-patient-import').disabled = true;
    $('patient-import-error').textContent = '';
  }
  $('import-patient').onclick = () => {
    $('patient-import-form').reset();
    resetPreview();
    importDialog.showModal();
  };
  $('close-patient-import').onclick = () => { resetPreview(); importDialog.close(); };
  importDialog.addEventListener('cancel', resetPreview);
  $('patient-import-file').onchange = resetPreview;
  async function chooseTarget() {
    const id = $('patient-import-target').value;
    const version = ++previewVersion;
    target = null;
    $('save-patient-import').disabled = true;
    $('patient-import-target-info').textContent = id ? 'Loading current patient details…' : 'A new patient will be created.';
    try {
      const current = id ? await api(`patients/${encodeURIComponent(id)}`) : null;
      if (version !== previewVersion || !prepared) return;
      target = current;
      if (current) $('patient-import-target-info').textContent = `Current record: ${current.name} · ${current.recordedAge ?? 'Age not recorded'} · ${current.gender || 'Gender not recorded'}. This import adds a new version.`;
      $('save-patient-import').disabled = false;
    } catch (error) { if (version === previewVersion) $('patient-import-error').textContent = error.message; }
  }
  $('patient-import-target').onchange = chooseTarget;
  $('preview-patient-import').onclick = async () => {
    resetPreview();
    const version = previewVersion;
    const file = $('patient-import-file').files[0];
    if (!file) { $('patient-import-error').textContent = 'Choose a JSON report first.'; return; }
    if (file.size > 2 * 1024 * 1024) { $('patient-import-error').textContent = 'Choose a report up to 2 MB.'; return; }
    $('preview-patient-import').disabled = true;
    try {
      let document;
      try { document = JSON.parse(await file.text()); }
      catch { throw new Error('This file is not valid JSON.'); }
      const input = { document, fileName: file.name };
      const preview = await api('patient-imports/preview', { method: 'POST', body: JSON.stringify(input) });
      const patients = await api('patients');
      if (version !== previewVersion) return;
      prepared = input;
      const details = $('patient-import-details');
      const p = preview.profile;
      details.replaceChildren(el('h3', p.name), el('p', `Patient ID: ${p.externalId} · ${p.recordedAge ?? 'Age not recorded'} · ${p.gender}`),
        el('p', `All ${preview.sections.length} report sections will be preserved: ${preview.sections.map(s => s.replaceAll('_', ' ')).join(', ')}.`));
      const summary = el('details');
      summary.append(el('summary', 'Preview current history summary'));
      summary.append(el('pre', p.historySummary, 'source-record'));
      details.append(summary);
      const select = $('patient-import-target');
      select.replaceChildren(new Option('Create a new patient', ''));
      for (const patient of patients) select.add(new Option(`${patient.name} (${patient.externalId || patient.id})`, patient.id));
      if (preview.matchingPatients.length) {
        select.options[0].disabled = true;
        select.value = preview.matchingPatients[0].id;
        details.append(el('p', 'This report’s patient ID already exists. Add the report to the matching patient.'));
      }
      $('patient-import-preview').hidden = false;
      await chooseTarget();
    } catch (error) {
      if (version === previewVersion) $('patient-import-error').textContent = error.message;
    } finally { $('preview-patient-import').disabled = false; }
  };
  $('patient-import-form').onsubmit = async event => {
    event.preventDefault();
    if (!prepared || $('save-patient-import').disabled) return;
    $('save-patient-import').disabled = true;
    $('patient-import-error').textContent = '';
    const input = { ...prepared, patientId: target?.id || null, expectedVersion: target?.recordVersion };
    const controls = [...event.target.querySelectorAll('input,select,button')];
    controls.forEach(control => control.disabled = true);
    try {
      const result = await api('patient-imports', { method: 'POST', body: JSON.stringify(input) });
      importDialog.close();
      resetPreview();
      await onSaved(result.patient);
    } catch (error) {
      $('patient-import-error').textContent = `${error.message} Preview the report again before retrying.`;
      prepared = null;
    } finally {
      controls.forEach(control => control.disabled = false);
      $('save-patient-import').disabled = true;
    }
  };
  $('close-patient-note').onclick = () => noteDialog.close();
  $('patient-note-form').onsubmit = async event => {
    event.preventDefault();
    if (!notePatient) return;
    const button = event.submitter;
    button.disabled = true;
    $('patient-note-error').textContent = '';
    try {
      const saved = await api(`patients/${encodeURIComponent(notePatient.id)}/records`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: notePatient.recordVersion, summary: $('patient-note-summary').value }),
      });
      noteDialog.close();
      notePatient = null;
      await onSaved(saved);
    } catch (error) { $('patient-note-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  return {
    render(box, patient) {
      const note = el('button', 'Add clinical history', 'button outline');
      note.type = 'button';
      note.onclick = () => {
        notePatient = patient;
        $('patient-note-form').reset();
        $('patient-note-name').textContent = patient.name;
        $('patient-note-error').textContent = '';
        noteDialog.showModal();
      };
      const history = el('details', undefined, 'patient-history');
      history.append(el('summary', 'Record history'));
      const entries = el('div');
      history.append(el('p', 'Earlier history and complete imported reports are preserved here. The current summary above is an excerpt.'), entries);
      let loaded = false;
      history.ontoggle = async () => {
        if (!history.open || loaded) return;
        loaded = true;
        entries.replaceChildren(el('p', 'Loading records…'));
        try {
          const records = await api(`patients/${encodeURIComponent(patient.id)}/records`);
          entries.replaceChildren();
          for (const record of records) {
            const item = el('details');
            const labels = { baseline: 'Previously saved profile', manual: 'Clinical history entry', json_import: 'JSON report import' };
            item.append(el('summary', `Version ${record.version} · ${labels[record.type] || record.type} · ${date(record.createdAt)}`));
            item.append(el('p', 'Recorded locally · author not verified'));
            if (record.fileName) item.append(el('p', `Source: ${record.fileName}`));
            item.append(el('pre', record.summary, 'source-record'));
            const demographics = el('pre', JSON.stringify(record.profile, null, 2), 'source-record');
            const profile = el('details');profile.append(el('summary', 'Patient details at this version'),demographics);item.append(profile);
            if (record.hasDocument) {
              const open = el('button', 'View complete saved JSON', 'button outline');
              open.type = 'button';
              open.onclick = async () => {
                open.disabled = true;
                try {
                  const full = await api(`patients/${encodeURIComponent(patient.id)}/records/${encodeURIComponent(record.id)}`);
                  const text = JSON.stringify(full.document, null, 2);
                  const view = el('pre', text, 'source-record');
                  const download = el('button', 'Download saved JSON', 'button outline');download.type='button';
                  download.onclick = () => {
                    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
                    const a=document.createElement('a');a.href=url;a.download=`patient-report-v${record.version}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
                  };
                  open.replaceWith(download,view);
                } catch(error) {open.disabled=false;open.textContent=`Retry loading JSON: ${error.message}`;}
              };
              item.append(open);
            }
            entries.append(item);
          }
        } catch(error) {loaded=false;entries.replaceChildren(el('p',error.message));}
      };
      const historyButton = el('button', 'Record history', 'button outline');
      historyButton.type = 'button';
      historyButton.onclick = () => {
        $('patient-records-name').textContent = patient.name;
        $('patient-records-content').replaceChildren(history);
        history.firstElementChild.textContent = 'Saved entries';
        $('patient-records-dialog').showModal();
        history.open = true;
      };
      box.append(note,historyButton);
    },
  };
}
