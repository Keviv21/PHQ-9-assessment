// Presentation never replaces canonical IDs, response values, or scoring rules.
export const SESSION_LABELS = {
  question: "Question {number} of {total}",
  progress: "{count} of {total} saved",
  choose: "Choose a response",
  response: "Your response",
  placeholder: "Type your answer in the selected language…",
  send: "Send response",
  conversation: "Conversation",
  you: "You",
  saved: "Saved",
  review: "Review your answers",
  reviewHint: "You can change any response before saving.",
  save: "Save assessment",
  saving: "Saving assessment…",
  autoSave:
    "Clear answers save automatically. You can edit them in the final review.",
  chatHint: "Type your answer to Gemini, or select an answer on the left.",
  voiceHint:
    "Speak to Gemini, or select an answer on the left. You can mute your microphone at any time.",
  listening: "Microphone on · speak your answer",
  micMuted: "Microphone muted",
  mute: "Mute microphone",
  unmute: "Unmute microphone",
  disconnected: "Conversation disconnected. Your saved answers are safe.",
  reconnect: "Reconnect",
  disconnect: "Disconnect",
  connected: "Connected",
  connecting: "Preparing your session…",
  startChat: "Start with chat",
  startVoice: "Start with voice",
  startChoices: "Start with on-screen choices",
  saveResponse: "Save response",
  skip: "Skip — not applicable",
  skipped: "Skipped — not applicable",
  multipleHint: "Select all responses that apply, then save.",
  textHint: "Write your feedback, then save. Written responses are not scored.",
  numberHint: "Enter a number within the limits shown, then save.",
  databaseSaved: "Responses saved to the database",
};
export function presentation(definition, language = "en") {
  const localized = definition?.localized;
  if (!localized || localized.language !== language) return definition;
  return {
    ...definition,
    title: localized.title,
    instructions: localized.instructions,
    referencePeriod: localized.referencePeriod,
    questions: definition.questions.map((q) => {
      const translated = localized.questions.find((item) => item.id === q.id);
      return {
        ...q,
        text: translated.text,
        context_text: translated.contextText ?? q.context_text,
        options: q.options.map((o) => ({
          ...o,
          label: translated.options.find((item) => item.value === o.value)
            .label,
        })),
      };
    }),
  };
}
export function sessionLabels(definition, language) {
  return definition?.localized?.language === language
    ? { ...SESSION_LABELS, ...definition.localized.ui }
    : SESSION_LABELS;
}
export function formatLabel(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}
