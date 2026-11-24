import {chromium} from 'playwright-core';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {analysisPreviewReport} from '../src/analysis-preview.js';
import {sampleState} from '../src/assessment-review.js';
import {buildDefinitionReport,definitionReportHtml} from '../src/definition-report.js';
const library=resolve(process.argv[2]||'local-data/assessment-analysis/assessment-library.json'),out=resolve(process.argv[3]||'local-data/assessment-analysis/browser-validation');
const {records}=JSON.parse(await readFile(library,'utf8'));
await mkdir(join(out,'pdfs'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.REPORT_CHROMIUM_PATH||'/opt/google/chrome/chrome'});
const errors=[],results=[];
try{
 const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
 await context.route('**/*',r=>{errors.push('Unexpected external request: '+r.request().url());return r.abort();});
 const page=await context.newPage();
 for(const d of records){
  for(const scenario of ['single','repeated','missing']){
   const report=scenario==='missing'?buildDefinitionReport(sampleState(d,'missing')):analysisPreviewReport(d,{repeated:scenario==='repeated'});
   const html=definitionReportHtml(report,{printControls:false});
   await page.setViewportSize({width:1280,height:900});await page.setContent(html);
   if(await page.evaluate(()=>[...document.querySelectorAll('svg *')].flatMap(e=>[...e.attributes]).some(a=>/NaN|Infinity|undefined/.test(a.value))))errors.push(`${d.id}/${scenario}: invalid geometry`);
   if(scenario==='missing'&&await page.locator('svg').count())errors.push(`${d.id}: missing scores plotted`);
   if(scenario==='single'){
    const pdf=await page.pdf({format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});
    if(pdf.subarray(0,5).toString()!=='%PDF-')errors.push(`${d.id}: PDF invalid`);
    await writeFile(join(out,'pdfs',d.id+'.pdf'),pdf);
    if(['asrs','phq9'].includes(report.analysis.kind))await page.screenshot({path:join(out,report.analysis.kind+'-desktop.png'),fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))errors.push(`${d.id}/${scenario}: mobile overflow`);
   if(scenario==='single'&&['asrs','phq9'].includes(report.analysis.kind))await page.screenshot({path:join(out,report.analysis.kind+'-mobile.png'),fullPage:true});
  }
  results.push(d.id);if(results.length%25===0)console.log(`Checked ${results.length}/${records.length}`);
 }
}finally{await browser.close();}
const result={status:errors.length?'failed':'passed',assessments:results.length,scenarios:results.length*3,pdfs:results.length,mobileWidth:390,errors};
await writeFile(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
