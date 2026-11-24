import { contentHash, scoringRuntimeHash } from './assessment-content.js';
const colours = ['#c7e2d7','#e0ebae','#ffe2a0','#f6be8c','#eaa2a2','#d28b9c'];
export function validBands(bands, minimum, maximum) {
  if (!bands?.length || bands.some(b => !Number.isInteger(b.minimum) || !Number.isInteger(b.maximum) || b.minimum > b.maximum)) return false;
  const sorted = [...bands].sort((a,b) => a.minimum-b.minimum);
  return sorted[0].minimum === minimum && sorted.at(-1).maximum === maximum && sorted.every((b,i) => !i || b.minimum === sorted[i-1].maximum+1);
}
const range = value => {
  const text = String(value).trim().replaceAll('–','-').replaceAll('—','-');
  const match = /^(\d+)(?:\s*(?:to|-)\s*(\d+))?$/.exec(text);
  return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
};
export function compileAnalysisProfile(original, asrs, phq9) {
  const d = structuredClone(original);
  const evidence = [];
  if (d.id === asrs.assessmentId) {
    for (const [id, numbers] of Object.entries(asrs.domains)) {
      if (d.rules.some(r => r.id === id)) throw new Error('ASRS subscale already exists; review version explicitly.');
      const item_ids = numbers.map(n => `Q${n}`);
      d.rules.push({ id, label: ({inattentive_count:'Inattentiveness',motor_count:'Hyperactivity / Impulsivity — Motor',verbal_count:'Hyperactivity / Impulsivity — Verbal',hyperactive_impulsive_count:'Hyperactivity / Impulsivity',endorsed_total:'Total symptoms endorsed'})[id], method:'count_threshold', item_ids, value_field:'printed_value', operator:'>=', item_thresholds:Object.fromEntries(numbers.map(n => [`Q${n}`,asrs.endorsementThresholds[n-1]])), multiplier:1, minimum:0, maximum:item_ids.length, severity_bands:[], missing_item_policy:'withhold_if_any_required_answer_is_missing', status:'source_matched_draft', enabled:false });
      d.reporting.metrics.push({rule_id:id,label:d.rules.at(-1).label,minimum:0,maximum:item_ids.length,axis_unit:'items endorsed',item_ids,calculation_method:'count_threshold'});
    }
    evidence.push({ feature:'ASRS endorsement subscales and exact community lookup', source:asrs.sourceHashes, status:'sample_values_verified' });
  }
  const metrics = d.reporting.metrics.map(m => {
    const r = d.rules.find(r => r.id === m.rule_id);
    let bands = (r?.severity_bands || []).map(b => ({minimum:b.minimum_inclusive,maximum:b.maximum_inclusive,label:b.label}));
    let source = bands.length ? `rules/${r.id}/severity_bands` : null;
    // Only explicit, complete raw-score tables may be converted automatically.
    // Conditional protocol tables and percentile ranges are deliberately excluded.
    if (!bands.length && d.reporting.interpretation?.overall_total === r?.id) {
      for (const [i,t] of (d.tables || []).entries()) {
        if (!/^total score$/i.test(t.rows?.[0]?.[0] || '') || !/descriptor|severity category/i.test(t.rows?.[0]?.[1] || '')) continue;
        const candidate = t.rows.slice(1).map(row => { const bounds=range(row[0]); return bounds && {minimum:bounds[0],maximum:bounds[1],label:row[1]}; });
        if (candidate.every(Boolean) && validBands(candidate,m.minimum,m.maximum)) { bands=candidate;source=`tables/${i}`;break; }
      }
    }
    if (d.id === asrs.assessmentId && asrs.bands[r.id]) { bands=asrs.bands[r.id].map(([minimum,maximum,label]) => ({minimum,maximum,label}));source='asrs-supplement'; }
    if (!validBands(bands,m.minimum,m.maximum)) bands=[];
    let lookup=null, reference=null;
    if (d.id === asrs.assessmentId && asrs.lookups[r.id]) { lookup=asrs.lookups[r.id];reference='Adult community reference'; }
    if (d.id === phq9?.assessmentId && r.id === 'total_raw') { lookup=phq9.community;reference='Community reference (2013)';source=phq9.sourceHashes; }
    // ABUSI: the exported exact table is a treatment-sample reference, not community norms.
    if (d.id.startsWith('alexian-brothers-urge-to-self-injure-scale-abusi--') && d.reporting.interpretation?.overall_total === r.id) {
      const t=d.tables.find(t => t.rows?.[0]?.[2] === 'NSSI Treatment Percentile');
      if(t){ lookup=Array(m.maximum+1).fill(null);for(const row of t.rows.slice(1)){const n=Number(row[0]),p=Number(row[2]);if(Number.isInteger(n)&&n>=m.minimum&&n<=m.maximum&&Number.isFinite(p)&&p>=0&&p<=100)lookup[n]=p;}reference='NSSI treatment reference';source='extracted exact percentile table'; }
    }
    if(bands.length || lookup)evidence.push({metricId:r.id,source,bands:bands.length,exactPercentileLookup:Boolean(lookup),status:'source_defined_draft'});
    return {id:m.rule_id,label:m.label || r.label || m.rule_id,minimum:m.minimum,maximum:m.maximum,unit:m.axis_unit || 'score',bands:bands.map((b,i)=>({...b,colour:colours[Math.min(i,colours.length-1)]})),lookup,reference};
  });
  d.runtimeHash=scoringRuntimeHash(d);
  d.reporting.analysisProfile={schemaVersion:1,version:'1.0.0-review.1',assessmentId:d.id,scoringHash:d.runtimeHash,status:'source_defined_draft',clinicalApproved:false,
    metrics,kind:d.id===asrs.assessmentId?'asrs':'standard',distribution:d.id===asrs.assessmentId?asrs.distribution:null, sample:d.id===asrs.assessmentId?asrs.sample:null,
    evidence,limitations:[...(d.id===asrs.assessmentId?asrs.limitations:[]),'Source-defined draft configuration; clinical approval is pending.'],
    sourceEquivalence:d.id===asrs.assessmentId?'sample_numeric_values_matched_graph_geometry_not_pixel_verified':'not_verified',
  };
  const text=(d.sourceGuidance || []).map(s=>s.text).join('\n');
  d.reporting.analysisProfile.coverage={
    rawMetrics:metrics.length,bandedMetrics:metrics.filter(m=>m.bands.length).length,lookupMetrics:metrics.filter(m=>m.lookup).length,
    mentionedFeatures:{norms:/percentile|normative|standard.score|t.score/i.test(text),distributions:/distribution|quartile/i.test(text),subscales:/subscale|domain/i.test(text),change:/reliable change|meaningful change|important difference/i.test(text)},
    pending:['Independent clinical review',...(/percentile|normative/i.test(text)&&!metrics.some(m=>m.lookup)?['Norm conversions remain uncompiled; inspect evidence before use.']:[]),...(/distribution|quartile/i.test(text)&&d.id!==asrs.assessmentId?['Reference distribution parameters or geometry remain unverified.']:[]),...(/reliable change|meaningful change|important difference/i.test(text)?['Change interpretation requires a separately verified instrument-specific rule.']:[])]
  };
  if (d.id === phq9?.assessmentId) {
    const p=d.reporting.analysisProfile;
    p.kind='phq9';
    p.sample=phq9.sample;
    p.distribution={model:'reference_quartiles',metricId:'total_raw',minimum:0,maximum:27,cutoff:10,
      groups:[{label:'Community',lookup:phq9.community},{label:'Other depressive disorder',lookup:phq9.otherDepressive},{label:'Major depression',lookup:phq9.majorDepression}],
      note:'Shaded intervals show reference quartiles from the archived percentile table. These are discrete reference intervals; density-curve geometry has not been reproduced.'};
    p.limitations.push(...phq9.notes);
    p.sourceEquivalence='sample_total_percentile_matched_density_geometry_not_reproduced';
    p.coverage.pending=p.coverage.pending.filter(s=>!s.startsWith('Reference distribution'));
  }
  // Older generic report plans are not a substitute for this source-specific profile.
  delete d.reporting.reportPlan;
  return d;
}
export function freezeAnalysisVersion(raw,d) {
  const {versionId,sourceSha256,...runtimeContent}=d;
  return {...d,versionId:contentHash({raw,displayAssets:[],runtimeContent})};
}
