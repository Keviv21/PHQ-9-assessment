// Starts the real dev server against a fresh, private SQLite database. No dotenv loading.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const library=resolve(process.argv[2]||join(root,'local-data/assessment-analysis/assessment-library.json'));
await access(library);
await mkdir(join(root,'local-data'),{recursive:true});
const dir=await mkdtemp(join(root,'local-data/analysis-sandbox-'));
const port=process.env.ANALYSIS_PREVIEW_PORT||'4189';
const child=spawn(process.execPath,['src/server.js'],{cwd:root,stdio:'inherit',env:{...process.env,
  NODE_ENV:'development',DATABASE_URL:'',ALLOW_SQLITE_TEST_BACKEND:'true',DB_PATH:join(dir,'review.sqlite'),PORT:port,GEMINI_API_KEY:'',
  ASSESSMENT_LIBRARY_FILE:library,ASSESSMENT_DRAFT_SCORES:'true',ASSESSMENT_ANALYSIS_PREVIEW:'true',
  REPORT_CHROMIUM_PATH:process.env.REPORT_CHROMIUM_PATH||'/opt/google/chrome/chrome'}});
console.log(`Isolated dev app: http://localhost:${port}\nReport review: http://localhost:${port}/preview/analysis\nLocal SQLite: ${dir}\nShared PostgreSQL disabled. Synthetic examples only.`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code||0;});
