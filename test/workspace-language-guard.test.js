import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTranscript, usesSelectedScript, numericChoicePrompt } from '../public/workspace-language-guard.js';
import { validateTranslation, createTranslationsService } from '../src/workspace/translations.js';
import { SESSION_LABELS } from '../src/workspace/presentation.js';
import { GeminiBridge } from '../src/workspace/live-bridge.js';
import { responseCounts, trendData } from '../public/workspace-analytics-charts.js';
const phrases = {
  hi: { text: 'पिछले दो सप्ताह में आपको चिंता कितनी बार हुई?', labels: ['बिल्कुल नहीं', 'कई दिन', 'आधे से अधिक दिन', 'लगभग हर दिन'], instruction: 'अपना उत्तर बताएं।', retry: 'कृपया अपना उत्तर बताएं।' },
  te: { text: 'గత రెండు వారాలలో మీరు ఎంత తరచుగా ఆందోళన చెందారు?', labels: ['అస్సలు లేదు', 'కొన్ని రోజులు', 'సగం కంటే ఎక్కువ రోజులు', 'దాదాపు ప్రతి రోజు'], instruction: 'మీ సమాధానం చెప్పండి.', retry: 'దయచేసి మీ సమాధానం చెప్పండి.' },
};
const source = { title: 'Synthetic assessment', instructions: 'Answer the question.', referencePeriod: 'Past two weeks',
  questions: [{ id: 'q1', text: 'How often have you felt worried?', options: ['Never', 'Several days', 'More than half the days', 'Nearly every day'].map((label, value) => ({value, label})) }], ui: SESSION_LABELS };
