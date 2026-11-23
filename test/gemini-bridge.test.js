import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiBridge } from '../src/gemini-bridge.js';
import { openDraftStore } from '../src/draft-store.js';
import { getLiveDraftForm } from '../src/draft-library.js';
import { getForm } from '../src/assessment.js';
import { openStore } from '../src/store.js';
import { getDefinition } from '../src/definition-library.js';
import { openDefinitionStore } from '../src/definition-store.js';
import { createDefinitionVoiceStore } from '../src/definition-voice.js';

test('conversational mapping waits for confirmation and asks the next PHQ-9 item', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    const events = [];
    const bridge = new GeminiBridge({
      apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => events.push({ type: 'browser', value: JSON.parse(raw) }) },
      store, assessmentId: assessment.id, onState: (state) => events.push({ type: 'state', value: state }),
      requireConfirmation: true,
    });
    bridge.session = {
      sendToolResponse: (value) => events.push({ type: 'tool_response', value }),
      sendClientContent: (value) => events.push({ type: 'next_prompt', value }),
    };
    await bridge.handleToolCalls([{ id: 'one', name: 'propose_answer', args: {
      questionId: 'Q01', value: 1, summary: 'This happened on several days in the last two weeks.',
    } }]);
    assert.equal(events.find((event) => event.type === 'browser' && event.value.type === 'proposal').value.value, 1);
    assert.equal(store.get(assessment.id).answers.length, 0);
    await bridge.handleToolCalls([{ id: 'two', name: 'confirm_answer', args: {} }]);
    assert.equal(store.get(assessment.id).answers[0].value, 1);
    const prompt = events.find((event) => event.type === 'next_prompt');
    assert.match(prompt.value.turns[0].parts[0].text, /item Q02 of 9/);
    assert.match(prompt.value.turns[0].parts[0].text, /Feeling down, depressed, or hopeless/);
    assert.ok(events.findIndex((event) => event.type === 'tool_response' && event.value.functionResponses[0].id === 'two') < events.indexOf(prompt));
  } finally { store.close(); }
});

test('Hindi conversation advances using the fixed Hindi question text', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live', 'hi');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model', language: 'hi',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    await bridge.propose('Q01', 1, 'पिछले दो सप्ताह में कई दिन ऐसा हुआ।', 'voice');
    const result = await bridge.confirm();
    bridge.afterConfirmation(result);
    assert.equal(store.get(assessment.id).language, 'hi');
    assert.match(prompts[0].turns[0].parts[0].text, new RegExp(getForm('hi').questions[1].text));
  } finally { store.close(); }
});

test('setLanguage switches bridge language and resets audio state', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live', 'hi');
    const events = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model', language: 'hi',
      socket: { readyState: 1, send: (raw) => events.push(JSON.parse(raw)) }, store, assessmentId: assessment.id, onState: () => {} });
    let closed = false;
    let connected = false;
    bridge.session = { close: () => { closed = true; } };
    bridge.client = {
      live: {
        connect: async () => {
          connected = true;
          return { close: () => {} };
        },
      },
    };
    await bridge.setLanguage('en', getForm('en'));
    assert.equal(bridge.language, 'en');
    assert.equal(closed, true);
    assert.equal(connected, true);
    assert.ok(events.some((event) => event.type === 'audio_interrupt'));
  } finally { store.close(); }
});

test('positive item 9 leads to final review and a human follow-up instruction', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    for (let number = 1; number <= 8; number++) store.record(assessment.id, number, 0, 'voice', 'Not at all.');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    await bridge.propose('Q09', 1, 'This occurred on several days.', 'voice');
    const result = await bridge.confirm();
    assert.equal(result.reviewReady, true);
    assert.equal(result.item9Positive, true);
    assert.equal(store.get(assessment.id).status, 'review');
    assert.equal(store.get(assessment.id).scores, null);
    bridge.afterConfirmation(result);
    assert.match(prompts[0].turns[0].parts[0].text, /contact a qualified clinician promptly/i);
  } finally { store.close(); }
});

test('PCL-5 live mapping accepts value 4 and advances through twenty items', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live', 'en', 'demo-c', 'pcl5');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model', formId: 'pcl5',
      socket: { readyState: 1, send: () => {} }, store, assessmentId: assessment.id, onState: () => {} });
    bridge.session = { sendClientContent: (value) => prompts.push(value) };
    await bridge.propose('Q01', 4, 'Extremely bothered during the past month.', 'voice');
    bridge.afterConfirmation(await bridge.confirm());
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

test('imported live form validates choices for the current question', async () => {
  const draftStore = openDraftStore(':memory:');
  try {
    const form = getLiveDraftForm('autism-treatment-evaluation-checklist-atec--45f7ca5c94cc');
    const assessment = draftStore.create(form.formId, 'live');
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: () => {} }, store: draftStore,
      assessmentId: assessment.id, formId: form.formId, formOverride: form, onState: () => {} });
    bridge.session = { sendClientContent: (message) => prompts.push(message) };
    await assert.rejects(bridge.propose(form.questions[0].id, 3, 'An option was selected.'), /not an option/);
    await bridge.propose(form.questions[0].id, 2, 'An option was selected.');
    bridge.afterConfirmation(await bridge.confirm());
    assert.equal(draftStore.get(assessment.id).answers[0].value, 2);
    assert.match(prompts[0].turns[0].parts[0].text, new RegExp(form.questions[1].text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompts[0].turns[0].parts[0].text, /Internal response anchors/);
  } finally { draftStore.close(); }
});

