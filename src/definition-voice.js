import { conditionState, validateAnswer } from './definition-scoring.js';

export function nextDefinitionItem(state) {
  if (!state || state.status === 'completed') return null;
  for (const [index, item] of state.formSnapshot.questions.entries()) {
    const visible = conditionState(item.displayIf, state.answers, state.formSnapshot.questions, state.context ?? {});
    if (visible === null) throw new RangeError(`The display condition for ${item.id} needs an answer or context first.`);
    if (visible && !Object.hasOwn(state.answers, item.id)) return { number: index + 1, item };
  }
  return null;
}

export function voiceDefinitionState(state) {
  const next = nextDefinitionItem(state);
  return { ...state, status: state.status === 'completed' ? 'completed' : next ? 'in_progress' : 'review',
    currentNumber: next?.number ?? null };
}

export function createDefinitionVoiceStore(definitionStore) {
  return {
    async get(id) {
      const state = await definitionStore.getSession(id);
      return state ? voiceDefinitionState(state) : null;
    },
    async record(id, number, value, method, summary) {
      const state = await definitionStore.getSession(id);
      if (!state || state.status !== 'in_progress') throw new RangeError('No active assessment.');
      const next = nextDefinitionItem(state);
      if (!next || next.number !== number) throw new RangeError('Answer is for the wrong question.');
      if (!['voice', 'screen'].includes(method)) throw new RangeError('Unsupported response method.');
      if (typeof summary !== 'string' || !summary.trim() || summary.length > 240) throw new RangeError('A short summary is required.');
      validateAnswer(next.item, value);
      const saved = await definitionStore.save(id, { ...state.answers, [next.item.id]: value }, false, state.context);
      return voiceDefinitionState(saved);
    },
  };
}
