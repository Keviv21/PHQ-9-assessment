import test from 'node:test';
import assert from 'node:assert/strict';
import { form, getForm } from '../src/assessment.js';
import { openStore } from '../src/store.js';
import { renderDASS21Report, renderDefinitionReport, renderDraftReport, renderReport } from '../../frontend/src/controllers/report-view.js';
import { getAssessmentForm } from '../src/forms.js';
import { getDraftAssessment, listDraftAssessments } from '../src/draft-library.js';
import { dass21DraftId } from '../src/draft-scoring.js';
import { openDraftStore } from '../src/draft-store.js';
import { getDefinition } from '../src/definition-library.js';
import { openDefinitionStore } from '../src/definition-store.js';
import { withIndividualReport } from '../src/individual-report.js';

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.content = ''; }
  set textContent(value) { this.content = value; this.children = []; }
  get textContent() { return this.content + this.children.map((child) => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.content = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

test('completed result renders score, all responses, safety notice, and printable link', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openStore(':memory:');
  try {
    const assessment = store.create('demo');
    let state;
    for (let number = 1; number <= 9; number++) state = store.record(assessment.id, number, number === 9 ? 1 : 0, 'demo');
    state = store.finalize(assessment.id, state.answers.map((answer) => answer.value));
    const container = new FakeElement('main');
    renderReport(container, state, form, { printableLink: true });
    const text = container.textContent;
    assert.match(text, /1 \/ 27/);
    assert.match(text, /No or minimal/);
    assert.match(text, /Little interest or pleasure/);
    assert.match(text, /Thoughts that you would be better off dead/);
    assert.match(text, /Please contact a qualified clinician promptly/);
    assert.match(text, /Open printable report/);
    const link = container.children[0].children.at(-1);
    assert.equal(link.href, `/report.html?id=${assessment.id}`);
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});

test('Hindi saved result renders the Hindi questions, scale, and safety notice', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openStore(':memory:');
  try {
    const assessment = store.create('demo', 'hi');
    let state;
    for (let number = 1; number <= 9; number++) state = store.record(assessment.id, number, number === 9 ? 1 : 0, 'demo');
    state = store.finalize(assessment.id, state.answers.map((answer) => answer.value));
    const container = new FakeElement('main');
    renderReport(container, state, getForm('hi'), { printableLink: true });
    assert.match(container.textContent, /पुष्टि किए गए उत्तर/);
    assert.match(container.textContent, /एक भी दिन नहीं/);
    assert.match(container.textContent, /कृपया जल्द किसी योग्य चिकित्सक से संपर्क करें/);
    assert.match(container.textContent, /प्रिंट करने योग्य रिपोर्ट खोलें/);
    assert.throws(() => renderReport(container, state, form), /language does not match/);
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});

test('GAD-7 and PCL-5 reports show all responses and only supported score interpretations', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openStore(':memory:');
  try {
    for (const [formId, count, maximum] of [['gad7', 7, 21], ['pcl5', 20, 80]]) {
      let state = store.create('demo', 'en', 'demo-a', formId);
      for (let number = 1; number <= count; number++) state = store.record(state.id, number, formId === 'pcl5' ? 4 : 3, 'demo');
      state = store.finalize(state.id, state.answers.map((answer) => answer.value));
      const container = new FakeElement('main');
      renderReport(container, state, getAssessmentForm(formId), { printableLink: true });
      assert.match(container.textContent, new RegExp(`${maximum} / ${maximum}`));
      assert.ok(container.textContent.includes(getAssessmentForm(formId).questions[count - 1].text));
      if (formId === 'pcl5') assert.doesNotMatch(container.textContent, /SCORE BAND/);
      else assert.match(container.textContent, /SCORE BAND/);
      assert.doesNotMatch(container.textContent, /not a diagnosis|clinically validated/i);
    }
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});

test('completed DASS-21 assignment renders a printable report with subscales and final answers', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openDraftStore(':memory:');
  try {
    const prescription = store.prescribe('demo-b', dass21DraftId);
    const session = store.startPrescription(prescription.id, 'demo');
    for (let number = 1; number <= 21; number++) store.record(session.id, number, 0, 'demo');
    const finalAnswers = Array(21).fill(0);
    finalAnswers[2] = 3;
    const completed = store.finalize(session.id, finalAnswers);
    const container = new FakeElement('main');
    renderDASS21Report(container, completed, getDraftAssessment(dass21DraftId));
    assert.match(container.textContent, /ASSESSMENT REPORT/);
    assert.match(container.textContent, /3 \/ 63/);
    assert.match(container.textContent, /Depression 3 \/ 21 6/);
    assert.match(container.textContent, /Confirmed responses/);
    assert.ok(container.textContent.includes(getDraftAssessment(dass21DraftId).questions[20].text));
    assert.doesNotMatch(container.textContent, /not a diagnosis|clinically validated/i);
    assert.throws(() => renderDASS21Report(container, { ...completed, status: 'review' }, getDraftAssessment(dass21DraftId)), /completed DASS-21/);

    const sourceReport = withIndividualReport(completed, 'draft');
    renderDraftReport(container, sourceReport, getDraftAssessment(dass21DraftId));
    assert.match(container.textContent, /3 \/ 63/);
    assert.match(container.textContent, /Depression raw 3 0–21/);
    assert.match(container.textContent, /Depression doubled 6 0–42/);
    assert.match(container.textContent, /Draft test report/);
    assert.doesNotMatch(container.textContent, /Normal|Extremely severe/);
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});

test('completed imported review opens the same report layout without inventing a score', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openDraftStore(':memory:');
  try {
    const draft = listDraftAssessments().find((item) => item.title === 'Flourishing Scale (FS)');
    const form = getDraftAssessment(draft.id);
    let state = store.create(draft.id, 'demo');
    for (let number = 1; number <= form.questions.length; number++) {
      state = store.record(state.id, number, 0, 'demo');
    }
    state = store.finalize(state.id, state.answers.map((answer) => answer.value));
    const container = new FakeElement('main');
    renderDraftReport(container, state, form);
    assert.match(container.textContent, /ASSESSMENT REPORT/);
    assert.match(container.textContent, /No score available/);
    assert.ok(container.textContent.includes(form.questions[0].text));
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});

test('completed catalogue assignment renders draft metrics and recorded responses in the common report', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const store = openDefinitionStore({ path: ':memory:' });
  try {
    const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
    const prescription = await store.prescribe('demo-a', form.id);
    const session = await store.start(prescription.id);
    const answers = Object.fromEntries(form.questions.map((item) => [item.id, item.options[0].id]));
    const completed = await store.save(session.id, answers, true);
    const container = new FakeElement('main');
    renderDefinitionReport(container, completed);
    assert.match(container.textContent, /ASSESSMENT REPORT/);
    assert.match(container.textContent, /Scoring results/);
    assert.ok(container.textContent.includes(form.questions[0].text));
    assert.doesNotMatch(container.textContent, /Draft raw calculations|No clinical validation/);
  } finally {
    await store.close();
    globalThis.document = previousDocument;
  }
});
