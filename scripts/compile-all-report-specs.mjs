// Offline only: combine archived evidence, source-explicit subscales and comparison results.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {contentHash,scoringRuntimeHash,displayText} from '../src/assessment-content.js';
import {analysisPreviewReport} from '../src/analysis-preview.js';
import {definitionReportHtml} from '../src/definition-report.js';
import {normalPercentile} from '../src/report-statistics.js';
import {compileAnalysisProfile} from '../src/analysis-profile-compiler.js';
import {scoreDefinition} from '../src/definition-scoring.js';
const root=resolve(new URL('..',import.meta.url).pathname),evidenceDir=resolve(process.argv[2]||join(root,'local-data/assessment-reports-all/evidence')),out=resolve(process.argv[3]||join(root,'local-data/assessment-reports-rebuilt'));
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const baseline=await read(join(root,'data/assessment-library.json'));
const asrs=await read(join(root,'data/report-profiles/asrs.json')),phq=await read(join(root,'data/report-profiles/phq9-source.json'));
const overrides=await read(join(root,'data/report-profiles/source-report-overrides.json'));
const normalize=s=>String(s).toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\b(raw|score|scores|scale|subscale|symptoms|total|average|mean|secondary)\b/g,' ').trim().replace(/\s+/g,' ');
const slug=s=>normalize(s).replaceAll(' ','_');
function parseItems(s){
 s=s.replace(/\bto\b/gi,'-');
 if(!/^[\d\s,–—\-and]+$/i.test(s.trim()))return null;
 const numbers=[];for(const piece of s.replace(/\band\b/g,',').split(',')){const p=piece.trim();if(!p)continue;const m=/^(\d+)\s*[-–—]\s*(\d+)$/.exec(p);if(m){if(+m[2]<+m[1]||+m[2]>200)return null;for(let i=+m[1];i<=+m[2];i++)numbers.push(i);}else if(/^\d+$/.test(p))numbers.push(+p);else return null;}return numbers.length&&new Set(numbers).size===numbers.length?numbers:null;
}
function matchingRow(label,rows,definition){
 const normalized=normalize(label);let exact=rows.filter(r=>normalize(r.label)===normalized);
 if(exact.length===1)return exact[0];
 const aliases=overrides.find(o=>o.assessmentId===definition.id)?.rowAliases||{};
 if(aliases[label])return rows.find(r=>r.label===aliases[label])||null;
 if(/\btotal\b/i.test(label)&&! /endorsed|count|symptom/i.test(label)){
  const totals=rows.filter(r=>/\btotal\b/i.test(r.label));if(totals.length===1)return totals[0];
 }
 // Single-rule total labels often use an acronym, e.g. "DAR-5 Total".
 if(definition.rules.length===1&&rows.length===1)return rows[0];
 return null;
}
function explicitSubscales(d,e){
 const added=[],candidates=[];
 const text=d.sourceGuidance.map(s=>s.text).join('\n');
 for(const line of text.split('\n')){
  const m=/^\s*(?:\d+[.)]\s*)?(.{2,100}?)\s*\((?:criterion [A-Z],\s*)?(?:Mean of )?items?\s*,?\s*([^)]*)\)/i.exec(line);
  if(m){const itemText=m[2].split(';')[0].split(/\.\s*Range|,\s*(?:max score|range)/i)[0].replace(/\[[^\]]*\]/g,'');const nums=parseItems(itemText);if(nums)candidates.push({label:m[1].trim().replace(/^[–—-]\s*/,'').replace(/[ :]+$/,''),items:nums.map(n=>'Q'+n),evidence:line});}
 }
 const own=overrides.find(o=>o.assessmentId===d.id);
 for(const c of own?.subscales||[])candidates.push({...c,items:c.items.map(n=>'Q'+n)});
 for(const c of candidates){
  if(d.rules.some(r=>r.item_ids?.length===c.items.length&&c.items.every(id=>r.item_ids.includes(id))))continue;
  if(!c.items.every(id=>d.questions.some(q=>q.id===id)))continue;
  const parents=d.rules.filter(r=>['sum','mean'].includes(r.method)&&!r.context_constraints&&!r.applies_if&&!r.item_coefficients&&c.items.every(id=>r.item_ids.includes(id)));
  const parent=parents.sort((a,b)=>b.item_ids.length-a.item_ids.length)[0];if(!parent)continue;
  const method=c.method||parent.method;
  const multiplier=c.multiplier??(parent.multiplier??1);
  if(multiplier!==1&&!c.multiplier)continue;
  // Explicit source membership, the same printed option values and transforms as its parent.
  const values=c.items.map(id=>{const q=d.questions.find(q=>q.id===id);return q.options.map(o=>{const t=parent.item_transforms?.[id];const n=parent.option_value_overrides?.[id]?.[o.id]??o[parent.value_field];return t?n*(t.scale??1)+(t.offset??0):n;});});
  if(values.some(v=>!v.length||!v.every(Number.isFinite)))continue;
  const divisor=method==='mean'?values.length:1;
  const min=values.reduce((n,v)=>n+Math.min(...v),0)/divisor*multiplier,max=values.reduce((n,v)=>n+Math.max(...v),0)/divisor*multiplier;
  const id='report_'+slug(c.label);if(!id||d.rules.some(r=>r.id===id))continue;
  const rule={...structuredClone(parent),id,label:c.label,method,multiplier,item_ids:c.items,minimum:min,maximum:max,severity_bands:[],status:'source_explicit_subscale_draft',enabled:false,coverage:'Source-explicit item membership; clinical interpretation is not implied.'};
  d.rules.push(rule);d.reporting.metrics.push({rule_id:id,label:c.label,minimum:min,maximum:max,axis_unit:method==='mean'?'mean item score':'score',item_ids:c.items,calculation_method:method});
  added.push({id,label:c.label,items:c.items,parentRule:parent.id,evidence:c.evidence,method});
 }
 return added;
}
const records=[],audits=[];
for(const original of baseline.records){
 const evidence=await read(join(evidenceDir,original.id+'.json'));
 let d=structuredClone(original);const own=overrides.find(o=>o.assessmentId===d.id);const added=explicitSubscales(d,evidence);
 for(const [id,label] of Object.entries(own?.metricLabels||{})){const rule=d.rules.find(r=>r.id===id),metric=d.reporting.metrics.find(m=>m.rule_id===id);if(rule)rule.label=label;if(metric)metric.label=label;}
 d=compileAnalysisProfile(d,asrs,phq);
 const profile=d.reporting.analysisProfile;
 profile.version='2.0.0-review.1';
 // Source report text is evidence, never a reusable patient-specific narrative.
 const sourceGuidance=d.sourceGuidance.map((s,i)=>({id:'guidance-'+i,title:s.title,text:s.text}));
 const resultRows=evidence.sampleRows;
 const context=own?.sampleContext||{};
 const answers=evidence.answers;
 const scores=scoreDefinition(d,answers,context,{draftScores:true});
 const comparisons=[];
 for(const m of profile.metrics){
  const row=matchingRow(m.label,resultRows,d);
  const cellIndex=own?.comparisonColumns&&Object.hasOwn(own.comparisonColumns,m.id)?own.comparisonColumns[m.id]:1;
  const sourceCell=cellIndex===null?undefined:row?.cells[cellIndex];
  const expected=sourceCell!==undefined&&/^-?\d+(?:\.\d+)?$/.test(sourceCell)?Number(sourceCell):null;
  const rule=d.rules.find(r=>r.id===m.id),score=scores.metrics.find(s=>s.id===m.id);
  const decimals=sourceCell?.includes('.')?sourceCell.split('.')[1].length:0;
  const rounded=Number.isFinite(score?.value)?Math.round((score.value+Number.EPSILON)*10**decimals)/10**decimals:null;
  const match=expected!==null&&rounded===expected;
  comparisons.push({metricId:m.id,label:m.label,sourceRow:row,sourceColumn:cellIndex,expected,actual:score?.value??null,status:!row||expected===null?'source_row_not_mapped':score?.value===null?'sample_answers_or_context_incomplete':match?'matched':'difference_requires_review',reason:score?.reason||null});
  if(own?.bands?.[m.id])m.bands=own.bands[m.id].map(([minimum,maximum,label],i)=>({minimum,maximum,label,colour:['#c7e2d7','#e0ebae','#ffe2a0','#f6be8c','#eaa2a2'][i]}));
  if(own?.normalReferences?.[m.id])m.normalReferences=own.normalReferences[m.id];
 }
 const text=sourceGuidance.map(s=>s.text).join('\n');
 const meanSupported=/average score|mean score|subscale average|scores are averaged/i.test(text);
 const endorsedSupported=/percentage of (?:items|symptoms) endorsed|percent of items endorsed|items endorsed \(%\)/i.test(text+'\n'+evidence.pages.map(p=>p.text.slice(0,5000)).join('\n'));
 const plans=[];
 const meanIds=profile.metrics.filter(m=>{const r=d.rules.find(r=>r.id===m.id);return r?.method==='mean'||r?.multiplier===1/r?.item_ids.length;}).map(m=>m.id);
 const kind=profile.kind;
 if(!['asrs','phq9'].includes(kind)){
  const metrics=profile.metrics;
  const hasNormGraphs=/percentile|t.score|standard.score/i.test(evidence.graphText.map(g=>g.label).join(' ')+' '+text);
  const sourceMean=/average|mean/i.test(evidence.graphText.map(g=>g.label).join(' '));
  if(metrics.length){
   plans.push({id:'saved_raw_scores',kind:'raw_score_bars',metricIds:metrics.filter(m=>!meanIds.includes(m.id)).map(m=>m.id),status:'available_draft',reason:'Local raw-score view from available scoring rules. This is not a substitute for an unavailable source percentile graph.'});
   if(meanIds.length||(meanSupported&&sourceMean))plans.push({id:'subscale_means',kind:'mean_score_bars',metricIds:meanIds.length?meanIds:metrics.filter(m=>d.rules.find(r=>r.id===m.id)?.method==='sum'&&(d.rules.find(r=>r.id===m.id)?.multiplier??1)===1).map(m=>m.id),alreadyAveragedMetricIds:meanIds,status:'available_draft',formula:'Use existing source mean; otherwise raw sum / number of scored items',evidence:sourceGuidance.filter(s=>/average score|mean score/i.test(s.text)).map(s=>s.id)});
   if(/percentage of the (?:highest possible|maximum) score/i.test(text))plans.push({id:'attribute_percentage',kind:'percentage_of_maximum',metricIds:metrics.filter(m=>m.id.startsWith('report_')).map(m=>m.id),status:'available_draft',formula:'raw score / maximum possible score * 100',reason:'Attribute percentage of maximum; not a normative percentile.'});
   if(endorsedSupported)plans.push({id:'items_endorsed',kind:'endorsement_bars',metricIds:metrics.filter(m=>{const r=d.rules.find(r=>r.id===m.id);return r.method==='count_threshold'||r.method==='sum'&&r.item_ids.every(id=>d.questions.find(q=>q.id===id).options.every(o=>[0,1].includes(o[r.value_field])));}).map(m=>m.id),status:'available_draft',formula:'endorsed item count / source group item count * 100'});
   if(hasNormGraphs)plans.push({id:'reference_percentiles',kind:'percentile_bars',metricIds:metrics.map(m=>m.id),status:metrics.some(m=>m.lookup||m.normalReferences)?'partially_available_draft':'withheld_missing_norm_conversion',reason:'Use only configured reference lookups or explicit distribution parameters. Never infer a norm table from a sample result.'});
   if(/(?:graph|plot).{0,100}(?:distribution|quartile)|(?:distribution|quartile).{0,100}(?:graph|plot)/i.test(text))plans.push({id:'reference_distribution',kind:'reference_distribution',metricIds:metrics.map(m=>m.id),status:'withheld_missing_distribution_parameters',reason:'Source comparison graph identified; requires reference-specific distribution or quartile data.'});
   plans.push({id:'compatible_history',kind:'visit_trend',metricIds:metrics.map(m=>m.id),minimumVisits:2,status:'available_draft',missingValue:'gap'});
  }
 }
 profile.sourceReport={schemaVersion:1,assessmentId:d.id,sampleAvailability:evidence.documents.some(d=>d.textReadable)?'readable_pdf':evidence.documents.some(d=>d.available)?'image_only':'no_available_sample',
  evidenceDocuments:evidence.documents.map(({title,sha256,mime_type,available,pages})=>({title,sha256,mimeType:mime_type,available,pages})),
  referenceStatistics:own?.referenceStatistics||{},
  reportSections:evidence.pages.map(p=>({page:p.page,headings:p.headings})),graphLabels:evidence.graphText,
  interpretation:{status:'source_guidance_preserved_execution_partial',sourceGuidance,patientNarrative:'Generate from applicable verified rules and the current saved responses; never reuse the example patient interpretation.',
   requiredFeatures:{populationMatchedNorms:/age|gender|sex.specific/i.test(text)&&/percentile|normative/i.test(text),diagnosticAlgorithm:/diagnos|criteria met/i.test(text),changeInterpretation:/reliable change|minimally important|meaningful change/i.test(text)}},
  graphs:plans.filter(g=>g.metricIds.length),addedSubscales:added,
  reviewStatus:'local_draft_not_approved',reviewNotes:own?.reviewNotes||[],
  comparisonPolicy:{rounding:'Source display precision; no numeric nearest-match selection',unmapped:'Withhold comparison when labels or units cannot be established',referenceMethods:'Never derive population norms from a single sample'},
  sampleComparison:{method:'PDF selected response cells mapped to source questionnaire options; scores calculated by the application; result rows matched by explicit labels.',responseCount:Object.keys(answers).length,questionCount:d.questions.length,comparisons,
   status:comparisons.some(c=>c.status==='difference_requires_review')?'differences_require_review':comparisons.some(c=>c.status==='matched')?'partially_compared':'not_numerically_compared',
   scope:'Individual numeric matches only; not proof of full report equivalence or clinical validity.'}};
 profile.sampleAnswers=answers;profile.sampleContext=context;
 profile.metricMethods=Object.fromEntries(d.rules.map(r=>[r.id,{method:r.method,multiplier:r.multiplier??1}]));
 profile.sourceReport.normativeComparison=[];
 for(const m of profile.metrics){const c=comparisons.find(c=>c.metricId===m.id);if(!c?.sourceRow||!Number.isFinite(c.actual)||!m.normalReferences)continue;for(const ref of m.normalReferences){const expected=Number(c.sourceRow.cells[2]),actual=normalPercentile(c.actual,ref);profile.sourceReport.normativeComparison.push({metricId:m.id,referenceId:ref.id,method:'normal_cdf',actual,expected:Number.isFinite(expected)?expected:null,status:Number.isFinite(expected)&&Math.round(actual)===Math.round(expected)?'matched_rounded_percentile':'requires_review',evidence:'Archived sample result table percentile column'});}}
 if(comparisons.some(c=>c.status==='difference_requires_review'))profile.limitations.push('The archived sample comparison contains an unresolved score difference. The affected metrics and their graphs are withheld from this review profile.');
 for(const c of comparisons.filter(c=>c.status==='difference_requires_review')){const m=profile.metrics.find(m=>m.id===c.metricId);if(m)m.validationHold='Archived source sample score differs; review response mapping, source version and scoring before use.';}
 if(profile.metrics.some(m=>m.normalReferences))profile.coverage.pending=profile.coverage.pending.filter(t=>!t.startsWith('Norm conversions remain'));

 profile.metricItemCounts=Object.fromEntries(d.rules.map(r=>[r.id,r.item_ids.length]));
 profile.coverage={...profile.coverage,rawMetrics:profile.metrics.length,bandedMetrics:profile.metrics.filter(m=>m.bands.length).length,lookupMetrics:profile.metrics.filter(m=>m.lookup).length,
  sourceMatchedMetrics:comparisons.filter(c=>c.status==='matched').length,sourceDifferences:comparisons.filter(c=>c.status==='difference_requires_review').length,pending:[...profile.coverage.pending,...plans.filter(c=>c.status.startsWith('withheld')).map(c=>c.reason),...(added.length?['Additional subscale mappings are draft; inspect sample comparison results.']:[])]};
 d.runtimeHash=scoringRuntimeHash(d);profile.scoringHash=d.runtimeHash;
 d.versionId=contentHash({sourceVersion:original.versionId,runtime:d});
 records.push(d);audits.push({assessmentId:d.id,title:d.title,sampleAvailability:profile.sourceReport.sampleAvailability,sourceComparison:profile.sourceReport.sampleComparison.status,recoveredAnswers:Object.keys(answers).length,questions:d.questions.length,metrics:profile.metrics.length,matchedMetrics:profile.coverage.sourceMatchedMetrics,differences:profile.coverage.sourceDifferences,addedSubscales:added.length,unmappedSourceRows:resultRows.filter(r=>!comparisons.some(c=>c.sourceRow===r)).length,availableGraphs:plans.filter(c=>c.status==='available_draft').length,missingGraphs:plans.filter(c=>c.status.startsWith('withheld')).length,fullEquivalence:false,clinicalApproved:false});
}
await mkdir(out,{recursive:false});for(const folder of ['definitions','report-configs','comparison','evidence','reports'])await mkdir(join(out,folder));
for(const d of records){const p=d.reporting.analysisProfile;await writeFile(join(out,'reports',d.id+'.html'),definitionReportHtml(analysisPreviewReport(d),{printControls:false}));await writeFile(join(out,'definitions',d.id+'.json'),JSON.stringify(d,null,2));await writeFile(join(out,'report-configs',d.id+'.json'),JSON.stringify(p,null,2));await writeFile(join(out,'comparison',d.id+'.json'),JSON.stringify(p.sourceReport.sampleComparison,null,2));await writeFile(join(out,'evidence',d.id+'.json'),await readFile(join(evidenceDir,d.id+'.json')));}
const manifest={assessments:records.length,completeRecoveredResponseSets:audits.filter(a=>a.questions>0&&a.questions===a.recoveredAnswers).length,readableSamples:audits.filter(a=>a.sampleAvailability==='readable_pdf').length,imageOnlySamples:audits.filter(a=>a.sampleAvailability==='image_only').length,noSamples:audits.filter(a=>a.sampleAvailability==='no_available_sample').length,numericallyCompared:audits.filter(a=>a.matchedMetrics+a.differences>0).length,withMatchedMetrics:audits.filter(a=>a.matchedMetrics>0).length,matchedMetrics:audits.reduce((n,a)=>n+a.matchedMetrics,0),normalConversionAssessments:records.filter(d=>d.reporting.analysisProfile.metrics.some(m=>m.normalReferences)).length,matchedNormativeValues:records.reduce((n,d)=>n+d.reporting.analysisProfile.sourceReport.normativeComparison.filter(c=>c.status==='matched_rounded_percentile').length,0),withDifferences:audits.filter(a=>a.differences>0).length,addedSubscales:audits.reduce((n,a)=>n+a.addedSubscales,0),assessmentsWithAddedSubscales:audits.filter(a=>a.addedSubscales>0).length,fullReportEquivalenceVerified:0,clinicalApproved:0,databaseAccess:'none'};
await writeFile(join(out,'assessment-library.json'),JSON.stringify({schemaVersion:1,bundleHash:baseline.bundleHash,manifest,records}));
await writeFile(join(out,'readiness.json'),JSON.stringify({manifest,assessments:audits},null,2));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inventory=await Promise.all(records.map(async d=>({id:d.id,title:d.title,documents:(await read(join(evidenceDir,d.id+'.json'))).documents})));
await writeFile(join(out,'source-inventory.json'),JSON.stringify(inventory,null,2));
await writeFile(join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>All assessment report review</title><style>body{font:15px/1.5 system-ui;margin:30px auto;max-width:1300px;padding:20px;color:#21364b}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ccd7e2}small{display:block;color:#526679}a{color:#17638b}input{padding:12px;width:80%;margin:16px 0}.notice{background:#fff3d9;padding:16px}.counts{background:#edf5fb;padding:16px}tr[hidden]{display:none}</style><h1>All assessment report review</h1><p class="notice">Local draft JSONs. No shared database changes. Numeric sample checks do not establish full report equivalence. Missing norms and unresolved differences are recorded individually. Archived sample answers are used where recovered; remaining examples are clearly labelled synthetic.</p><p class="counts">${manifest.assessments} assessments · ${manifest.readableSamples} readable PDF samples · ${manifest.imageOnlySamples} image-only samples · ${manifest.noSamples} without usable samples<br>${manifest.numericallyCompared} assessments with numeric sample comparisons · ${manifest.matchedMetrics} matched metrics · ${manifest.withDifferences} assessments with unresolved differences<br>${manifest.addedSubscales} additional subscales across ${manifest.assessmentsWithAddedSubscales} assessments · ${manifest.matchedNormativeValues} additional checked normal-percentile values</p><p><a href="readiness.json">Full readiness counts</a> · <a href="assessment-library.json">Combined review bundle</a></p><label>Find an assessment <input id="search" type="search" placeholder="PHQ-9, ASRS, autism…"></label><table><thead><tr><th>Assessment</th><th>Sample comparison</th><th>Open local files</th></tr></thead><tbody>${audits.map(a=>`<tr><td>${escape(a.title)}<small>${a.metrics} measures; ${a.addedSubscales} added subscales</small></td><td>${escape(a.sampleAvailability.replaceAll('_',' '))}<small>${a.matchedMetrics} matched; ${a.differences} differences; ${a.recoveredAnswers}/${a.questions} answers recovered</small></td><td><a href="reports/${a.assessmentId}.html">Report</a> · <a href="report-configs/${a.assessmentId}.json">Report JSON</a> · <a href="definitions/${a.assessmentId}.json">Complete JSON</a> · <a href="comparison/${a.assessmentId}.json">Checks</a> · <a href="evidence/${a.assessmentId}.json">Evidence</a></td></tr>`).join('')}</tbody></table><script>document.getElementById('search').addEventListener('input',event=>{for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(event.target.value.toLowerCase());});</script></html>`);
console.log(JSON.stringify({out,...manifest},null,2));
