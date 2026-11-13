import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiBridge } from '../src/gemini-bridge.js';
import { openDraftStore } from '../src/draft-store.js';
import { getLiveDraftForm } from '../src/draft-library.js';
import { getForm } from '../src/assessment.js';
import { openStore } from '../src/store.js';

test('conversational mapping waits for confirmation and asks the next PHQ-9 item', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    const events = [];
    const bridge = new GeminiBridge({
      apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => events.push({ type: 'browser', value: JSON.parse(raw) }) },
      store, assessmentId: assessment.id, onState: (state) => events.push({ type: 'state', value: state }),
    });
    bridge.session = {
      sendToolResponse: (value) => events.push({ type: 'tool_response', value }),
      sendClientContent: (value) => events.push({ type: 'next_prompt', value }),
    };
    await bridge.handleToolCalls([{ id: 'one', name: 'propose_answer', args: {
      questionId: 'Q01', value: 1, summary: 'This happened on several days in the last two weeks.',
    } }]);
    assert.equal(store.get(assessment.id).answers.length, 0);
    await bridge.handleToolCalls([{ id: 'two', name: 'confirm_answer', args: {} }]);
    assert.equal(store.get(assessment.id).answers[0].value, 1);
    const prompt = events.find((event) => event.type === 'next_prompt');
    assert.match(prompt.value.turns[0].parts[0].text, /item Q02 of 9/);
    assert.match(prompt.value.turns[0].parts[0].text, /Feeling down, depressed, or hopeless/);
    assert.ok(events.findIndex((event) => event.type === 'tool_response' && event.value.functionResponses[0].id === 'two') < events.indexOf(prompt));
  } finally { store.close(); }
});

test('Hindi conversation advances using the fixed Hindi question text', () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live', 'hi');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model', language: 'hi',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    bridge.propose('Q01', 1, 'पिछले दो सप्ताह में कई दिन ऐसा हुआ।', 'voice');
    const result = bridge.confirm();
    bridge.afterConfirmation(result);
    assert.equal(store.get(assessment.id).language, 'hi');
    assert.match(prompts[0].turns[0].parts[0].text, new RegExp(getForm('hi').questions[1].text));
  } finally { store.close(); }
});

test('positive item 9 leads to final review and a human follow-up instruction', () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    for (let number = 1; number <= 8; number++) store.record(assessment.id, number, 0, 'voice', 'Not at all.');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    bridge.propose('Q09', 1, 'This occurred on several days.', 'voice');
    const result = bridge.confirm();
    assert.equal(result.reviewReady, true);
    assert.equal(result.item9Positive, true);
    assert.equal(store.get(assessment.id).status, 'review');
    assert.equal(store.get(assessment.id).scores, null);
    bridge.afterConfirmation(result);
    assert.match(prompts[0].turns[0].parts[0].text, /contact a qualified clinician promptly/i);
  } finally { store.close(); }
});

test('PCL-5 live mapping accepts value 4 and advances through twenty items', () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live', 'en', 'demo-c', 'pcl5');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model', formId: 'pcl5',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    bridge.propose('Q01', 4, 'Extremely bothered during the past month.', 'voice');
    bridge.afterConfirmation(bridge.confirm());
    assert.equal(store.get(assessment.id).answers[0].value, 4);
    assert.match(prompts[0].turns[0].parts[0].text, /item Q02 of 20/);
  } finally { store.close(); }
});

test('Gemini transcript fragments update one message until the turn ends', () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    const messages = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => messages.push(JSON.parse(raw)) },
      store, assessmentId: assessment.id, onState: () => {} });
    bridge.onModelMessage({ serverContent: { outputTranscription: { text: 'Hello' } } });
    bridge.onModelMessage({ serverContent: { outputTranscription: { text: ' there' } } });
    bridge.onModelMessage({ serverContent: { outputTranscription: { text: 'Hello there, how are you?' } } });
    const updates = messages.filter((message) => message.type === 'transcript');
    assert.equal(new Set(updates.map((message) => message.messageId)).size, 1);
    assert.deepEqual(updates.map((message) => message.text), ['Hello', 'Hello there', 'Hello there, how are you?']);
    bridge.onModelMessage({ serverContent: { turnComplete: true } });
    bridge.onModelMessage({ serverContent: { outputTranscription: { text: 'Next question.' } } });
    assert.notEqual(messages.at(-1).messageId, updates[0].messageId);
    bridge.onModelMessage({ serverContent: { interrupted: true } });
    bridge.onModelMessage({ serverContent: { outputTranscription: { text: 'Please continue.' } } });
    assert.notEqual(messages.at(-1).messageId, messages.at(-3).messageId);
  } finally { store.close(); }
});

test('imported live form validates choices for the current question', () => {
  const draftStore = openDraftStore(':memory:');
  try {
    const form = getLiveDraftForm('autism-treatment-evaluation-checklist-atec--45f7ca5c94cc');
    const assessment = draftStore.create(form.formId, 'live');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: () => {} }, store: draftStore,
      assessmentId: assessment.id, formId: form.formId, formOverride: form, onState: () => {} });
    bridge.session = { sendClientContent: (message) => prompts.push(message) };
    assert.throws(() => bridge.propose(form.questions[0].id, 3, 'An option was selected.'), /not an option/);
    bridge.propose(form.questions[0].id, 2, 'An option was selected.');
    bridge.afterConfirmation(bridge.confirm());
    assert.equal(draftStore.get(assessment.id).answers[0].value, 2);
    assert.match(prompts[0].turns[0].parts[0].text, new RegExp(form.questions[1].text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompts[0].turns[0].parts[0].text, /Internal response anchors/);
  } finally { draftStore.close(); }
});
