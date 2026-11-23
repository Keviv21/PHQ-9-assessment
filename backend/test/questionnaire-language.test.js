import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefinition } from '../src/definition-library.js';
import { getLiveDraftForm } from '../src/draft-library.js';
import { dass21DraftId } from '../src/draft-scoring.js';
import { getAssessmentForm } from '../src/forms.js';
import { createQuestionnaireLocalizer, definitionQuestionnaire } from '../src/questionnaire-language.js';

test('questionnaire translation preserves answer IDs, values and rules and reuses repeated text', async () => {
  const requests = [];
  const localize = createQuestionnaireLocalizer({ generate: async (request) => {
    requests.push(request);
    return { output_text: JSON.stringify({ translations: JSON.parse(request.input).map((text) => `अनुवाद ${text}`) }) };
  } });
  const draft = getLiveDraftForm(dass21DraftId);
  const [hindiDraft, concurrent] = await Promise.all([localize(draft, 'hi'), localize(draft, 'hi')]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].store, false);
  assert.match(requests[0].system_instruction, /Hindi/);
  assert.equal(JSON.parse(requests[0].input).filter((text) => text === 'NEVER').length, 1);
  assert.deepEqual(concurrent, hindiDraft);
  assert.match(hindiDraft.instructions, /^अनुवाद/);
  assert.equal(hindiDraft.machineTranslated, true);
  assert.deepEqual(hindiDraft.questions.map(({ id }) => id), draft.questions.map(({ id }) => id));
  assert.deepEqual(hindiDraft.questions[0].options.map(({ value }) => value), [0, 1, 2, 3]);
  assert.equal(hindiDraft.questions[0].options[0].label, 'अनुवाद NEVER');
  assert.equal(draft.questions[0].options[0].label, 'NEVER');

  const definition = definitionQuestionnaire(getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1'));
  const localized = await localize(definition, 'hi');
  assert.match(localized.referencePeriod, /^अनुवाद/);
  assert.deepEqual(localized.questions[0].inputSpec, definition.questions[0].inputSpec);
  assert.equal(localized.questions[0].options[0].id, definition.questions[0].options[0].id);
  assert.equal(localized.questions[0].options[0].score, definition.questions[0].options[0].score);

  const bundled = await localize(getAssessmentForm('phq9'), 'hi');
  assert.equal(requests.length, 2);
  assert.deepEqual(bundled, getAssessmentForm('phq9', 'hi'));
});

test('incomplete translations fail and can be retried', async () => {
  let calls = 0;
  const localize = createQuestionnaireLocalizer({ generate: async ({ input }) => {
    const translations = ++calls === 1 ? [] : JSON.parse(input).map((text) => `Traducción ${text}`);
    return { output_text: JSON.stringify({ translations }) };
  } });
  const form = getAssessmentForm('pcl5');
  await assert.rejects(localize(form, 'unsupported'), /Unsupported/);
  await assert.rejects(localize(form, 'es'), /Unable to translate/);
  const spanish = await localize(form, 'es');
  assert.equal(spanish.language, 'es');
  assert.equal(spanish.questions.length, form.questions.length);
  assert.deepEqual(spanish.options.map(({ value }) => value), [0, 1, 2, 3, 4]);
});
