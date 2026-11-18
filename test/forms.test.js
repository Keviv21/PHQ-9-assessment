import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssessmentForm, scoreAssessment } from '../src/forms.js';
import { openStore } from '../src/store.js';

test('GAD-7 and PCL-5 imported forms have the expected item and response ranges', () => {
  const gad7 = getAssessmentForm('gad7');
  const pcl5 = getAssessmentForm('pcl5');
  assert.equal(gad7.questions.length, 7);
  assert.deepEqual(gad7.options.map((item) => item.value), [0, 1, 2, 3]);
  assert.equal(pcl5.questions.length, 20);
  assert.deepEqual(pcl5.options.map((item) => item.value), [0, 1, 2, 3, 4]);
  assert.throws(() => getAssessmentForm('pcl5', 'hi'), /Unsupported/);
});

test('GAD-7 bands are deterministic and PCL-5 has a total without an invented severity band', () => {
  for (const [total, expected] of [[0, 'minimal'], [4, 'minimal'], [5, 'mild'], [9, 'mild'],
    [10, 'moderate'], [14, 'moderate'], [15, 'severe'], [21, 'severe']]) {
    const values = Array(7).fill(0);
    let remaining = total;
    for (let index = 0; index < values.length; index++) { values[index] = Math.min(3, remaining); remaining -= values[index]; }
    assert.equal(scoreAssessment('gad7', values).severity, expected);
  }
  assert.deepEqual(scoreAssessment('pcl5', Array(20).fill(4)), {
    scoringVersion: 'pcl5-v1', rawTotal: 80, maxTotal: 80, severity: null, requiresHumanFollowUp: false,
  });
  assert.throws(() => scoreAssessment('pcl5', Array(19).fill(0)), /exactly 20/);
  assert.throws(() => scoreAssessment('gad7', [4, ...Array(6).fill(0)]), /0 to 3/);
});

test('GAD-7 and PCL-5 persisted sessions accept their full response ranges', () => {
  const store = openStore(':memory:');
  try {
    for (const [formId, count, value, maxTotal] of [['gad7', 7, 3, 21], ['pcl5', 20, 4, 80]]) {
      let state = store.create('demo', 'en', 'demo-a', formId);
      for (let number = 1; number <= count; number++) state = store.record(state.id, number, value, 'demo');
      assert.equal(state.status, 'review');
      state = store.finalize(state.id, Array(count).fill(value));
      assert.equal(state.scores.rawTotal, maxTotal);
      assert.equal(state.answers.length, count);
    }
  } finally { store.close(); }
});

test('multi-language forms resolve translations for PHQ-9 and GAD-7 across supported languages', () => {
  const phq9Mr = getAssessmentForm('phq9', 'mr');
  assert.equal(phq9Mr.language, 'mr');
  assert.equal(phq9Mr.questions.length, 9);
  assert.match(phq9Mr.questions[0].text, /गोष्टी करण्यात कमी स्वारस्य/);

  const phq9Es = getAssessmentForm('phq9', 'es');
  assert.equal(phq9Es.language, 'es');
  assert.equal(phq9Es.questions.length, 9);
  assert.match(phq9Es.questions[0].text, /Poco interés o placer/);

  const gad7Hi = getAssessmentForm('gad7', 'hi');
  assert.equal(gad7Hi.language, 'hi');
  assert.equal(gad7Hi.questions.length, 7);

  const gad7Mr = getAssessmentForm('gad7', 'mr');
  assert.equal(gad7Mr.language, 'mr');
  assert.equal(gad7Mr.questions.length, 7);

  const gad7Es = getAssessmentForm('gad7', 'es');
  assert.equal(gad7Es.language, 'es');
  assert.equal(gad7Es.questions.length, 7);

  const phq9Kn = getAssessmentForm('phq9', 'kn');
  assert.equal(phq9Kn.language, 'kn');
  assert.equal(phq9Kn.questions.length, 9);
  assert.match(phq9Kn.questions[0].text, /ಕೆಲಸಗಳನ್ನು ಮಾಡಲು ಕಡಿಮೆ ಆಸಕ್ತಿ/);
  assert.equal(phq9Kn.options[0].label, 'ಖಂಡಿತವಾಗಿಯೂ ಇಲ್ಲ');
  assert.match(phq9Kn.instructions, /ಕಳೆದ 2 ವಾರಗಳಲ್ಲಿ/);

  const gad7Kn = getAssessmentForm('gad7', 'kn');
  assert.equal(gad7Kn.language, 'kn');
  assert.equal(gad7Kn.questions.length, 7);
  assert.match(gad7Kn.questions[0].text, /ಹೆದರಿಕೆ, ಆತಂಕ/);
  assert.equal(gad7Kn.options[0].label, 'ಖಂಡಿತವಾಗಿಯೂ ಇಲ್ಲ');

  const phq9Te = getAssessmentForm('phq9', 'te');
  assert.equal(phq9Te.language, 'te');
  assert.match(phq9Te.questions[6].text, /వార్తాపత్రిక చదవడం/);
  assert.equal(phq9Te.options[0].label, 'అస్సలు లేదు');

  const phq9El = getAssessmentForm('phq9', 'el');
  assert.equal(phq9El.language, 'el');
  assert.match(phq9El.questions[6].text, /Δυσκολία συγκέντρωσης/);

  const phq9No = getAssessmentForm('phq9', 'no');
  assert.equal(phq9No.language, 'no');
  assert.match(phq9No.questions[6].text, /Problemer med å konsentrere deg/);

  const phq9It = getAssessmentForm('phq9', 'it');
  assert.equal(phq9It.language, 'it');
  assert.match(phq9It.questions[6].text, /Difficoltà a concentrarsi/);
});
