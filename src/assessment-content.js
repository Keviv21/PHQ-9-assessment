import { createHash } from 'node:crypto';
import { reportProfileFor } from './report-profiles.js';

export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const contentHash = value => hashBytes(stableJson(value));

// Presentation only. Original text, citations and provenance stay in the private definition.
export function displayText(value) {
  return String(value ?? '').split('\n').map(paragraph => paragraph.split(/(?<=[.!?])\s+/u)
    .filter(line => !/novop[sy]+ch|administer now|back to assessments|professional access/i.test(line)).join(' '))
    .filter(Boolean).join('\n').replace(/https?:\/\/[^\s<>]+/gi, '').trim();
}
export const displayTitle = value => String(value ?? '').replace(/\bNovoPsych(?:’s|'s)?\s*/gi, '').trim();
function displayValue(value) {
  if (typeof value === 'string') return displayText(value);
  if (Array.isArray(value)) return value.map(displayValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/url|archive_path|source_provider|provenance/i.test(k)).map(([k, v]) => [k, displayValue(v)]));
  return value;
}

export function validateBundle(bundle) {
  if (!Array.isArray(bundle.assessments) || !bundle.assessments.length) throw new Error('Missing assessments.');
  const ids = new Set();
  for (const entry of bundle.assessments) {
    if (!entry.assessment_id || !entry.definition_version || ids.has(entry.assessment_id)) throw new Error('Missing or duplicate assessment identity.');
    ids.add(entry.assessment_id);
    const items = entry.questionnaire?.items;
    if (!Array.isArray(items) || !Array.isArray(entry.scoring?.rules) || !entry.reporting || !entry.verification) throw new Error(`Incomplete definition: ${entry.assessment_id}`);
    const itemIds = new Set(items.map(q => q.id));
    const rules = new Map(entry.scoring.rules.map(r => [r.id, r]));
    if (itemIds.size !== items.length || rules.size !== entry.scoring.rules.length) throw new Error('Duplicate item or scoring rule.');
    for (const rule of rules.values()) if (!Array.isArray(rule.item_ids) || rule.item_ids.some(id => !itemIds.has(id))) throw new Error(`Invalid rule membership: ${rule.id}`);
    for (const metric of entry.reporting.metrics || []) {
      const rule = rules.get(metric.rule_id);
      if (!rule || stableJson(rule.item_ids) !== stableJson(metric.item_ids) || rule.minimum !== metric.minimum || rule.maximum !== metric.maximum || rule.method !== metric.calculation_method) throw new Error(`Invalid report metric: ${metric.rule_id}`);
    }
    for (const group of entry.reporting.response_groups || []) if (group.item_ids.some(id => !itemIds.has(id))) throw new Error(`Invalid response group: ${group.id}`);
    if (entry.verification.definition_version !== entry.definition_version) throw new Error('Stale verification version.');
  }
  return bundle;
}

export function normalizeDefinition(entry, { bundleHash, versionId = contentHash(entry), verified = false } = {}) {
  const definition = {
    id: entry.assessment_id, version: entry.definition_version, versionId, sourceSha256: bundleHash,
    title: displayTitle(entry.assessment.name), description: displayText(entry.assessment.description),
    administration: displayText(entry.administration.instructions),
    referencePeriod: displayValue(entry.assessment.reference_period), language: entry.assessment.language || 'en',
    metadata: displayValue(Object.fromEntries(['short_name', 'respondent_type', 'target_population', 'intended_uses', 'estimated_administration_minutes'].map(k => [k, entry.assessment[k] ?? null]))),
    questions: entry.questionnaire.items.map(item => ({ id: item.id, order: item.order, text: item.text,
      responseType: item.response_type, selectionMode: item.selection_mode, inputSpec: item.input_spec,
      displayIf: item.display_if ?? null, options: item.options ?? [], sourceLabel: item.source_label })),
    rules: entry.scoring.rules.map(({ source, ...rule }) => rule), scoringStatus: entry.scoring.status, scoringEnabled: entry.scoring.enabled === true,
    scoringLimitations: (entry.scoring.limitations || []).map(displayText).filter(Boolean),
    remainingWork: (entry.scoring.remaining_work || []).map(displayText).filter(Boolean),
    clinicallyApproved: false, questionnaireVerified: entry.review.questionnaire_completeness_verified === true,
    reviewIssues: (entry.review.issues || []).map(({ code, detail }) => ({ code, detail: displayText(detail) })),
    sections: (entry.context_sections || []).map(s => ({ id: s.id, title: displayText(s.title), text: displayText(s.text) })).filter(s => s.title && s.text),
    sourceGuidance: (entry.scoring.source_guidance || []).map(s => ({ title: displayText(s.title), text: displayText(s.text) })).filter(s => s.title && s.text),
    tables: displayValue(entry.tables || []), reporting: { ...displayValue(entry.reporting), ...(reportProfileFor(entry.assessment_id) ? { visualProfile: reportProfileFor(entry.assessment_id) } : {}) },
    references: (entry.references || []).map(r => displayText(r.citation)).filter(Boolean),
    verification: { status: entry.verification.status, contentVerified: verified, rules: entry.verification.rules,
      remainingWork: (entry.verification.remaining_work || []).map(displayText).filter(Boolean), clinicalApproved: false },
    assets: [],
  };
  definition.runtimeHash = scoringRuntimeHash(definition);
  return definition;
}

export function scoringRuntimeHash(d) {
  return contentHash({ id: d.id, version: d.version, questions: d.questions, rules: d.rules, administration: d.administration });
}

// Do not expose archived documents, source paths, or source-only metadata via session APIs.
export function publicDefinition(d) {
  if (!d) return null;
  const allowed = ['id', 'version', 'versionId', 'title', 'description', 'administration', 'referencePeriod', 'language', 'metadata',
    'questions', 'rules', 'scoringStatus', 'scoringLimitations', 'remainingWork', 'clinicallyApproved', 'questionnaireVerified',
    'reviewIssues', 'sections', 'sourceGuidance', 'tables', 'reporting', 'references', 'assets', 'runtimeHash'];
  return Object.fromEntries(allowed.filter(k => d[k] !== undefined).map(k => [k,
    ['id', 'version', 'versionId', 'runtimeHash'].includes(k) ? d[k] : k === 'title' ? displayTitle(d[k]) : displayValue(d[k])]));
}
export const publicSession = state => state && { ...state, formSnapshot: publicDefinition(state.formSnapshot) };