function localized(language) {
  const p = phrases[language];
  return { title: p.instruction, instructions: p.instruction, referencePeriod: p.instruction,
    questions: [{ id: 'q1', text: p.text, contextText: '', options: p.labels.map((label,value) => ({value,label})) }],
    ui: Object.fromEntries(Object.entries(SESSION_LABELS).map(([k,v]) => [k, p.instruction + ' ' + (v.match(/\{\w+\}/g) || []).join(' ')])), language };
}
for (const language of ['hi', 'te']) {
  test(`${language}: full translated options required; cached English and numeric menus are rejected`, async () => {
    const translated = localized(language);
    assert.equal(validateTranslation(source, translated, language).questions[0].options[2].label, phrases[language].labels[2]);
    for (const replacement of ['Select 1', '1', 'Several days']) {
      const wrong = structuredClone(translated); wrong.questions[0].options[0].label = replacement;
      assert.throws(() => validateTranslation(source, wrong, language));
    }
    const wrongQuestion = structuredClone(translated); wrongQuestion.questions[0].text = source.questions[0].text;
    assert.throws(() => validateTranslation(source, wrongQuestion, language));
    const wrongUi = structuredClone(translated); wrongUi.ui.send = 'Send response';
    assert.throws(() => validateTranslation(source, wrongUi, language));
    let calls = 0, saved;
    const service = createTranslationsService({ translation: () => wrongQuestion, saveTranslation: (_, __, data) => saved = data }, {
      client: { models: { generateContent: async () => { calls++; return {text: JSON.stringify(translated)}; } } },
    });
    const result = await service.localize(source, language);
    assert.equal(calls, 1); assert.equal(result.localized.questions[0].text, phrases[language].text); assert.equal(saved.language, language);
    const numeric = structuredClone(source), t = structuredClone(translated);
    numeric.questions[0].options[0].label = '0'; t.questions[0].options[0].label = '0';
    assert.doesNotThrow(() => validateTranslation(numeric, t, language));
  });
  test(`${language}: wrong-language audio withheld, retry bounded, full localized labels shown`, async () => {
    const sent = [], requests = [];
    const state = { language, status: 'draft', sessionMode: 'voice', answers: [null], revision: 0,
      definition: { ...source, localized: localized(language) } };
    const bridge = new GeminiBridge({client: {}, state, send: m => sent.push(m)});
    bridge.session = {sendClientContent: m => requests.push(m), close() {}};
    const reply = text => ({serverContent: {outputTranscription: {text},
      modelTurn: {parts: [{inlineData: {mimeType: 'audio/pcm;rate=24000', data: 'AAAA'}}]}, turnComplete: true}});
    await bridge.onMessage(reply('Choose 0, 1, 2, 3.'));
    assert.equal(requests.length, 1); assert.equal(sent.length, 0);
    await bridge.onMessage(reply('Please choose one.'));
    assert.equal(requests.length, 1); assert.ok(!sent.some(m => m.type === 'audio'));
    const fallback = sent.find(m => m.prepared); assert.ok(fallback);
    phrases[language].labels.forEach(label => assert.ok(fallback.text.includes(label)));
    sent.length = 0;
    await bridge.onMessage({serverContent: {outputTranscription: {text: phrases[language].text}}});
    assert.equal(sent.length, 0);
    await bridge.onMessage(reply(phrases[language].text + ' ' + phrases[language].labels.join('। ')));
    assert.equal(sent.filter(m => m.type === 'audio').length, 1);
    assert.equal(sent.filter(m => m.type === 'transcript').length, 1);
    assert.ok(!sent.find(m => m.type === 'transcript').text.includes(phrases[language].text.repeat(2)));
    bridge.stop();
  });
}
test('Transcript accumulation handles cumulative chunks, word boundaries and combining marks', () => {
  assert.equal(mergeTranscript('Hello', 'there'), 'Hello there');
  assert.equal(mergeTranscript('आप', 'आप कैसे हैं?'), 'आप कैसे हैं?');
  assert.equal(mergeTranscript('आप कैसे हैं?', 'हैं?'), 'आप कैसे हैं?');
  assert.equal(mergeTranscript('ह', 'ि'), 'हि');
  assert.equal(usesSelectedScript('Please answer in Hindi', 'hi'), false);
  assert.equal(usesSelectedScript(phrases.te.text, 'hi'), false);
  assert.ok(numericChoicePrompt('ఎంచుకోండి 0, 1, 2'));
  assert.ok(numericChoicePrompt('0,1,2 में से चुनें'));
  assert.equal(numericChoicePrompt('पिछले 2 सप्ताह में'), false);
});
test('Response graphs exclude feedback/skips/numeric measurements, preserve full labels and never invent scores', () => {
  const counts = responseCounts([
    {response:'कभी नहीं',responseType:'single_choice'}, {response:'कभी नहीं',responseType:'single_choice'},
    {response:'Written feedback',feedback:true,responseType:'text'}, {response:'Skipped',skipped:true},
    {response:'12',responseType:'number'}, {response:'A, B',responseType:'multiple_choice'},
  ]);
  assert.deepEqual(counts, [{label:'कभी नहीं',count:2},{label:'A, B',count:1}]);
  const group = {scored:false,metrics:[],results:[{answeredCount:3,questionCount:4,values:[]},{answeredCount:2,questionCount:4,values:[]}]};
  const chart = trendData(group);
  assert.deepEqual(chart.results.map(r=>r.values),[[3],[2]]); assert.equal(chart.metrics[0].max,4);
  assert.deepEqual(group.metrics,[]); assert.equal(group.scored,false);
  const scored = {scored:true,metrics:[{min:0,max:10}],results:[{values:[null]}]};
  assert.equal(trendData(scored),scored);
});
test('Empty tool turns do not retry; interrupted audio is discarded before the next question', async () => {
 const sent=[], requests=[];
 const bridge = new GeminiBridge({client:{},state:{language:'te',definition:{...source,localized:localized('te')},answers:[null]},send:m=>sent.push(m)});
 bridge.session={sendClientContent:m=>requests.push(m),close(){}};
 await bridge.onMessage({serverContent:{turnComplete:true}});
 assert.equal(requests.length,0);
 await bridge.onMessage({serverContent:{outputTranscription:{text:phrases.te.text},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm',data:'AAAA'}}]}}});
 await bridge.onMessage({serverContent:{interrupted:true,turnComplete:true}});
 assert.equal(bridge.outputAudio.length,0);
 assert.ok(!sent.some(m=>m.type==='audio'||m.type==='transcript'));
 assert.equal(requests.length,0);
 bridge.stop();
});
