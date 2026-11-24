// Offline compiler. Never loads .env, PostgreSQL, or a shared data store.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {compileAnalysisProfile,freezeAnalysisVersion} from '../src/analysis-profile-compiler.js';
import {hashBytes} from '../src/assessment-content.js';
const args=process.argv.slice(2),source=args[0],out=resolve(args[1]||'local-data/assessment-analysis');
if(!source||args.length>2)throw Error('Usage: node scripts/prepare-analysis-library.mjs <all-assessments.json> [new-output-directory]');
const baseline=JSON.parse(await readFile(new URL('../data/assessment-library.json',import.meta.url),'utf8'));
const rawBytes=await readFile(resolve(source));
if(hashBytes(rawBytes)!==baseline.bundleHash)throw Error('Extraction checksum differs from the runtime baseline.');
const raw=JSON.parse(rawBytes),rawMap=new Map(raw.assessments.map(r=>[r.assessment_id,r]));
const asrs=JSON.parse(await readFile(new URL('../data/report-profiles/asrs.json',import.meta.url),'utf8'));
const phq=JSON.parse(await readFile(new URL('../data/report-profiles/phq9-source.json',import.meta.url),'utf8'));
const records=baseline.records.map(d=>freezeAnalysisVersion(rawMap.get(d.id),compileAnalysisProfile(d,asrs,phq)));
const assessments=records.map(d=>({id:d.id,title:d.title,mode:d.reporting.mode,questionCount:d.questions.length,coverage:d.reporting.analysisProfile.coverage,sourceEquivalence:d.reporting.analysisProfile.sourceEquivalence,evidence:d.reporting.analysisProfile.evidence,existingGaps:[...d.remainingWork,...d.scoringLimitations,...d.verification.remainingWork,...d.reviewIssues.map(i=>i.detail)]}));
const manifest={...baseline.manifest,assessmentCount:records.length,scoringRules:records.reduce((n,d)=>n+d.rules.length,0),sourceBandedAssessments:records.filter(d=>d.reporting.analysisProfile.metrics.some(m=>m.bands.length)).length,exactLookupAssessments:records.filter(d=>d.reporting.analysisProfile.metrics.some(m=>m.lookup)).length,completeSourceReportEquivalenceVerified:0,clinicalApproved:0,databaseAccess:'none',purpose:'Local review only; not authorized for shared import'};
await mkdir(out,{recursive:false,mode:0o700});
await mkdir(join(out,'definitions'));await mkdir(join(out,'profiles'));
const save=(path,value)=>writeFile(join(out,path),JSON.stringify(value,null,2)+'\n');
for(const d of records){await save(`definitions/${d.id}.json`,d);await save(`profiles/${d.id}.json`,d.reporting.analysisProfile);}
const bytes=JSON.stringify({schemaVersion:1,bundleHash:baseline.bundleHash,manifest,records});
await writeFile(join(out,'assessment-library.json'),bytes+'\n');
await writeFile(join(out,'assessment-library.json.sha256'),hashBytes(bytes+'\n')+'  assessment-library.json\n');
await save('readiness.json',{manifest,assessments});
await save('review-candidate.json',{schemaVersion:1,kind:'review_only_not_authorized_for_import',bundleHash:baseline.bundleHash,records:records.map(runtime=>({raw:rawMap.get(runtime.id),runtime}))});
console.log(JSON.stringify({out,...manifest},null,2));
