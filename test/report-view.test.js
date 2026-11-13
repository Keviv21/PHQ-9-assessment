import test from 'node:test';
import assert from 'node:assert/strict';
import { form, getForm } from '../src/assessment.js';
import { openStore } from '../src/store.js';
import { renderReport } from '../public/report-view.js';
import { getAssessmentForm } from '../src/forms.js';

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
      assert.match(container.textContent, formId === 'pcl5' ? /no established severity bands/ : /SCORE BAND/);
      assert.match(container.textContent, /not a diagnosis/);
    }
  } finally {
    store.close();
    globalThis.document = previousDocument;
  }
});
