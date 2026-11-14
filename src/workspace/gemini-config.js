import { HttpError } from "./errors.js";

export function recommendationModel(env = process.env) {
  return (
    env.GEMINI_RECOMMENDATION_MODEL?.trim() ||
    env.GEMINI_MODEL?.trim() ||
    "gemini-3.1-flash-lite"
  );
}

export function translationModel(env = process.env) {
  return env.GEMINI_TRANSLATION_MODEL?.trim() || recommendationModel(env);
}

// Never return provider bodies: they may contain request data or credentials.
export function geminiError(error, fallback) {
  if (error instanceof HttpError) return error;
  const status = Number(error?.status);
  if (status === 404)
    return new HttpError(
      503,
      "The configured Gemini model is unavailable for this API key. Update GEMINI_RECOMMENDATION_MODEL (or GEMINI_TRANSLATION_MODEL for translations) in .env to an accessible model and restart the server.",
    );
  if (status === 401 || status === 403)
    return new HttpError(
      503,
      "Gemini rejected the API credentials or permissions. Check GEMINI_API_KEY and model access, then restart the server.",
    );
  if (status === 429)
    return new HttpError(
      429,
      "Gemini quota or rate limit reached. Retry later or choose an assessment manually.",
    );
  if (
    status === 408 ||
    status === 504 ||
    ["AbortError", "TimeoutError"].includes(error?.name)
  )
    return new HttpError(
      504,
      "Gemini took too long to respond. Retry or choose an assessment manually.",
    );
  if (status >= 500 && status <= 599)
    return new HttpError(
      503,
      "Gemini is temporarily unavailable or experiencing high demand. Retry shortly or choose an assessment manually.",
    );
  return new HttpError(502, fallback);
}