test('cleaned catalogue voice proposal saves only after confirmation and advances', async () => {
  const definitionStore = openDefinitionStore({ path: ':memory:' });
  try {
    const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
    const prescription = await definitionStore.prescribe('demo-a', form.id);
    const state = await definitionStore.start(prescription.id);
    const events = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => events.push(JSON.parse(raw)) },
      store: createDefinitionVoiceStore(definitionStore), assessmentId: state.id,
      formId: form.id, formOverride: { definition: true, formId: form.id, title: form.title, questions: form.questions },
      onState: (updated) => events.push({ type: 'state', assessment: updated }),
      requireConfirmation: true });
    const first = form.questions[0];
    await assert.rejects(bridge.propose(first.id, '"invalid"', 'Invalid.'), /Invalid choice/);
    assert.deepEqual((await definitionStore.getSession(state.id)).answers, {});
    await bridge.propose(first.id, JSON.stringify(first.options[0].id), 'The first choice fits.');
    assert.equal(events.find((event) => event.type === 'proposal').value, first.options[0].id);
    assert.deepEqual((await definitionStore.getSession(state.id)).answers, {});
    const result = await bridge.confirm();
    assert.equal((await definitionStore.getSession(state.id)).answers[first.id], first.options[0].id);
    assert.equal(result.nextQuestion.id, form.questions[1].id);
    assert.ok(events.some((event) => event.type === 'proposal'));
  } finally { await definitionStore.close(); }
});

test('screen answer recorded via pending immediately advances to next question and notifies model', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    const prompts = [];
    const states = [];
    const bridge = new GeminiBridge({
      apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: () => {} },
      store, assessmentId: assessment.id,
      onState: (state) => states.push(state),
    });
    bridge.session = {
      sendClientContent: (val) => prompts.push(val),
    };
    bridge.pending = { number: 1, value: 0, method: 'screen', summary: 'Not at all' };
    const result = await bridge.confirm();
    assert.equal(result.accepted, true);
    assert.equal(result.savedQuestion, 1);
    assert.equal(result.nextQuestion.number, 2);
    bridge.afterConfirmation(result);
    assert.equal(store.get(assessment.id).answers[0].value, 0);
    assert.equal(store.get(assessment.id).currentNumber, 2);
    assert.match(prompts[0].turns[0].parts[0].text, /item Q02 of 9/);
  } finally { store.close(); }
});

test('voice mode saves a clear answer immediately and advances without confirmation prompt', async () => {
  const store = openStore(':memory:');
  try {
    const assessment = store.create('live');
    const events = [];
    const prompts = [];
    const bridge = new GeminiBridge({
      apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => events.push(JSON.parse(raw)) },
      store, assessmentId: assessment.id,
      onState: (state) => events.push({ type: 'state', value: state }),
    });
    bridge.session = {
      sendToolResponse: () => {},
      sendClientContent: (val) => prompts.push(val),
    };
    await bridge.handleToolCalls([{ id: 'v1', name: 'record_answer', args: {
      questionId: 'Q01', value: 1, summary: 'This occurred on several days.',
    } }]);
    assert.equal(events.some((e) => e.type === 'proposal'), false);
    assert.equal(store.get(assessment.id).answers[0].value, 1);
    assert.equal(store.get(assessment.id).currentNumber, 2);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].turns[0].parts[0].text, /item Q02 of 9/);
  } finally { store.close(); }
});

test('catalogue voice answer saves immediately and advances to the next item', async () => {
  const definitionStore = openDefinitionStore({ path: ':memory:' });
  try {
    const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
    const prescription = await definitionStore.prescribe('demo-a', form.id);
    const state = await definitionStore.start(prescription.id);
    const events = [];
    const prompts = [];
    const bridge = new GeminiBridge({ apiKey: 'test-only', model: 'test-model',
      socket: { readyState: 1, send: (raw) => events.push(JSON.parse(raw)) },
      store: createDefinitionVoiceStore(definitionStore), assessmentId: state.id,
      formId: form.id, formOverride: { definition: true, formId: form.id, title: form.title, questions: form.questions },
      onState: () => {} });
    bridge.session = { sendToolResponse: () => {}, sendClientContent: (value) => prompts.push(value) };
    const first = form.questions[0];
    await bridge.handleToolCalls([{ id: 'one', name: 'record_answer', args: {
      questionId: first.id, answerJson: JSON.stringify(first.options[0].id), summary: 'The first option fits.',
    } }]);
    assert.equal(events.some((event) => event.type === 'proposal'), false);
    assert.equal((await definitionStore.getSession(state.id)).answers[first.id], first.options[0].id);
    assert.match(prompts[0].turns[0].parts[0].text, new RegExp(form.questions[1].id));
  } finally { await definitionStore.close(); }
});
