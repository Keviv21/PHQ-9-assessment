import pg from 'pg';
import { scoringRuntimeHash } from '../src/assessment-content.js';
import { analysisPreviewReport } from '../src/analysis-preview.js';
import { definitionReportHtml } from '../src/definition-report.js';

const pilots = [
  'generalised-anxiety-disorder-assessment-gad-7--265a24c61d94',
  'patient-health-questionnaire-depression-phq-9--8f81b7b3270c',
  'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b',
  'athens-insomnia-scale-ais--456d2e3fe9f5',
  'who-quality-of-life-brief-whoqol-bref--376334616502',
  'ptsd-checklist-5-pcl-5--5a88422b610e',
  'adult-adhd-self-report-scale-asrs--814829bfeff1',
  'ask-suicide-screening-questionnaire-asq--738914ed7416',
  'life-events-checklist-5-lec-5--a26ee0fc9afc',
  'manic-and-depression-symptoms-paired-screening-pmq-9-and-phq-9--d03a749c0f38',
];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(`SELECT a.id, v.runtime, p.runtime_profile,
      p.id AS profile_version_id, p.validation
    FROM pod_assessment_prototype.assessment_library a
    JOIN pod_assessment_prototype.assessment_versions v ON v.id=a.active_version_id
    JOIN pod_assessment_prototype.assessment_report_profiles arp ON arp.assessment_id=a.id
    JOIN pod_assessment_prototype.report_profile_versions p ON p.id=arp.active_profile_version_id
    WHERE a.id=ANY($1::text[])`, [pilots]);
  if (rows.length !== pilots.length) throw new Error('One or more pilot report profiles are missing.');
  const checks = rows.map((row) => {
    if (row.runtime.reporting?.analysisProfile) throw new Error(`Private profile leaked into assessment runtime: ${row.id}`);
    const definition = structuredClone(row.runtime);
    definition.reporting.analysisProfile = row.runtime_profile;
    if (row.runtime_profile.profileVersionId !== row.profile_version_id ||
        row.runtime_profile.scoringHash !== scoringRuntimeHash(definition)) {
      throw new Error(`Report profile linkage is stale: ${row.id}`);
    }
    const report = analysisPreviewReport(definition);
    report.preview = false;
    const html = definitionReportHtml(report, { printControls: false });
    if (!html.includes(definition.title) || report.reportProfileVersionId !== row.profile_version_id) {
      throw new Error(`Pilot report does not contain its saved title/profile version: ${row.id}`);
    }
    return { assessmentId: row.id, profileVersionId: row.profile_version_id,
      mode: definition.reporting.mode, metrics: report.metrics.length,
      sourceComparison: row.validation.sourceComparison,
      fullEquivalence: row.validation.fullEquivalence };
  });
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ status: 'passed', databaseOnly: true, pilots: checks }, null, 2));
} finally {
  await client.end();
}
