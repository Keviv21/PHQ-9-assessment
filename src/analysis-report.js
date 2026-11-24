import {normalPercentile} from './report-statistics.js';
import { scoringRuntimeHash, displayText } from './assessment-content.js';
const finite=Number.isFinite;
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>finite(v)?String(Math.round(v*100)/100):'Unavailable';
export function analysisVisualData(d, metrics) {
  const p=d.reporting?.analysisProfile;
  if (!p || p.schemaVersion!==1 || p.assessmentId!==d.id || p.scoringHash!==scoringRuntimeHash(d)) return null;
  const enriched=p.metrics.map(c=>{
    const m=metrics.find(m=>m.id===c.id);
    const value=!c.validationHold&&finite(m?.value)&&m.value>=c.minimum&&m.value<=c.maximum?m.value:null;
    return {...c,value,points:m?.points||[],reason:c.validationHold||m?.reason,normalPercentiles:(c.normalReferences||[]).map(ref=>({...ref,value:normalPercentile(value,ref)})),
      band:value===null?null:c.bands.find(b=>value>=b.minimum&&value<=b.maximum)?.label||null,
      percentile:Number.isInteger(value)&&finite(c.lookup?.[value])?c.lookup[value]:null};
  });
  return {...p,metrics:enriched};
}
function figure(kind,title,body,caption='',height=260){return `<figure data-chart="${kind}"><figcaption>${e(title)}</figcaption><svg viewBox="0 0 760 ${height}" role="img" aria-label="${e(title)}"><title>${e(title)}</title>${body}</svg>${caption?`<p class="caption">${e(caption)}</p>`:''}</figure>`;}
function bandRects(m,x,y,height){return m.bands.map(b=>{
  const left=Math.max(m.minimum,b.minimum-.5),right=Math.min(m.maximum,b.maximum+.5);
  return `<rect x="${x(left)}" y="${y}" width="${x(right)-x(left)}" height="${height}" fill="${e(b.colour)}"/>`;
}).join('');}
function ticks(m,x,y){const values=Array.from({length:7},(_,i)=>m.minimum+(m.maximum-m.minimum)*i/6);return values.map(v=>`<text x="${x(v)}" y="${y}" text-anchor="middle">${n(v)}</text>`).join('');}
function rangeBar(m){
  if (!finite(m.value)||!finite(m.minimum)||!finite(m.maximum)||m.maximum<=m.minimum) return '';
  const x=v=>40+680*(v-m.minimum)/(m.maximum-m.minimum);
  return figure('score-range',m.label,`<rect x="40" y="42" width="680" height="28" fill="#dce7ef"/>${bandRects(m,x,42,28)}<line x1="${x(m.value)}" x2="${x(m.value)}" y1="30" y2="80" stroke="#173d66" stroke-width="4"/><text x="${x(m.value)}" y="20" text-anchor="middle">${n(m.value)}</text>${ticks(m,x,102)}`,m.bands.map(b=>`${b.label}: ${b.minimum}–${b.maximum}`).join(' · '),115);
}
function scoreColumn(m){
  if(!finite(m?.value))return '';
  const y=v=>260-220*(v-m.minimum)/(m.maximum-m.minimum);
  let body=m.bands.map(b=>{const low=Math.max(m.minimum,b.minimum-.5),high=Math.min(m.maximum,b.maximum+.5);return `<rect x="70" y="${y(high)}" width="610" height="${y(low)-y(high)}" fill="${e(b.colour)}"/><text x="665" y="${(y(high)+y(low))/2+4}" text-anchor="end">${e(b.label)}</text>`;}).join('');
  body+=Array.from({length:10},(_,i)=>i*3).map(v=>`<text x="60" y="${y(v)+4}" text-anchor="end">${v}</text>`).join('');
  body+=`<rect x="230" y="${y(m.value)}" width="85" height="${260-y(m.value)}" fill="#2d6089"/><text x="272" y="${y(m.value)-8}" text-anchor="middle">${m.value}</text><text x="272" y="285" text-anchor="middle">Total score</text>`;
  return figure('total-severity','PHQ-9 total score',body,'',300);
}
function referenceChart(p){
  const d=p.distribution,m=p.metrics.find(m=>m.id===d?.metricId);
  if (!d||!finite(m?.value))return '';
  const x=v=>55+650*(v-d.minimum)/(d.maximum-d.minimum);
  if(d.model==='reference_quartiles'){
    const body=d.groups.map((g,i)=>{const y=62+i*66,q=[25,50,75].map(p=>g.lookup.findIndex(v=>finite(v)&&v>=p));return `<text x="55" y="${y-18}">${e(g.label)}</text><line x1="55" x2="705" y1="${y}" y2="${y}" stroke="#dce3eb"/><rect x="${x(q[0])}" y="${y-9}" width="${x(q[2])-x(q[0])}" height="18" fill="${['#b8d9e9','#ebd194','#ddb0ad'][i]}"/><line x1="${x(q[1])}" x2="${x(q[1])}" y1="${y-13}" y2="${y+13}" stroke="#354658"/><text x="${x(q[1])}" y="${y+29}" text-anchor="middle">Median ${q[1]}</text>`;}).join('');
    return figure('reference-quartiles','Score compared with reference populations',`${body}<line x1="${x(m.value)}" x2="${x(m.value)}" y1="20" y2="220" stroke="#173d66" stroke-dasharray="4 3" stroke-width="3"/><text x="${x(m.value)}" y="15" text-anchor="middle">Score ${m.value}</text>${ticks(m,x,255)}`,d.note,270);
  }
  const maxDensity=Math.max(...d.groups.map(g=>1/(g.sd*Math.sqrt(2*Math.PI))));
  const base=195,y=(v,g)=>base-145*Math.exp(-.5*((v-g.mean)/g.sd)**2)/(g.sd*Math.sqrt(2*Math.PI))/maxDensity;
  const curves=d.groups.map((g,i)=>{const colour=['#75a9c2','#d79b75'][i];const points=Array.from({length:241},(_,j)=>{const v=d.minimum+(d.maximum-d.minimum)*j/240;return `${x(v)},${y(v,g)}`;}).join(' ');return `<polygon points="${x(d.minimum)},${base} ${points} ${x(d.maximum)},${base}" fill="${colour}" fill-opacity=".25"/><polyline points="${points}" stroke="${colour}" fill="none" stroke-width="2"/><text x="${x(g.mean)}" y="${y(g.mean,g)-10}" text-anchor="middle">${e(g.label)}</text>`;}).join('');
  return figure('reference-distribution','Part A compared with community and ADHD references',`${curves}${bandRects(m,x,200,22)}<line x1="${x(m.value)}" x2="${x(m.value)}" y1="25" y2="225" stroke="#173d66" stroke-width="3"/><text x="${x(m.value)}" y="15" text-anchor="middle">Score ${m.value}</text><line x1="${x(d.cutoff)}" x2="${x(d.cutoff)}" y1="30" y2="225" stroke="#754823" stroke-dasharray="4 3"/>${ticks(m,x,245)}`,`${d.note} Part A threshold: ${d.cutoff}. ${m.bands.map(b=>`${b.label}: ${b.minimum}–${b.maximum}`).join('; ')}.`,260);
}
function endorsed(p){
  const get=id=>p.metrics.find(m=>m.id===id)?.value;
  const a=get('inattentive_count'),b=get('motor_count'),c=get('verbal_count');
  if (![a,b,c].every(finite))return '';
  const colours=['#4d89af','#67aaa4','#dec78c'];
  const groups=[{label:'Total',counts:[a,b,c],denom:18},{label:'Inattentiveness',counts:[a,0,0],denom:9},{label:'Hyperactivity / Impulsivity',counts:[0,b,c],denom:9}];
  const grid=[0,25,50,75,100].map(v=>`<line x1="55" x2="715" y1="${230-v*1.6}" y2="${230-v*1.6}" stroke="#e3e9ed"/><text x="45" y="${234-v*1.6}" text-anchor="end">${v}%</text>`).join('');
  const bars=groups.map((g,i)=>{let total=0;const x=135+i*220;const segments=g.counts.map((count,j)=>{const h=count/g.denom*160;total+=h;return `<rect x="${x}" y="${230-total}" width="78" height="${h}" fill="${colours[j]}"/>`;}).join('');return `${segments}<text x="${x+39}" y="${220-total}" text-anchor="middle">${Math.round(g.counts.reduce((a,b)=>a+b,0)/g.denom*100)}%</text><text x="${x+39}" y="255" text-anchor="middle" font-size="11">${e(g.label)}</text>`;}).join('');
  return figure('endorsed-symptoms','ASRS symptoms endorsed',grid+bars,'Inattentiveness (blue) · Motor (teal) · Verbal (gold). Each bar uses the number of items in that group as its denominator.',275);
}
function trend(m){
  if(m.points.length<2||!finite(m.minimum)||!finite(m.maximum)||m.maximum<=m.minimum)return '';
  const start=Date.parse(m.points[0].date),end=Date.parse(m.points.at(-1).date);
  const x=p=>end===start?380:55+650*(Date.parse(p.date)-start)/(end-start),y=v=>210-170*(v-m.minimum)/(m.maximum-m.minimum);
  const segments=[];let current=[];
  for(const point of m.points){if(finite(point.value))current.push(point);else if(current.length){segments.push(current);current=[];}}if(current.length)segments.push(current);
  if(!segments.length)return '';
  const bands=m.bands.map(b=>{const low=Math.max(m.minimum,b.minimum-.5),high=Math.min(m.maximum,b.maximum+.5);return `<rect x="55" y="${y(high)}" width="650" height="${y(low)-y(high)}" fill="${e(b.colour)}" fill-opacity=".5"/>`;}).join('');
  return figure('visit-trend',`${m.label} over time`,`${bands}<text x="45" y="44" text-anchor="end">${n(m.maximum)}</text><text x="45" y="214" text-anchor="end">${n(m.minimum)}</text>${segments.map(s=>`${s.length>1?`<polyline points="${s.map(p=>`${x(p)},${y(p.value)}`).join(' ')}" stroke="#285d8a" stroke-width="2" fill="none"/>`:''}${s.map(p=>`<circle cx="${x(p)}" cy="${y(p.value)}" r="4" fill="#285d8a"><title>${e(p.date)}: ${n(p.value)}</title></circle>`).join('')}`).join('')}<text x="55" y="240">${e(m.points[0].date.slice(0,10))}</text><text x="705" y="240" text-anchor="end">${e(m.points.at(-1).date.slice(0,10))}</text>`,'Only compatible saved visits are compared. Missing scores break the line.');
}
function groupedBars(kind,title,metrics,caption){
  const available=metrics.filter(m=>finite(m.value)&&finite(m.minimum)&&finite(m.maximum)&&m.maximum>m.minimum);
  let html='';
  for(let offset=0;offset<available.length;offset+=8){
    const group=available.slice(offset,offset+8),h=group.length*64+20;
    const body=group.map((m,i)=>{const top=i*64+24,w=660*(m.value-m.minimum)/(m.maximum-m.minimum);return `<text x="30" y="${top-8}" font-size="12">${e(m.label)}</text><rect x="30" y="${top}" width="660" height="16" fill="#e3ebf2"/><rect x="30" y="${top}" width="${Math.max(0,w)}" height="16" fill="#397aa0"/><text x="700" y="${top+13}">${n(m.value)}</text><text x="30" y="${top+34}" font-size="10">${n(m.minimum)}</text><text x="690" y="${top+34}" text-anchor="end" font-size="10">${n(m.maximum)}</text>`;}).join('');
    html+=figure(kind,title+(offset?' (continued)':''),body,caption,h);
  }
  return html;
}
function plannedCharts(p){
  const plans=p.sourceReport?.graphs;if(!plans)return p.metrics.map(rangeBar).join('');
  return plans.map(plan=>{
    const selected=plan.metricIds.map(id=>p.metrics.find(m=>m.id===id)).filter(Boolean);
    if(plan.kind==='raw_score_bars')return selected.map(rangeBar).join('');
    if(plan.kind==='mean_score_bars'){
      const means=selected.map(m=>{const divisor=plan.alreadyAveragedMetricIds?.includes(m.id)?1:p.metricItemCounts[m.id];return {...m,value:finite(m.value)&&divisor>0?m.value/divisor:null,minimum:m.minimum/divisor,maximum:m.maximum/divisor};});
      return groupedBars('mean-scores','Average item scores',means,'Averages use the item membership and scoring method configured for each measure.');
    }
    if(plan.kind==='percentage_of_maximum')return groupedBars('percentage-of-maximum','Attribute scores (% of maximum)',selected.map(m=>({...m,value:finite(m.value)&&m.maximum>0?m.value/m.maximum*100:null,minimum:0,maximum:100})),'Percentage of each attribute’s maximum possible score; this is not a population percentile.');
    if(plan.kind==='endorsement_bars')return groupedBars('endorsed-items','Items endorsed (%)',selected.map(m=>({...m,value:finite(m.value)&&p.metricItemCounts[m.id]>0?m.value/p.metricItemCounts[m.id]*100:null,minimum:0,maximum:100})),'Each group uses its own item count as the denominator.');
    if(plan.kind==='percentile_bars'){
      const percentiles=selected.flatMap(m=>[...(finite(m.percentile)?[{...m,value:m.percentile,minimum:0,maximum:100}]:[]),...m.normalPercentiles.filter(r=>finite(r.value)).map(r=>({...m,label:m.label,value:r.value,minimum:0,maximum:100}))]);
      return groupedBars('reference-percentiles','Reference percentiles',percentiles,'Only configured reference conversions are plotted. Normal-distribution percentiles are approximations for the named reference population; they are not a diagnosis.');
    }
    return '';
  }).join('');
}
function comparisonReview(p){
 const source=p.sourceReport;if(!source)return '';
 const c=source.sampleComparison;
 return `<details class="review"><summary>Archived sample comparison and report configuration</summary><p>${e(c.scope)} Recovered ${c.responseCount} of ${c.questionCount} responses. Status: ${e(c.status.replaceAll('_',' '))}.</p><table><thead><tr><th>Measure</th><th>Source result</th><th>Calculated</th><th>Check</th></tr></thead><tbody>${c.comparisons.map(m=>`<tr><td>${e(m.label)}</td><td>${n(m.expected)}</td><td>${n(m.actual)}</td><td>${e(m.status.replaceAll('_',' '))}</td></tr>`).join('')}</tbody></table>${source.reviewNotes?.length?`<ul>${source.reviewNotes.map(n=>`<li>${e(n)}</li>`).join('')}</ul>`:''}<h3>Graph requirements</h3><ul>${source.graphs.map(g=>`<li>${e(g.kind.replaceAll('_',' '))}: ${e(g.status.replaceAll('_',' '))}${g.reason?' — '+e(g.reason):''}</li>`).join('')}</ul><h3>Available interpretation guidance</h3>${source.interpretation.sourceGuidance.map(g=>`<details><summary>${e(g.title||'Source guidance')}</summary><p style="white-space:pre-line">${e(g.text)}</p></details>`).join('')}<p>Guidance is retained for review. Only configured executable rules are applied to responses; the example patient's narrative is never reused.</p></details>`;
}
export function analysisReportHtml(report,{printControls=true}={}){
  const p=report.analysis,primary=p.kind==='asrs'?p.metrics.filter(m=>m.id.endsWith('_raw')):p.metrics;
  const rows=primary.map(m=>`<tr><td>${e(m.label)}</td><td>${n(m.value)} / ${n(m.maximum)}${/mean|average/.test(m.unit)?`<small>${e(m.unit)}</small>`:''}</td><td>${e(m.band||'Not configured')}</td><td>${m.lookup?`${n(m.percentile)}<small>${e(m.reference)}</small>`:m.normalPercentiles.length?m.normalPercentiles.map(r=>`${n(r.value)}<small>${e(r.label)} · normal approximation</small>`).join(''):'Not configured'}</td></tr>`).join('');
  const domains=p.kind==='asrs'?`<h2>ADHD subscales</h2><table><tr><th>Subscale</th><th>Items endorsed</th><th>Percentage</th></tr>${p.metrics.filter(m=>['inattentive_count','hyperactive_impulsive_count'].includes(m.id)).map(m=>`<tr><td>${e(m.label)}</td><td>${n(m.value)} / ${m.maximum}</td><td>${finite(m.value)?Math.round(m.value/m.maximum*100)+'%':'Unavailable'}</td></tr>`).join('')}</table>`:'';
  const summary=primary.filter(m=>finite(m.value)).map(m=>`${m.label}: ${n(m.value)}${m.band?`, in the ${m.band} score range`:''}${finite(m.percentile)?`; reference percentile ${n(m.percentile)}`:''}.`).join(' ');
  const path=report.reportPath||`/api/definition-sessions/${encodeURIComponent(report.id)}/report`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(report.title)} | Assessment report</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#24364b;background:#eef3f8;margin:0}main{max-width:1000px;margin:25px auto;padding:32px;background:white;border-radius:12px}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:13px;overflow-wrap:anywhere}th,td{text-align:left;padding:10px;border-bottom:1px solid #d9e3ec}th{background:#eef4fa}.responses{table-layout:fixed}.responses th:first-child{width:2.5rem}.responses th:last-child{width:25%}small{display:block;font-size:11px;color:#52677d}.notice{padding:12px;background:#fff3d7}.meta,.caption{color:#566c83;font-size:12px;overflow-wrap:anywhere}.caption{margin:4px 0 12px}figure{margin:24px 0;break-inside:avoid}figcaption{font-weight:650}svg{width:100%;height:auto;font-size:12px}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:#1d6593}tr{break-inside:avoid}li{margin:5px 0}@media(max-width:600px){main{padding:15px;margin:0}th,td{padding:6px}h1{font-size:24px}}@media print{body{background:white}main{padding:0;margin:0;max-width:none}nav{display:none}thead{display:table-header-group}h2{break-after:avoid}}</style></head><body><main>${printControls?`<nav><a href="/">Open app</a><a href="${e(report.downloadUrl||path+'.pdf')}">Download PDF</a></nav>`:''}<p class="meta">ASSESSMENT REPORT</p><h1>${e(report.title)}</h1><p class="meta">${e(report.patient)} · ${e(report.completedAt)}</p><p class="notice">${e(report.draftLabel)}${report.preview?' · '+e(report.previewDescription||'Fictional example responses for review.'):''}</p><h2>Results</h2>${rows?`<table><thead><tr><th>Measure</th><th>Score</th><th>Score descriptor</th><th>Reference percentile</th></tr></thead><tbody>${rows}</tbody></table>`:'<p>No numeric total is defined for this assessment.</p>'}${domains}${p.kind==='phq9'?scoreColumn(primary[0]):p.kind==='asrs'?'':plannedCharts(p)}${referenceChart(p)}${p.kind==='asrs'?endorsed(p):''}${report.visits.length>1?primary.map(trend).join(''):'<p class="caption">One visit is available. A trend appears after a compatible repeat assessment.</p>'}<h2>Score summary</h2><p>${e(summary||'Individual responses are recorded below.')}</p><p class="caption">Descriptors and reference comparisons are draft calculations, not diagnoses or conclusions about treatment response.</p><h2>Responses</h2><table class="responses"><thead><tr><th>Item</th><th>Question</th><th>Response</th></tr></thead><tbody>${report.responses.map(r=>`<tr><td>${e(r.order||r.id)}</td><td>${e(r.text)}</td><td>${e(r.value)}</td></tr>`).join('')}</tbody></table>${report.preview?comparisonReview(p):''}<h2>Coverage and limitations</h2><ul>${[...new Set([...p.limitations,...p.coverage.pending,...report.limitations])].map(displayText).filter(Boolean).map(l=>`<li>${e(l)}</li>`).join('')}</ul><p class="meta">Report configuration: ${e(p.version)} · Saved scoring engine: ${e(report.engineVersion)}<br>Definition version: ${e(report.definitionVersionId)}</p></main></body></html>`;
}
