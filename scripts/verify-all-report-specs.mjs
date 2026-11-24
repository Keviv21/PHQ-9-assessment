// Pure offline validation of the locally prepared review bundle.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {scoringRuntimeHash} from '../src/assessment-content.js';
import {scoreDefinition} from '../src/definition-scoring.js';
import {analysisVisualData} from '../src/analysis-report.js';
import {normalPercentile} from '../src/report-statistics.js';
const dir=resolve(process.argv[2]||'local-data/assessment-reports-all');
const bundle=JSON.parse(await readFile(join(dir,'assessment-library.json'),'utf8'));
const {records}=bundle;
assert.equal(new Set(records.map(d=>d.id)).size,records.length);
for(const folder of ['definitions','report-configs','comparison','evidence','reports'])assert.equal((await readdir(join(dir,folder))).length,records.length,folder);
let matched=0,differences=0;
for(const d of records){
 const p=d.reporting.analysisProfile;
 assert.equal(p.scoringHash,scoringRuntimeHash(d),d.id);
 assert.equal(p.clinicalApproved,false);
 const calculated=scoreDefinition(d,p.sampleAnswers,p.sampleContext,{draftScores:true});
 for(const c of p.sourceReport.sampleComparison.comparisons){
  assert.equal(calculated.metrics.find(m=>m.id===c.metricId).value,c.actual,`${d.id}/${c.metricId}`);
  if(c.status==='matched')matched++;
  if(c.status==='difference_requires_review'){
   differences++;
   assert.equal(analysisVisualData(d,calculated.metrics).metrics.find(m=>m.id===c.metricId).value,null,'Unresolved result must remain withheld in report');
  }
 }
 for(const chart of p.sourceReport.graphs)for(const id of chart.metricIds)assert.ok(p.metrics.some(m=>m.id===id),`${d.id}: missing chart metric ${id}`);
 for(const m of analysisVisualData(d,scoreDefinition(d,{}, {}, {draftScores:true}).metrics).metrics){assert.equal(m.value,null,'Missing answers must not become zero');assert.equal(m.percentile,null);for(const n of m.normalPercentiles)assert.equal(n.value,null);}
}
assert.equal(matched,bundle.manifest.matchedMetrics);
// Independent explicit source item memberships catch truncated lists and inherited mean multipliers.
const find=t=>records.find(d=>d.title.includes(t));
const items=(d,id)=>d.rules.find(r=>r.id===id).item_ids;
assert.deepEqual(items(find('Herth Hope'),'report_sense_of_temporality_and_future'),['Q1','Q2','Q6','Q11']);
assert.equal(find('(VQ)').rules.filter(r=>r.id==='report_obstruction').length,0,'Do not create a duplicate truncated subscale');
const aggression=find('IBR-MOAS').rules.find(r=>r.id==='report_verbal_aggression_towards_others');
assert.equal(aggression.multiplier,1);assert.equal(aggression.maximum,12);
assert.deepEqual(items(find('(PCL-5)'),'report_negative_alterations_in_cognition_and_mood'),['Q8','Q9','Q10','Q11','Q12','Q13','Q14']);
const examples=[['(AQ)',{pdf_1:35,report_social_skill:9,report_attention_switching:7,report_attention_to_detail:7,report_communication:9,report_imagination:3}],['(ESQ-R)',{pdf_1:30,report_plan_management:16,report_time_management:5,report_organization:4,report_emotional_regulation:2,report_behavioral_regulation:3}],['(CATI)',{pdf_1:146,report_social_interactions:31,report_communication:21,report_social_camouflage:24,report_self_regulatory_behaviours:24,report_cognitive_flexibility:29,report_sensory_sensitivity:17}],['(MENO-D)',{pdf_1:27,report_self:2,report_sexual:2,report_somatic:2.5,report_cognitive:2.5,report_sleep:2.5}],['(PCL-5)',{total_raw:32,report_re_experiencing:12,report_avoidance:5,report_negative_alterations_in_cognition_and_mood:8,report_hyper_arousal:7}],['(FAS)',{pdf_1:29}]];
for(const [title,expected]of examples){const d=find(title),p=d.reporting.analysisProfile,scored=scoreDefinition(d,p.sampleAnswers,p.sampleContext,{draftScores:true});for(const [id,value]of Object.entries(expected))assert.equal(scored.metrics.find(m=>m.id===id)?.value,value,`${title}/${id}`);}
assert.ok(Math.abs(normalPercentile(0,{method:'normal_cdf',mean:0,sd:1})-50)<.00001);
assert.ok(Math.abs(normalPercentile(1.9599639845,{method:'normal_cdf',mean:0,sd:1})-97.5)<.0001);
assert.equal(normalPercentile(null,{method:'normal_cdf',mean:0,sd:1}),null);
assert.equal(normalPercentile(1,{method:'normal_cdf',mean:0,sd:0}),null);
assert.equal(normalPercentile(1,{mean:0,sd:1}),null);
const result={status:'passed',definitions:records.length,matchedScoreChecks:matched,withheldConflictingMetrics:differences,sharedDatabaseAccess:'none'};
await writeFile(join(dir,'validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
