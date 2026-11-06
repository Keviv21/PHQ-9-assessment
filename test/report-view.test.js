import test from 'node:test';
import assert from 'node:assert/strict';
import { form } from '../src/assessment.js';
import { openStore } from '../src/store.js';
import { renderReport } from '../public/report-view.js';

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
