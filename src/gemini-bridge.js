import { Behavior, GoogleGenAI, Modality } from '@google/genai';
import { currentQuestion, getForm, assertAnswer, languages } from './assessment.js';

const answerTool = {
  name: 'propose_answer',
  behavior: Behavior.BLOCKING,
  description: 'Map the participant’s natural-language description of the CURRENT PHQ-9 symptom over the past two weeks to one frequency value. Call only when the meaning is sufficiently clear. Never use video, tone, appearance, or silence. Provide a short neutral recap without private details.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      questionId: { type: 'string', description: 'Current question ID, such as Q01' },
      value: { type: 'integer', minimum: 0, maximum: 3 },
      summary: { type: 'string', description: 'Brief plain-language recap of frequency over the past two weeks; do not mention a numeric score or sensitive details.' },
    },
    required: ['questionId', 'value', 'summary'],
    additionalProperties: false,
  },
};

const confirmTool = {
  name: 'confirm_answer',
  behavior: Behavior.BLOCKING,
  description: 'Save the mapped answer only after the participant explicitly confirms the plain-language recap aloud. The participant may also confirm on screen.',
  parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const cancelTool = {
  name: 'cancel_answer',
  behavior: Behavior.BLOCKING,
  description: 'Discard a proposed interpretation if the participant corrects or rejects it; then invite them to clarify.',
  parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function instruction(language, form) {
  const languageName = languages.find((item) => item.code === language).name;
  return [
    `You are a calm PHQ-9 assessment facilitator. Speak only in ${languageName}. Keep your spoken replies in ${languageName} even if the participant uses another language.`,
    'Use the exact statement text supplied by the application, one statement at a time, in order. Introduce it naturally, then invite the participant to describe their experience in their own words. Do not list numbered answer choices unless they ask.',
    `At the beginning, explain that answers refer to the past two weeks. Internally map each symptom to these frequency anchors: ${form.options.map((option) => `${option.value}: ${option.label}`).join('; ')}. Do not speak the numeric value or use it as a clinical judgement.`,
    'Listen for how often the CURRENT symptom occurred during the past two weeks. A description of another symptom, silence, appearance, or emotion in the voice is not an answer. If unclear, ask a short neutral follow-up about frequency; do not guess.',
    `When the participant has clearly described the current statement, call propose_answer with the current question ID, the mapped value, and a short neutral summary in ${languageName} of what they said. Avoid names, events, diagnoses, and other sensitive details in the summary.`,
    'After the tool response, reflect the summary in plain language and ask whether you understood correctly, without mentioning the number. Only if the participant clearly agrees, call confirm_answer. If they correct or reject it, call cancel_answer and clarify before proposing again.',
    'Wait for confirmation before moving to the next question. After confirmation, wait for the application to send the next exact question.',
    'The camera provides conversational context only. Never infer an answer, symptom, diagnosis, or score from video, appearance, expression, or voice tone.',
    'Question 9 asks about thoughts of death or self-harm. Ask it exactly and calmly. Do not skip, soften, or infer it from other symptoms. If the participant describes immediate danger or current intent, pause the questionnaire, respond supportively, and encourage immediate local emergency help. Do not infer a score from that exchange.',
    'Do not provide a diagnosis, clinical interpretation, or treatment advice. After the ninth confirmed answer, ask the participant to review all nine selected options on screen. The report is generated only after they finalize that review. A positive answer to question 9 requires human follow-up regardless of the total score. If question 9 is positive, tell the participant to contact a qualified clinician promptly, explain that this prototype does not notify anyone, and encourage immediate local emergency help if they cannot stay safe.',
  ].join(' ');
}

export class GeminiBridge {
  constructor({ apiKey, model, socket, store, assessmentId, language = 'en', onState }) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.socket = socket;
    this.store = store;
    this.assessmentId = assessmentId;
    this.language = language;
    this.form = getForm(language);
    this.onState = onState;
    this.session = null;
    this.pending = null;
    this.resumptionHandle = null;
    this.stopped = false;
    this.connecting = false;
    this.retryCount = 0;
    this.toolQueue = Promise.resolve();
    this.responseMethod = 'voice';
  }

  send(message) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  async start() {
    await this.connect(true);
  }

  async connect(announceQuestion) {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    try {
      const hadHandle = Boolean(this.resumptionHandle);
      const session = await this.client.live.connect({
        model: this.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
          systemInstruction: instruction(this.language, this.form),
          tools: [{ functionDeclarations: [answerTool, confirmTool, cancelTool] }],
        },
        callbacks: {
          onopen: () => this.send({ type: 'live_status', status: 'connected' }),
          onmessage: (message) => this.onModelMessage(message),
          onerror: (error) => this.send({ type: 'live_status', status: 'error', detail: error.message }),
          onclose: () => this.onModelClose(session),
        },
      });
      if (this.stopped) {
        session.close();
        return;
      }
      this.session = session;
      this.retryCount = 0;
      if (announceQuestion || !hadHandle) this.askCurrentQuestion();
    } catch (error) {
      this.send({ type: 'live_status', status: 'error', detail: error.message });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  onModelClose(closedSession) {
    if (this.session === closedSession) this.session = null;
    if (!this.stopped && this.store.get(this.assessmentId)?.status === 'in_progress') {
      this.send({ type: 'live_status', status: 'reconnecting' });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.retryCount >= 3) return;
    this.retryCount += 1;
    setTimeout(() => {
      if (!this.stopped && !this.session) this.connect(false);
    }, 1000 * this.retryCount);
  }

  askCurrentQuestion() {
    const state = this.store.get(this.assessmentId);
    if (!state || state.status !== 'in_progress' || !this.session) return;
    const question = currentQuestion(state.currentNumber, this.language);
    const text = state.currentNumber === 1
      ? `Begin the conversational PHQ-9 assessment. Speak in the selected language. Explain that you will discuss symptoms from the past two weeks and check your understanding before saving each response. Introduce item ${question.id} exactly: ${question.text}. Invite a natural answer without listing choices.`
      : `Continue at item ${question.id} of 9. Introduce it exactly: ${question.text}. Invite a natural answer without listing choices.`;
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
  }

  onModelMessage(message) {
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.goAway) this.send({ type: 'live_status', status: 'reconnecting' });

    const content = message.serverContent;
    if (content?.interrupted) this.send({ type: 'audio_interrupt' });
    if (content?.inputTranscription?.text) {
      this.responseMethod = 'voice';
      this.send({ type: 'transcript', speaker: 'participant', text: content.inputTranscription.text });
    }
    if (content?.outputTranscription?.text) {
      this.send({ type: 'transcript', speaker: 'gemini', text: content.outputTranscription.text });
    }
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.send({ type: 'audio', data: part.inlineData.data });
    }
    if (message.toolCall?.functionCalls?.length) {
      this.toolQueue = this.toolQueue
        .then(() => this.handleToolCalls(message.toolCall.functionCalls))
        .catch((error) => this.send({ type: 'live_status', status: 'error', detail: error.message }));
    }
  }

  async handleToolCalls(calls) {
    const responses = [];
    let confirmed = null;
    for (const call of calls) {
      let result;
      try {
        if (call.name === 'propose_answer') result = this.propose(call.args?.questionId, call.args?.value, call.args?.summary, this.responseMethod);
        else if (call.name === 'confirm_answer') {
          result = this.confirm();
          if (result.accepted) {
            confirmed = result;
            result = {
              accepted: true,
              reviewReady: Boolean(result.reviewReady),
              instruction: 'Wait for the application to send the next spoken prompt.',
            };
          }
        }
        else if (call.name === 'cancel_answer') result = this.cancel();
        else result = { accepted: false, error: 'Unknown tool.' };
      } catch (error) {
        result = { accepted: false, error: error.message };
      }
      responses.push({ id: call.id, name: call.name, response: result });
    }
    if (this.session && responses.length) {
      this.session.sendToolResponse({ functionResponses: responses });
      if (confirmed) this.afterConfirmation(confirmed);
    }
  }

  propose(questionId, value, summary, method = 'voice') {
    assertAnswer(value);
    const state = this.store.get(this.assessmentId);
    if (!state || state.status !== 'in_progress') throw new Error('No active assessment.');
    if (this.pending) throw new Error('Confirm or correct the current interpretation first.');
    const expectedId = this.form.questions[state.currentNumber - 1].id;
    if (questionId !== expectedId) throw new Error('Proposed answer is for the wrong question.');
    if (typeof summary !== 'string' || !summary.trim() || summary.length > 240) {
      throw new Error('A short response summary is required.');
    }
    const cleanSummary = summary.trim();
    this.pending = { number: state.currentNumber, value, method, summary: cleanSummary };
    this.send({ type: 'proposal', number: state.currentNumber, summary: cleanSummary });
    return { accepted: true, pendingConfirmation: true, summary: cleanSummary, instruction: 'Ask the participant to confirm the plain-language summary. Do not mention the number.' };
  }

  cancel() {
    this.pending = null;
    this.responseMethod = 'voice';
    this.send({ type: 'proposal_cleared' });
    return { accepted: true, pendingConfirmation: false };
  }

  confirm() {
    if (!this.pending) return { accepted: false, error: 'No proposed answer to confirm.' };
    const { number, value, method, summary } = this.pending;
    const state = this.store.record(this.assessmentId, number, value, method, summary);
    this.pending = null;
    this.responseMethod = 'voice';
    this.onState(state);
    if (state.status === 'review') {
      return { accepted: true, reviewReady: true, item9Positive: state.answers[8].value > 0,
        instruction: 'Ask the participant to review the nine selected answers on screen before finalizing. Do not state a score yet.' };
    }
    return {
      accepted: true,
      savedQuestion: number,
      nextQuestion: currentQuestion(state.currentNumber, this.language),
      instruction: 'Read the next question exactly and wait for one response.',
    };
  }

  afterConfirmation(result) {
    if (!this.session) return;
    const text = result.reviewReady
      ? result.item9Positive
        ? 'All nine answers have been collected. Ask the participant to review each selected option on screen and change any answer before generating the report. Because item 9 was positive, ask them to contact a qualified clinician promptly. Explain that this prototype does not notify anyone. If they may not be able to stay safe, encourage immediate local emergency help. Do not interpret a score.'
        : 'All nine answers have been collected. Ask the participant to review each selected option on screen and change any answer before generating the report. Do not interpret a score yet.'
      : `The participant confirmed your understanding. Introduce item ${result.nextQuestion.id} of 9 exactly: ${result.nextQuestion.text}. Invite a natural answer and clarify if needed.`;
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
  }

  afterCancellation() {
    const state = this.store.get(this.assessmentId);
    if (!this.session || !state || state.status !== 'in_progress') return;
    const question = currentQuestion(state.currentNumber, this.language);
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `The participant wants to correct your understanding of ${question.id}. Invite them to clarify in their own words. Do not guess a value.` }] }], turnComplete: true });
  }

  sendText(text) {
    if (!this.session || this.stopped) throw new Error('Gemini is still connecting.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Write a short response.');
    this.responseMethod = 'screen';
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: text.trim() }] }], turnComplete: true });
  }

  sendAudio(pcm) {
    if (!this.session || this.stopped || pcm.length > 64_000) return;
    this.session.sendRealtimeInput({
      audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  sendVideo(jpeg) {
    if (!this.session || this.stopped || jpeg.length > 256_000) return;
    this.session.sendRealtimeInput({
      video: { data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
    });
  }

  stop() {
    this.stopped = true;
    if (this.session) this.session.close();
    this.session = null;
  }
}
