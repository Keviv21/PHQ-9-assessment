import { listDefinitions, getDefinition } from '../src/definition-library.js';
for (const term of process.argv.slice(2)) {
  const entry = listDefinitions().find((item) => item.title.toLowerCase().includes(term.toLowerCase()));
  if (!entry) continue;
  const form = getDefinition(entry.id);
  console.log(JSON.stringify({ title: form.title, id: form.id,
    questions: form.questions.filter((item) => item.id === 'Q5' || item.id === 'Q6' || item.id === 'Q25' || item.id === 'Q26'),
    rules: form.rules.filter((rule) => rule.id === 'source_draft_1' || rule.id === 'source_draft_5' || rule.id === 'source_draft_6')
      .map((rule) => ({ id: rule.id, item_ids: rule.item_ids,
        optional_item_ids: rule.optional_item_ids,
        ineligible_item_policy: rule.ineligible_item_policy,
        applies_if: rule.applies_if,
        context_constraints: rule.context_constraints })),
  }, null, 2));
}
