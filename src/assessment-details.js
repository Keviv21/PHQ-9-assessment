import { assessmentCategories, assessmentSourceVersion, getAssessmentEntry } from './assessment-source.js';

function plain(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function narrativeSections(entry, pattern, limit = 5) {
  const seen = new Set();
  const selected = [];
  for (const section of entry.context_sections || []) {
    const title = plain(section.title);
    const text = plain(section.text);
    if (!pattern.test(title) || text.length < 80) continue;
    const key = `${title.toLowerCase()}\0${text.replace(/\s+/g, ' ').slice(0, 180).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ title, text });
    if (selected.length >= limit) break;
  }
  return selected;
}

export const assessmentDetailVersion = assessmentSourceVersion;

export function getAssessmentDetail(id) {
  const entry = getAssessmentEntry(id);
  if (!entry) return null;
  const assessment = entry.assessment || {};
  const questionnaire = entry.questionnaire || {};
  const reporting = entry.reporting || {};
  const firstSourceText = plain(entry.context_sections?.[0]?.text);
  const minutes = assessment.estimated_administration_minutes ||
    Number(/\b(\d{1,3})\s+minutes\b/i.exec(firstSourceText)?.[1]) || null;
  const ageLine = firstSourceText.split('\n').map((line) => line.trim())
    .find((line) => /^Ages?\s+\d{1,3}(?:\s*[-–]\s*\d{1,3}|\+)?(?:\s*years?)?$/i.test(line));
  const ageLabel = plain(assessment.target_population).length <= 70 ?
    plain(assessment.target_population) || plain(ageLine) : plain(ageLine);
  const rules = new Map((entry.scoring?.rules || []).map((rule) => [rule.id, rule]));
  return {
    id: entry.assessment_id,
    version: entry.definition_version,
    title: plain(assessment.name) || entry.assessment_id,
    shortName: plain(assessment.short_name),
    description: plain(assessment.description),
    language: plain(assessment.language) || 'en',
    ageLabel,
    minutes,
    respondentType: plain(assessment.respondent_type),
    referencePeriod: assessment.reference_period?.structured?.label ||
      assessment.reference_period?.instruction_claims?.[0] || '',
    administration: plain(entry.administration?.instructions),
    questionCount: questionnaire.items?.length || 0,
    previewQuestions: (questionnaire.items || []).slice(0, 5).map((item) => ({
      id: item.id,
      text: plain(item.text),
      options: (item.options || []).slice(0, 5).map((option) => plain(option.text)),
    })),
    sections: {
      overview: narrativeSections(entry, /overview|about this|what is/i, 4),
      scoring: narrativeSections(entry, /scor|interpret|norm|cut.?off/i, 5),
      psychometrics: narrativeSections(entry, /psychometr|reliab|valid|accuracy/i, 5),
    },
    reporting: {
      mode: reporting.mode || 'unavailable',
      metrics: (reporting.metrics || []).map((metric) => ({
        id: metric.rule_id,
        label: plain(metric.label) || metric.rule_id,
        minimum: metric.minimum,
        maximum: metric.maximum,
        method: plain(metric.calculation_method),
        severityBands: (rules.get(metric.rule_id)?.severity_bands || []).map((band) => ({
          label: plain(band.label), minimum: band.minimum, maximum: band.maximum,
        })),
      })),
    },
    references: (entry.references || []).map((reference) => plain(reference.citation)).filter(Boolean),
    categories: assessmentCategories[id] || ['Other'],
  };
}
