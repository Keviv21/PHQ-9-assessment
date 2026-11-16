// Main's transcript assembly, shared by the Live bridge and the session UI.
export function mergeTranscript(previous, fragment) {
  if (!previous) return fragment.trimStart();
  if (fragment.startsWith(previous)) return fragment;
  if (previous.endsWith(fragment.trim())) return previous;
  if (/^\s|^[.,!?;:’'।]|^[\p{M}]/u.test(fragment) || /\s$|[-–]$/.test(previous)) return previous + fragment;
  return `${previous} ${fragment}`;
}
const scripts = {
  hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u,
  te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u,
  kn: /\p{Script=Kannada}/u, ml: /\p{Script=Malayalam}/u,
  bn: /\p{Script=Bengali}/u,
};
export const hasNativeScript = (language) => Boolean(scripts[language]);
export function usesSelectedScript(text, language) {
  const script = scripts[language];
  if (!script) return true;
  const letters = [...String(text).replace(/\{\w+\}/g, "")].filter(c => /\p{L}/u.test(c));
  return letters.length > 0 && letters.filter(c => script.test(c)).length / letters.length >= 0.7;
}
export function numericChoicePrompt(text) {
  // Reject numeric menus, but allow legitimate numeric questions and timeframes.
  return /(?:select|choose|enter|press|type|चुनें|चुनिए|दबाएं|दबाएँ|ఎంచుకోండి|నొక్కండి)\s*[:：]?\s*[0-9०-९౦-౯](?:\s*[,/、]|\s+(?:or|या|లేదా)\s+)/iu.test(text)
    || /[0-9०-९౦-౯]\s*[,/、]\s*[0-9०-९౦-౯](?:\s*[,/、]\s*[0-9०-९౦-౯])?\s*(?:में से|లో|मेंसे)/u.test(text);
}
