import { chromium } from 'playwright-core';
import { definitionReportHtml } from './definition-report.js';

let active = 0;
export async function definitionReportPdf(report) {
  if (active >= 2) throw Object.assign(new Error('PDF renderer busy. Please retry shortly.'), { status: 503 });
  active++;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000,
      ...(process.env.REPORT_CHROMIUM_PATH ? { executablePath: process.env.REPORT_CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(definitionReportHtml(report, { printControls: false }), { timeout: 15000 });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' }, timeout: 20000 });
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('PDF renderer unavailable. Configure REPORT_CHROMIUM_PATH or install Chromium. The report can still be printed from your browser.'), { status: 503 });
  } finally { try { await browser?.close(); } finally { active--; } }
}
