import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--dir') throw new Error('Usage: node scripts/check-assessment-review-browser.mjs --dir <review-directory>');
const root = resolve(args[1]);
const { assessments } = JSON.parse(await readFile(join(root, 'readiness.json'), 'utf8'));
const output = join(root, 'browser-validation');
await mkdir(join(output, 'pdfs'), { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REPORT_CHROMIUM_PATH || '/opt/google/chrome/chrome' });
const errors = [], results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { errors.push(`Unexpected external request: ${route.request().url()}`); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(await readFile(join(root, 'index.html'), 'utf8'));
  if (await page.locator('tbody tr').count() !== 186) throw new Error('Incomplete catalogue.');
  await page.locator('#search').fill('PHQ-9');
  if (await page.locator('tbody tr:visible').count() !== assessments.filter(d => d.title.toLowerCase().includes('phq-9')).length) throw new Error('Catalogue search failed.');
  await page.locator('#search').fill('');
  await page.screenshot({ path: join(output, 'catalogue.png') });
  for (const [i, d] of assessments.entries()) {
    let svgCount = 0;
    for (const scenario of ['single', 'repeated', 'missing']) {
      const html = await readFile(join(root, 'previews', `${d.assessmentId}.${scenario}.html`), 'utf8');
      await page.setContent(html, { waitUntil: 'load' });
      const invalid = await page.evaluate(() => [...document.querySelectorAll('svg *')].flatMap(el => [...el.attributes]).some(a => /(?:NaN|Infinity|undefined)/.test(a.value)));
      if (invalid) throw new Error(`Invalid SVG geometry: ${d.assessmentId}/${scenario}`);
      if (await page.locator('tbody tr').count() < d.questionCount) throw new Error(`Response table incomplete: ${d.assessmentId}`);
      if (scenario === 'single') {
        svgCount = await page.locator('svg').count();
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
        if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF.');
        await writeFile(join(output, 'pdfs', `${d.assessmentId}.pdf`), pdf, { mode: 0o600 });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) errors.push(`Mobile page overflow: ${d.assessmentId}/${scenario}`);
      if (d.assessmentId.startsWith('patient-health-questionnaire-depression-phq-9--') && scenario === 'repeated') {
        await page.screenshot({ path: join(output, 'phq9-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1360, height: 900 });
        await page.screenshot({ path: join(output, 'phq9-desktop.png'), fullPage: true });
      }
      await page.setViewportSize({ width: 1360, height: 900 });
    }
    results.push({ assessmentId: d.assessmentId, scenarios: 3, currentScoreCharts: svgCount, pdfGenerated: true });
    if ((i + 1) % 25 === 0) console.log(`Browser/PDF checks: ${i + 1}/${assessments.length}`);
  }
} finally { await browser.close(); }
const result = { status: errors.length ? 'failed' : 'passed', assessments: results.length, htmlPreviews: results.length * 3, pdfs: results.length, mobileWidthsChecked: [390], externalRequestsAllowed: false, errors, results };
await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ...result, results: undefined }, null, 2));
if (errors.length) process.exitCode = 1;
