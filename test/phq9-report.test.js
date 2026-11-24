import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phq9Id } from '../src/report-profiles.js';
import { phq9VisualData, adaptLegacyPhq9, phq9PreviewStates } from '../src/phq9-report.js';
import { buildDefinitionReport, definitionReportHtml } from '../src/definition-report.js';
const d=JSON.parse(readFileSync(new URL('../data/assessment-library.json',import.meta.url))).records.find(d=>d.id===phq9Id);

test('PHQ-9 charts retain exact boundaries and explicitly missing/censored reference values',()=>{
  for(let score=0;score<=27;score++){
    const data=phq9VisualData(d,[{id:'total_raw',value:score,points:[]}],{});
    assert.equal(data.band,['Minimal','Mild','Moderate','Moderately severe','Severe'][score<5?0:score<10?1:score<15?2:score<20?3:4]);
  }
  const visual=score=>phq9VisualData(d,[{id:'total_raw',value:score,points:[]}],{});
  assert.equal(visual(0).referenceValue,41);assert.equal(visual(7).referenceValue,89.4);
  assert.equal(visual(24).referenceValue,null);assert.equal(visual(27).referenceValue,'>99.9');
  for(const invalid of [null,-1,28,7.5])assert.equal(visual(invalid).total,null);
  for(const group of d.reporting.visualProfile.referenceGroups)assert.equal(group.counts.reduce((a,b)=>a+b,0),group.n);
});
test('PHQ-9 report uses saved scores, renders five charts and escapes text',()=>{
  const visits=phq9PreviewStates(d),state=visits.at(-1);state.scores.metrics[0].value=8;
  const report=buildDefinitionReport(state,visits.slice(0,-1));report.patient='<script>attack()</script>';
  const html=definitionReportHtml(report);
  assert.equal(report.phq9.total,8,'saved total is not recalculated from responses');
  assert.equal((html.match(/data-chart=/g)||[]).length,5);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|novopsych|https?:\/\//i);
  assert.match(html,/89\.4|92\.1/);assert.match(html,/Kliem/);
  assert.equal(report.phq9.points.length,3);
});
test('presentation-only upgrades preserve compatible PHQ-9 history and do not change snapshots',()=>{
  const visits=phq9PreviewStates(d),old=structuredClone(visits[0]);
  delete old.formSnapshot.reporting.visualProfile;old.formSnapshot.versionId='previous-report-version';
  const before=JSON.stringify(old),report=buildDefinitionReport(visits[2],[old]);
  assert.equal(report.phq9.points.length,2);assert.equal(JSON.stringify(old),before);
  const changed=structuredClone(old);changed.formSnapshot.questions[0].text='Different question';
  assert.equal(buildDefinitionReport(visits[2],[changed]).phq9.points.length,1);
  assert.equal(phq9VisualData(changed.formSnapshot,changed.scores.metrics,changed.answers),null);
});
test('legacy PHQ-9 adapter preserves total and rejects incomplete or incompatible answers',()=>{
  const state={id:'saved',formId:'phq9',formVersion:'v1-prototype',language:'en',status:'completed',answers:Array.from({length:9},(_,i)=>({number:i+1,value:1})),scores:{rawTotal:9}};
  const before=JSON.stringify(state),adapted=adaptLegacyPhq9(state,d);
  assert.equal(adapted.scores.metrics[0].value,9);assert.equal(Object.keys(adapted.answers).length,9);assert.equal(JSON.stringify(state),before);
  assert.throws(()=>adaptLegacyPhq9({...state,answers:state.answers.slice(1)},d));
  assert.throws(()=>adaptLegacyPhq9({...state,language:'hi'},d));
});
