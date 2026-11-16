// Main's transcript assembly, shared by the Live bridge and the session UI.
export function mergeTranscript(previous, fragment) {
  if (!previous) return fragment.trimStart();
  if (fragment.startsWith(previous)) return fragment;
  if (previous.endsWith(fragment.trim())) return previous;
  if (/^\s|^[.,!?;:’'।]|^[\p{M}]/u.test(fragment) || /\s$|[-–]$/.test(previous)) return previous + fragment;
  return `${previous} ${fragment}`;
}
const scripts = {
  en: /\p{Script=Latin}/u, es: /\p{Script=Latin}/u,
  hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u,
  te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u,
  kn: /\p{Script=Kannada}/u, ml: /\p{Script=Malayalam}/u,
  bn: /\p{Script=Bengali}/u,
};
export const hasNativeScript = (language) => Boolean(scripts[language]);
export function usesSelectedScript(text, language) {
  const script = scripts[language];
  if (!script) return false;
  const letters = [...String(text).replace(/\{\w+\}/g, "")].filter(c => /\p{L}/u.test(c));
  return letters.length > 0 && letters.filter(c => script.test(c)).length / letters.length >= 0.7;
}
// Shared scripts alone cannot distinguish English/Spanish or Hindi/Marathi.
// These conservative lexical checks catch common drift without another API call.
// They are not a general language detector or a translation-quality validator.
const markers = {
  en: new Set("how have you your please choose select answer never nearly days felt during saved send question response several often sometimes always".split(" ")),
  es: new Set("cómo usted respuesta seleccione elija nunca días durante casi siempre guardado enviar pregunta varios frecuencia veces sentido".split(" ")),
  hi: new Set("है हैं आपको चुनें चुनिए बताएं बताएँ नहीं पिछले".split(" ")),
  mr: new Set("आहे आहात तुम्हाला निवडा सांगा नाही मागील किती".split(" ")),
};
const sibling = { en: "es", es: "en", hi: "mr", mr: "hi" };
export function usesSelectedLanguage(text, language) {
  if (!usesSelectedScript(text, language)) return false;
  const other = markers[sibling[language]];
  if (!other) return true;
  const words = String(text).normalize("NFC").toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu) || [];
  return !words.some(word => other.has(word));
}
export function unchangedTranslation(original, translated, language) {
  if (language === "en") return false;
  const normalize = text => String(text).normalize("NFC").replace(/\{\w+\}/g, "").replace(/[^\p{L}\p{M}]+/gu, " ").trim().toLowerCase();
  const source = normalize(original), target = normalize(translated);
  // Shared short labels such as Spanish "No" and proper acronyms can be unchanged.
  return source === target && (source.includes(" ") || markers.en.has(source));
}
export function numericChoicePrompt(text) {
  // Match source-language menu instructions and Unicode digits, in either order.
  // A single numeric measurement or a timeframe is not a numbered choice menu.
  const enumeration = /\p{Nd}+(?:\s*[/、]\s*|\s*,\s+|\s+(?:or|o|या|किंवा|లేదా|அல்லது|ಅಥವಾ|അല്ലെങ്കിൽ|বা)\s+)\p{Nd}+|\p{Nd}+\s*,\s*\p{Nd}+\s*,\s*\p{Nd}+/u;
  const command = /(?:\b(?:select|choose|enter|press|type|selecciona|seleccione|seleccionar|elige|elija|elegir|introduzca|introduce|ingrese|ingresa|escriba|escribe|pulse|pulsa)\b|चुनें|चुनिए|दबाएं|दबाएँ|निवडा|टाका|எண்ணை|தேர்ந்தெடு|தேர்வு|அழுத்து|எழுது|ఎంచుకో|నొక్క|నమోదు|ಆರಿಸ|ಆಯ್ಕೆ|ನಮೂದಿಸ|ಒತ್ತಿ|തിരഞ്ഞെടു|തെരഞ്ഞെടു|അമർത്തു|നൽകുക|বেছে|নির্বাচন|চাপুন|লিখুন)/iu;
  return command.test(text) && enumeration.test(text);
}
