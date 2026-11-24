import { scoringRuntimeHash } from './assessment-content.js';
import { reportProfileFor, phq9Id } from './report-profiles.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validScore = n => Number.isInteger(n) && n >= 0 && n <= 27;
const fmt = n => Number.isFinite(n) ? String(Number(n.toFixed(1))) : '—';
const day = value => new Date(value).toISOString().slice(0,10);
export function phq9VisualData(definition, metrics, answers) {
  if (definition.id !== phq9Id) return null;
  const profile = definition.reporting?.visualProfile || reportProfileFor(definition.id);
  if (!profile || profile.compatibleScoringHash !== scoringRuntimeHash(definition)) return null;
  const metric = metrics.find(m => m.id === profile.metricId);
  const total = validScore(metric?.value) ? metric.value : null;
  const referenceValue = total === null ? null : profile.communityReference.lookup[String(total)] ?? null;
  return { profile, total, referenceValue, band: total === null ? null : profile.bands.find(b => total >= b.min && total <= b.max)?.label,
    points: (metric?.points || []).map(p => ({...p,value:validScore(p.value)?p.value:null})),
    items: definition.questions.map(q => {const o=q.options.find(o=>o.id===answers[q.id]);return {id:q.id,text:q.text,value:Number.isInteger(o?.score)&&o.score>=0&&o.score<=3?o.score:null};}) };
}
export function adaptLegacyPhq9(state, definition) {
  if (state.formId !== 'phq9' || state.formVersion !== 'v1-prototype' || state.language !== 'en' || state.status !== 'completed' ||
      !Array.isArray(state.answers) || state.answers.length !== 9 || !validScore(state.scores?.rawTotal)) throw new RangeError('This saved result is not compatible with the PHQ-9 graphical report.');
  const answers = {};
  for (let i=1;i<=9;i++) {
    const entries=state.answers.filter(a=>a.number===i), value=entries[0]?.value;
    if (entries.length!==1 || !Number.isInteger(value) || value<0 || value>3) throw new RangeError('Incomplete saved PHQ-9 answers.');
    const q=definition.questions.find(q=>q.id===`Q${i}`), option=q?.options.find(o=>o.score===value);
    if (!option) throw new RangeError('Incompatible PHQ-9 response mapping.');
    answers[q.id]=option.id;
  }
  return {...state, formId:definition.id, formSnapshot:{...definition,versionId:`legacy:${state.formVersion}`}, answers,
    scores:{engineVersion:`legacy:${state.scores.scoringVersion || state.formVersion}`,status:'legacy_saved',label:'Saved PHQ-9 result · graphical report in development review',
      metrics:[{id:'total_raw',label:'PHQ-9 total score',value:state.scores.rawTotal,minimum:0,maximum:27}]}};
}
export function phq9PreviewStates(definition) {
  const values=[[2,2,3,2,2,2,2,2,0],[1,1,2,2,1,2,1,2,0],[0,1,2,1,1,1,0,1,0]];
  return values.map((row,i)=>({id:`preview-${i}`,demoPatientId:'Fictional example',formId:definition.id,formVersion:definition.versionId,formSnapshot:definition,
    status:'completed',context:{},completedAt:`2026-11-${['01','08','15'][i]}T10:00:00.000Z`,
    answers:Object.fromEntries(definition.questions.map((q,j)=>[q.id,q.options.find(o=>o.score===row[j]).id])),
    scores:{engineVersion:'synthetic-preview',status:'source_draft_unapproved',label:'Sample report · fictional responses; not a patient record',
      metrics:[{id:'total_raw',value:row.reduce((a,b)=>a+b,0),minimum:0,maximum:27}]}}));
}
function svg(title,body,height=260) {return `<svg viewBox="0 0 720 ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}</svg>`;}
function ticksX(x,y) {return Array.from({length:10},(_,i)=>i*3).map(n=>`<text x="${x(n)}" y="${y}" text-anchor="middle">${n}</text>`).join('');}
function marker(x,y1,y2,total) {return total===null?'':`<line x1="${x(total)}" x2="${x(total)}" y1="${y1}" y2="${y2}" stroke="#173d66" stroke-width="3" stroke-dasharray="5 3"/><text x="${Math.min(655,Math.max(65,x(total)))}" y="${y1-10}" text-anchor="middle" class="strong">Score ${total}</text>`;}
function severity(v) {
  const x=n=>70+n/27*580;
  let body=v.profile.bands.map(b=>`<rect x="${x(b.min===0?0:b.min-.5)}" y="48" width="${x(b.max===27?27:b.max+.5)-x(b.min===0?0:b.min-.5)}" height="56" fill="${b.colour}"/>`).join('');
  body+=marker(x,40,112,v.total)+ticksX(x,136);
  return svg('PHQ-9 score from 0 to 27 with severity bands',body,155);
}
function community(v) {
  const x=n=>60+n/27*600,y=n=>225-n/100*175;
  let body=[0,25,50,75,100].map(n=>`<line x1="60" x2="660" y1="${y(n)}" y2="${y(n)}" stroke="#e3e9ee"/><text x="49" y="${y(n)+4}" text-anchor="end">${n}%</text>`).join('');
  let previous=null;
  for(let n=0;n<=27;n++) {
    const value=v.profile.communityReference.lookup[String(n)];
    if(!Number.isFinite(value)){previous=null;continue;}
    if(previous)body+=`<path d="M ${x(previous.n)} ${y(previous.value)} H ${x(n)} V ${y(value)}" fill="none" stroke="#16817e" stroke-width="2.5"/>`;
    body+=`<circle cx="${x(n)}" cy="${y(value)}" r="3" fill="#16817e"><title>Score ${n}: ${value}% at or below</title></circle>`;
    previous={n,value};
  }
  body+=ticksX(x,249)+marker(x,40,225,v.total);
  if(Number.isFinite(v.referenceValue))body+=`<circle cx="${x(v.total)}" cy="${y(v.referenceValue)}" r="6" fill="#173d66" stroke="white" stroke-width="2"/>`;
  return svg('Cumulative percentage in the German community reference sample',body,270);
}
function distributions(v) {
  const x=n=>60+n/27*600;
  let body='';
  for(let g=0;g<v.profile.referenceGroups.length;g++){
    const group=v.profile.referenceGroups[g], top=35+g*105;
    body+=`<text x="60" y="${top}" class="strong">${esc(group.label)} · n=${group.n}</text>`;
    for(let i=0;i<5;i++){
      const b=v.profile.bands[i],pct=group.counts[i]/group.n*100,left=x(b.min===0?0:b.min-.5),right=x(b.max===27?27:b.max+.5),h=pct*.65;
      body+=`<rect x="${left+1}" y="${top+76-h}" width="${right-left-2}" height="${h}" fill="${b.colour}" stroke="#aab8c3"/><text x="${(left+right)/2}" y="${top+69-h}" text-anchor="middle">${fmt(pct)}%</text>`;
    }
    body+=`<line x1="60" x2="660" y1="${top+76}" y2="${top+76}" stroke="#bbc7d1"/>`;
    if(v.total!==null)body+=`<line x1="${x(v.total)}" x2="${x(v.total)}" y1="${top+12}" y2="${top+76}" stroke="#173d66" stroke-width="2" stroke-dasharray="4 3"/>`;
  }
  return svg('Observed PHQ-9 score distributions in three reference groups',body+ticksX(x,355),375);
}
function trend(v) {
  const points=v.points,times=points.map(p=>Date.parse(p.date)),start=Math.min(...times),end=Math.max(...times);
  const x=p=>end===start?360:60+(Date.parse(p.date)-start)/(end-start)*600,y=n=>215-n/27*170;
  let body=v.profile.bands.map(b=>{const lo=b.min===0?0:b.min-.5,hi=b.max===27?27:b.max+.5;return `<rect x="60" y="${y(hi)}" width="600" height="${y(lo)-y(hi)}" fill="${b.colour}" opacity=".5"/>`;}).join('');
  body+=[0,5,10,15,20,27].map(n=>`<text x="48" y="${y(n)+4}" text-anchor="end">${n}</text>`).join('');
  let previous=null;
  for(const p of points){if(p.value===null){previous=null;continue;}
    if(previous)body+=`<line x1="${x(previous)}" y1="${y(previous.value)}" x2="${x(p)}" y2="${y(p.value)}" stroke="#173d66" stroke-width="3"/>`;
    body+=`<circle cx="${x(p)}" cy="${y(p.value)}" r="5" fill="#173d66"><title>${esc(day(p.date))}: ${p.value}</title></circle><text x="${x(p)}" y="${y(p.value)-10}" text-anchor="middle" class="strong">${p.value}</text>`;previous=p;
  }
  if(points.length){body+=`<text x="60" y="241">${esc(day(points[0].date))}</text><text x="660" y="241" text-anchor="end">${esc(day(points.at(-1).date))}</text>`;}
  return svg('PHQ-9 scores across compatible completed visits',body,265);
}
function itemProfile(v) {
  return svg('PHQ-9 responses scored from 0 to 3',v.items.map((item,i)=>`<text x="55" y="${35+i*28}" text-anchor="end">${esc(item.id)}</text><rect x="70" y="${21+i*28}" width="540" height="18" rx="4" fill="#edf2f5"/>${item.value===null?'':`<rect x="70" y="${21+i*28}" width="${item.value*180}" height="18" rx="4" fill="#538fa1"/>`}<text x="625" y="${35+i*28}">${fmt(item.value)}</text>`).join(''),280);
}
export function phq9ReportHtml(report,{printControls=true}={}) {
  const v=report.phq9, p=v.profile;
  const section=(kind,title,chart,note)=>p.charts.includes(kind)?`<section class="chart" data-chart="${kind}"><h2>${title}</h2>${chart}<div class="caption">${note}</div></section>`:'';
  const legend=`<div class="legend">${p.bands.map(b=>`<span><i style="background:${b.colour}"></i>${esc(b.label)} (${b.min}–${b.max})</span>`).join('')}</div>`;
  const route=report.reportPath || `/api/definition-sessions/${encodeURIComponent(report.id)}/report`;
  const ref=v.referenceValue===null?'Unavailable':`${esc(v.referenceValue)}%`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PHQ-9 graphical report | OpenMind</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf2f6;color:#24354a;font:15px/1.55 system-ui,sans-serif}main{max-width:980px;margin:28px auto;padding:40px;background:white;border-radius:16px}h1{font-size:30px;line-height:1.2;margin:10px 0}h2{font-size:19px;margin:0 0 12px}.eyebrow{color:#187b83;letter-spacing:.12em;font-size:12px;font-weight:750}.meta,.caption{color:#617185;font-size:12px}.meta{overflow-wrap:anywhere}.toolbar{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:26px}a{color:#245b83}.sample,.notice{padding:12px 16px;border-radius:8px;background:#fff4d7;color:#684e18;font-size:13px}.sample{background:#e1f1f5;color:#20576c;font-weight:700}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.summary div{padding:18px;border:1px solid #dce5ed;background:#f4f8fb;border-radius:10px}.summary span{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#60758b}.summary strong{display:block;font-size:25px;margin-top:6px}.chart{padding:23px 0;border-top:1px solid #e1e8ee;break-inside:avoid}svg{width:100%;height:auto;display:block;overflow:visible;font:12px system-ui,sans-serif;fill:#465b71}.strong{font-weight:700}.legend{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:12px;margin:10px 0 18px}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px}table{width:100%;border-collapse:collapse;font-size:13px;margin:16px 0}td,th{padding:10px;text-align:left;border-bottom:1px solid #e1e8ee;vertical-align:top}th{background:#f0f5f8}tr{break-inside:avoid}details{margin:16px 0}summary{cursor:pointer;font-weight:650}.references{font-size:12px}.references p{overflow-wrap:anywhere}@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}h1{font-size:25px}.summary{grid-template-columns:1fr}.summary strong{font-size:23px}td,th{padding:6px}.chart{padding:20px 0}}@media print{body{background:white}main{padding:0;margin:0;max-width:none}.toolbar{display:none}h2{break-after:avoid}.summary{grid-template-columns:repeat(3,1fr)}thead{display:table-header-group}details{display:block}}
</style></head><body><main>${printControls?`<nav class="toolbar"><a href="/?view=reports">Back to reports</a><a href="${esc(report.downloadUrl || route+'.pdf')}">Download PDF</a>${report.preview?'<a href="/preview/phq9-report?single=1">Single visit example</a><a href="/preview/phq9-report">Repeat visits example</a>':''}</nav>`:''}${report.preview?'<div class="sample">SAMPLE REPORT · Fictional responses and dates. No patient record is created.</div>':''}<p class="eyebrow">OPENMIND · PHQ-9 REPORT</p><h1>Patient Health Questionnaire – Depression</h1><p class="meta">${esc(report.patient)} · ${esc(day(report.completedAt))} · Past two weeks</p><p class="notice">${esc(report.draftLabel)}. Score bands are descriptive; this report does not establish a diagnosis.</p><div class="summary"><div><span>Total score</span><strong>${fmt(v.total)} / 27</strong></div><div><span>Score band · draft</span><strong>${esc(v.band || 'Unavailable')}</strong></div><div><span>Reference sample at or below score</span><strong>${ref}</strong><small>German community sample · descriptive comparison</small></div></div>${v.total===null?'<p class="notice">No valid saved total is available. Score markers and reference comparisons are withheld.</p>':''}
${section('severity_bar','Score and severity bands',severity(v),`The marker shows the saved total on the 0–27 scale.${legend}`)}
${section('community_cumulative','Community reference',community(v),`${esc(p.communityReference.statistic)}. ${esc(p.communityReference.label)}, n=${p.communityReference.sampleSize}, ages ${esc(p.communityReference.ageRange)}, surveyed ${esc(p.communityReference.collected)}. ${esc(p.communityReference.applicability)} Score 24 is not tabulated; the curve has a gap. At 27 the source reports &gt;99.9%.`)}
${section('reference_distributions','Reference group distributions',distributions(v),`Each bar shows the percentage of a study group within a score band; the dashed line marks the saved score. Community: German sample (2020–2021); clinical groups: US primary-care interview sample (2001 publication). These groups are not diagnostic probabilities.${legend}`)}
${section('visit_trend','Score over time',trend(v),v.points.length>1?'Only compatible saved visits are included. Missing scores break the line. Changes are numerical; treatment effects and reliable change are not inferred.':'One completed visit is available. A line will appear when a compatible repeat assessment is saved.')}
${section('item_profile','Response profile',itemProfile(v),'Each item ranges from 0 to 3. Question wording and recorded responses appear below.')}
<h2>Recorded responses</h2><table><thead><tr><th>Item</th><th>Question</th><th>Response</th><th>Score</th></tr></thead><tbody>${report.responses.map((r,i)=>`<tr><td>${esc(r.id)}</td><td>${esc(r.text)}</td><td>${esc(r.value)}</td><td>${fmt(v.items[i]?.value)}</td></tr>`).join('')}</tbody></table>${v.items[8]?.value>0?'<p class="notice">Item 9 has a non-zero response. A clinician should review this response directly; the total score does not replace individual assessment.</p>':''}
${v.points.length>1?`<h2>Visit history</h2><table><thead><tr><th>Completed</th><th>Saved total</th></tr></thead><tbody>${v.points.map(point=>`<tr><td>${esc(day(point.date))}</td><td>${fmt(point.value)}</td></tr>`).join('')}</tbody></table>`:''}<section class="references"><h2>Reference data and limitations</h2>${p.sources.map(s=>`<p>${esc(s.citation)} DOI: ${esc(s.doi)}${s.licence?` · ${esc(s.licence)}`:''}</p>`).join('')}${p.notes.map(n=>`<p>${esc(n)}</p>`).join('')}<p>The community curve uses the published total-sample cumulative table. It is not a patient-matched percentile or a probability of illness.</p><p class="meta">Report profile ${esc(p.id)} ${esc(p.version)} · Saved scoring engine ${esc(report.engineVersion)}<br>Saved assessment version: ${esc(report.definitionVersionId)}</p></section></main></body></html>`;
}
