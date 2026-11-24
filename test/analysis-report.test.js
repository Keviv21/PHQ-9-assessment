import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {compileAnalysisProfile,validBands} from '../src/analysis-profile-compiler.js';
import {scoreDefinition,conditionState} from '../src/definition-scoring.js';
import {analysisVisualData} from '../src/analysis-report.js';
import {buildDefinitionReport,definitionReportHtml} from '../src/definition-report.js';
import {analysisPreviewReport} from '../src/analysis-preview.js';
import {sampleAnswers} from '../src/assessment-review.js';
import {contentHash} from '../src/assessment-content.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const baseline=read('../data/assessment-library.json'),asrs=read('../data/report-profiles/asrs.json'),phq=read('../data/report-profiles/phq9-source.json');
const prepared=process.env.ASSESSMENT_TEST_LIBRARY?JSON.parse(readFileSync(process.env.ASSESSMENT_TEST_LIBRARY,'utf8')):null;
const records=prepared?.records||baseline.records.map(d=>{const c=compileAnalysisProfile(d,asrs,phq);c.versionId=contentHash(c);return c;});
const asrsDef=records.find(d=>d.id===asrs.assessmentId);
const answers=values=>Object.fromEntries(asrsDef.questions.map((q,i)=>[q.id,q.options.find(o=>o.printed_value===values[i]).id]));
test('ASRS published example: raw sums, binary domains and exact percentile lookups agree',()=>{
  const report=analysisPreviewReport(asrsDef);
  assert.deepEqual(Object.fromEntries(report.metrics.map(m=>[m.id,m.value])),{part_a_raw:14,part_b_raw:27,total_raw:41,inattentive_count:8,motor_count:1,verbal_count:2,hyperactive_impulsive_count:3,endorsed_total:11});
  assert.deepEqual(report.analysis.metrics.slice(0,3).map(m=>m.percentile),[80,79,82]);
  assert.deepEqual(report.analysis.metrics.slice(0,3).map(m=>m.band),['High','High','High']);
  const html=definitionReportHtml(report);
  for(const value of ['61%','89%','33%'])assert.ok(html.includes(value));
  assert.equal((html.match(/data-chart=/g)||[]).length,2);
  assert.doesNotMatch(html,/<script|<iframe/i);
  if(!prepared)assert.doesNotMatch(html,/novopsych|https?:/i);
});
test('ASRS endorsement boundaries are item-specific; blank norms and missing answers stay unavailable',()=>{
  const thresholds=[2,2,2,3,3,3,3,3,2,3,3,2,3,3,3,2,3,2];
  for(const [offset,expected]of [[-1,0],[0,18]]){
    const scores=scoreDefinition(asrsDef,answers(thresholds.map(v=>v+offset)),{}, {draftScores:true});
    assert.equal(scores.metrics.find(m=>m.id==='endorsed_total').value,expected);
  }
  for(const value of [0,4]){
    const scores=scoreDefinition(asrsDef,answers(Array(18).fill(value)),{}, {draftScores:true});
    const v=analysisVisualData(asrsDef,scores.metrics);
    assert.equal(v.metrics.find(m=>m.id==='total_raw').percentile,null);
  }
  const a=answers(asrs.sample.responseValues);delete a.Q1;
  const scores=scoreDefinition(asrsDef,a,{}, {draftScores:true});
  const v=analysisVisualData(asrsDef,scores.metrics);
  assert.equal(v.metrics.find(m=>m.id==='total_raw').value,null);
  assert.equal(v.metrics.find(m=>m.id==='total_raw').percentile,null);
  const stale=structuredClone(asrsDef);stale.rules[0].maximum=99;
  assert.equal(analysisVisualData(stale,scores.metrics),null);
});
test('PHQ-9 uses archived 2013 lookup and only the two intended single-visit graphs',()=>{
  const d=records.find(d=>d.id===phq.assessmentId),report=analysisPreviewReport(d);
  const values=[2,3,2,2,1,2,3,2,0],a=Object.fromEntries(d.questions.map((q,i)=>[q.id,q.options.find(o=>o.printed_value===values[i]).id]));
  const metrics=scoreDefinition(d,a,{}, {draftScores:true}).metrics;
  assert.equal(metrics[0].value,17);
  assert.equal(analysisVisualData(d,metrics).metrics[0].percentile,99);
  assert.equal(d.reporting.analysisProfile.metrics[0].lookup[7],87);
  const html=definitionReportHtml(report);
  assert.equal((html.match(/data-chart=/g)||[]).length,2);
  assert.doesNotMatch(html,/German community|item_profile|community_cumulative/);
});
test('band compiler rejects overlapping/incomplete ranges and all source benchmarks remain correct',()=>{
  assert.equal(validBands([{minimum:0,maximum:4},{minimum:4,maximum:9}],0,9),false);
  assert.equal(validBands([{minimum:0,maximum:3},{minimum:5,maximum:9}],0,9),false);
  const fixtures=read('./fixtures/scoring-benchmarks.json');
  for(const f of fixtures.assessments){const d=records.find(d=>d.id===f.assessment_id);for(const c of f.cases){const result=scoreDefinition(d,c.answers,c.context||{}, {draftScores:true});for(const[id,expected]of Object.entries(c.expected_scores))assert.equal(result.metrics.find(m=>m.id===id)?.value,c.kind==='known_source_gap'?null:expected,`${d.id}/${c.id}/${id}`);}}
});
test('hidden conditional parents suppress their descendants, unresolved and cyclic parents stay unknown',()=>{
  const qs=[{id:'A'},{id:'B',displayIf:{item_id:'A',operator:'equals',value:'yes'}},{id:'C',displayIf:{item_id:'B',operator:'equals',value:'yes'}}];
  assert.equal(conditionState(qs[2].displayIf,{A:'no'},qs),false);
  assert.equal(conditionState(qs[2].displayIf,{},qs),null);
  assert.equal(conditionState(qs[2].displayIf,{A:'yes',B:'yes'},qs),true);
  assert.equal(conditionState(qs[2].displayIf,{A:'no',B:'yes'},qs),false);
  qs[0].displayIf={item_id:'C',operator:'equals',value:'yes'};
  assert.equal(conditionState(qs[2].displayIf,{A:'yes',B:'yes',C:'yes'},qs),null);
});
test('actual dev API completes two visits for all 185 available definitions and uses source-configured reports', {timeout:120000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'analysis-api-')),port=49000+Math.floor(Math.random()*900),base=`http://127.0.0.1:${port}`;
  const file=join(dir,'library.json');await writeFile(file,JSON.stringify({...baseline,records}));
  const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'',ALLOW_SQLITE_TEST_BACKEND:'true',DB_PATH:join(dir,'test.sqlite'),PORT:String(port),GEMINI_API_KEY:'',ASSESSMENT_LIBRARY_FILE:file,ASSESSMENT_DRAFT_SCORES:'true',ASSESSMENT_ANALYSIS_PREVIEW:'true'}});
  let log='';child.stdout.on('data',c=>{log+=c;});child.stderr.on('data',c=>{log+=c;});
  const api=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.json();};
  try{
    let ready=false;for(let i=0;i<150;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,log);
    assert.equal((await api('/api/definitions')).length,186);
    assert.equal((await api('/preview/phq9-report.json')).analysis.metrics[0].percentile,87);
    for(const d of records){
      const preview=await api(`/preview/analysis/${d.id}.json`);assert.equal(preview.analysis.assessmentId,d.id);
      if(!d.questions.length)continue;
      let last;
      for(const variant of ['first','last']){
        const pres=await api('/api/definition-patients/demo-a/prescriptions',{formId:d.id});
        const state=await api(`/api/definition-prescriptions/${pres.id}/start`,{});
        last=await api(`/api/definition-sessions/${state.id}/finish`,sampleAnswers(d,variant));
      }
      const report=await api(`/api/definition-sessions/${last.id}/report.json`);
      assert.equal(report.visits.length,2,d.id);assert.equal(report.analysis.assessmentId,d.id);
      const html=await(await fetch(base+`/api/definition-sessions/${last.id}/report.html`)).text();
      assert.doesNotMatch(html,/novopsych|\bNaN\b|\bInfinity\b/i,d.id);
      if(d.id===asrs.assessmentId)assert.ok(html.includes('data-chart="endorsed-symptoms"'));
    }
    assert.equal((await api('/api/demo-patients/demo-a/analytics')).totalCompleted,370);
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(dir,{recursive:true,force:true});}
});
