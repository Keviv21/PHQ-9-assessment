import { chromium } from "playwright-core";
import { HttpError } from "./errors.js";
import { reportHtml } from "./report.js";

let running = 0;
export async function reportPdf(report) {
  if (running >= 2) throw new HttpError(503, "PDF renderer is busy. Please retry shortly.");
  running++;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000,
      ...(process.env.REPORT_CHROMIUM_PATH ? { executablePath: process.env.REPORT_CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    // No report content, fonts, images or scripts can be fetched from a URL.
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    await page.setContent(reportHtml(report), { waitUntil: "domcontentloaded", timeout: 15000 });
    return await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: true,
      headerTemplate: "<span></span>", footerTemplate: '<div style="font-size:9px;text-align:center;width:100%;color:#64748b">' + (report.preview ? 'SYNTHETIC DEVELOPMENT PREVIEW' : 'Assessment report') + ' · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: "14mm", bottom: "18mm", left: "12mm", right: "12mm" }, timeout: 20000 });
  } catch (e) {
    if (e.status) throw e;
    throw new HttpError(503, "Local PDF renderer unavailable. Install Chromium with npm run reports:install-browser, or configure REPORT_CHROMIUM_PATH. The HTML report remains available.");
  } finally {
    try { await browser?.close(); } finally { running--; }
  }
}
