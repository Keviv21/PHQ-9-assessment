import { answerDoctor } from '../src/doctor-chat.js';
import { getDemoPatient } from '../src/demo-patients.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not configured.');
  process.exitCode = 1;
} else {
  const start = Date.now();
  try {
    const result = await answerDoctor({
      patient: getDemoPatient('demo-b'),
      message: 'The patient currently has difficulty sleeping. Which assessment might help?',
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_TEXT_MODEL || undefined,
    });
    console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - start,
      model: result.model, suggestions: result.suggestions.map((item) => item.title) }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, elapsedMs: Date.now() - start,
      error: String(error.message).slice(0, 300) }));
    process.exitCode = 1;
  }
}
