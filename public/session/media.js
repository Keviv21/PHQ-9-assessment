// Browser speech input is opt-in and may use the browser vendor's speech service.
export function matchSpokenOption(text, options) {
  const normalize = (value) =>
    String(value)
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{Z}\s]+/gu, " ")
      .trim();
  const normalized = normalize(text);
  if (!normalized) return null;
  const matches = options.filter((o) => normalize(o.label) === normalized);
  return matches.length === 1 ? matches[0].value : null;
}
export const speechLocale = (language) =>
  ({
    en: "en-US",
    es: "es-ES",
    hi: "hi-IN",
    mr: "mr-IN",
    ta: "ta-IN",
    te: "te-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    bn: "bn-IN",
  })[language] || language;

export class BrowserSpeech {
  constructor({ onText, onStatus }) {
    this.onText = onText;
    this.onStatus = onStatus;
    this.recognizer = null;
    this.generation = 0;
  }
  get supported() {
    return Boolean(
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    );
  }
  listen(language) {
    this.stop();
    const version = this.generation;
    const Recognition =
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
      this.onStatus(
        "Speech input is not supported in this browser. Choose an answer on screen.",
      );
      return;
    }
    const recognition = new Recognition();
    this.recognizer = recognition;
    recognition.lang = speechLocale(language);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      if (version !== this.generation) return;
      const text = event.results[0]?.[0]?.transcript;
      if (text) this.onText(text);
    };
    recognition.onerror = () => {
      if (version === this.generation)
        this.onStatus(
          "Speech input could not finish. Try again or choose on screen.",
        );
    };
    recognition.onend = () => {
      if (version === this.generation) {
        this.recognizer = null;
        this.onStatus("");
      }
    };
    try {
      recognition.start();
      this.onStatus("Listening… Speak the full response label.");
    } catch {
      this.recognizer = null;
      this.onStatus("Speech input is unavailable. Choose on screen.");
    }
  }
  stop() {
    this.generation++;
    if (this.recognizer) {
      this.recognizer.onend = null;
      this.recognizer.abort();
      this.recognizer = null;
    }
  }
}

// Sagar-style 16 kHz capture fallback for browsers where AudioWorklet cannot load.
export class PcmResampler {
  constructor(rate, emit) {
    this.source = [];
    this.next = 0;
    this.step = rate / 16000;
    this.output = new Int16Array(1600);
    this.length = 0;
    this.emit = emit;
  }
  push(input) {
    for (const sample of input) this.source.push(sample);
    while (this.next + 1 < this.source.length) {
      const i = Math.floor(this.next),
        fraction = this.next - i;
      const v = this.source[i] * (1 - fraction) + this.source[i + 1] * fraction;
      this.output[this.length++] = Math.round(
        Math.max(-1, Math.min(1, v)) * 32767,
      );
      this.next += this.step;
      if (this.length === this.output.length) {
        this.emit(this.output.buffer);
        this.output = new Int16Array(1600);
        this.length = 0;
      }
    }
    const consumed = Math.min(Math.floor(this.next), this.source.length);
    if (consumed) {
      this.source.splice(0, consumed);
      this.next -= consumed;
    }
  }
}
