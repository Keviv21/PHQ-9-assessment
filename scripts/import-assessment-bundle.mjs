import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, outputPath, previousPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/import-assessment-bundle.mjs <approved-bundle.json> <output.json> [previous-catalogue.json]');
  process.exit(2);
}

const source = JSON.parse(readFileSync(inputPath, 'utf8'));
if (!Array.isArray(source.assessments)) throw new Error('The source file has no assessments array.');
const previous = previousPath ? JSON.parse(readFileSync(previousPath, 'utf8')).records : [];
if (!Array.isArray(previous)) throw new Error('The previous catalogue has no records array.');
const previousById = new Map(previous.map((record) => [record.id, record]));
const previousByTitle = new Map();
for (const record of previous) {
  const matches = previousByTitle.get(record.title) || [];
  matches.push(record);
  previousByTitle.set(record.title, matches);
}
const ids = new Set();
const records = source.assessments.map((entry) => {
  const title = String(entry.assessment?.name || entry.assessment_id).trim();
  const oldTitleMatches = previousByTitle.get(title) || [];
  const old = previousById.get(entry.assessment_id) || (oldTitleMatches.length === 1 ? oldTitleMatches[0] : null);
  // Keep the catalogue ID and question/option order for already saved sessions.
  const id = old?.id || entry.assessment_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]+$/.test(id) || ids.has(id)) {
    throw new Error(`Invalid or duplicate assessment ID: ${id}`);
  }
  ids.add(id);
  const responseSets = new Map((entry.questionnaire?.response_sets || []).map((set) => [set.id, set]));
  const questions = (entry.questionnaire?.items || []).map((item, index) => {
    const options = responseSets.get(item.response_set_id)?.options || [];
    const hasUnlabelledValues = options.some((option) => !String(option.label || '').trim());
    const hasPrintedScale = hasUnlabelledValues && options.every((option) =>
      (typeof option.printed_value === 'number' && Number.isFinite(option.printed_value)) ||
      (typeof option.printed_value === 'string' && option.printed_value.trim()));
    return {
      id: String(item.id || `Q${index + 1}`),
      text: String(item.text || '').trim(),
      responseType: String(item.response_type || ''),
      selectionMode: String(item.selection_mode || ''),
      options: options.map((option, optionIndex) => ({
        id: String(option.id || `option_${optionIndex + 1}`),
        // Some forms print a numbered scale with words only at its endpoints.
        // Keep the printed number; it is a response label, not a verified score.
        label: hasPrintedScale ? `${option.printed_value}${option.label ? ` — ${String(option.label).trim()}` : ''}` :
          String(option.label || '').trim(),
      })),
    };
  });
  const incompleteItems = questions.filter((question) => !question.text || question.options.length < 2 ||
    question.options.some((option) => !option.label) ||
    !['choice', 'single_choice'].includes(question.responseType) ||
    (question.selectionMode && question.selectionMode !== 'single')).length;
  const referencePeriod = entry.assessment?.reference_period;
  const record = {
    id,
    title,
    description: String(entry.assessment?.description || '').trim(),
    referencePeriod: typeof referencePeriod === 'string' ? referencePeriod.trim() :
      typeof referencePeriod?.structured === 'string' ? referencePeriod.structured.trim() : '',
    instructions: String(entry.administration?.instructions || '').trim(),
    sourceUrl: String(entry.provenance?.source_url || '').trim(),
    extractedItemCount: questions.length,
    incompleteItems,
    previewAvailable: questions.length > 0 && incompleteItems === 0,
    scoringAvailable: false,
    reviewStatus: 'Needs clinical review',
    questions: questions.map(({ responseType, selectionMode, ...question }) => question),
  };
  // Existing live sessions store option indexes. Replacing their form would silently
  // reinterpret answers, so keep complete forms until sessions have versioned snapshots.
  return old?.previewAvailable ? {
    ...old,
    description: record.description,
    referencePeriod: old.referencePeriod === '[object Object]' ? record.referencePeriod : old.referencePeriod,
  } : record;
});

if (previous.length && (records.length !== previous.length || previous.some((record) => !ids.has(record.id)))) {
  throw new Error('The repaired bundle does not map one-to-one to the previous catalogue.');
}
records.sort((a, b) => a.title.localeCompare(b.title, 'en'));
writeFileSync(outputPath, `${JSON.stringify({ sourceCount: records.length, records }, null, 2)}\n`, 'utf8');
const nowAvailable = records.filter((record) => record.previewAvailable);
const newlyAvailable = nowAvailable.filter((record) => !previousById.get(record.id)?.previewAvailable);
console.log(`Imported ${records.length} catalogue records; ${nowAvailable.length} have complete answer options (${newlyAvailable.length} newly available).`);
