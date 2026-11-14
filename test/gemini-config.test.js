import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendationModel,
  translationModel,
} from "../src/workspace/gemini-config.js";
import { createRecommender } from "../src/workspace/recommendations.js";

test("Gemini model configuration shares defaults and respects explicit overrides", () => {
  assert.equal(recommendationModel({}), "gemini-3.1-flash-lite");
  assert.equal(translationModel({}), recommendationModel({}));
  assert.equal(recommendationModel({ GEMINI_MODEL: " shared " }), "shared");
  const env = {
    GEMINI_MODEL: "shared",
    GEMINI_RECOMMENDATION_MODEL: " recommendation ",
  };
  assert.equal(recommendationModel(env), "recommendation");
  assert.equal(translationModel(env), "recommendation");
  assert.equal(
    translationModel({ ...env, GEMINI_TRANSLATION_MODEL: " translation " }),
    "translation",
  );
  assert.equal(
    recommendationModel({
      GEMINI_RECOMMENDATION_MODEL: " ",
      GEMINI_MODEL: " ",
    }),
    "gemini-3.1-flash-lite",
  );
});

const store = () => ({
  patient: () => ({
    historySummary: "Synthetic symptoms for a test",
    recordedAge: 30,
  }),
  recommendation: () => null,
  saveRecommendation: () => assert.fail("Failed requests must not be cached"),
});

for (const [providerStatus, status, message] of [
  [404, 503, /model is unavailable/],
  [401, 503, /credentials/],
  [403, 503, /permissions/],
  [429, 429, /quota or rate limit/],
  [500, 503, /temporarily unavailable/],
  [503, 503, /high demand/],
  [504, 504, /too long/],
]) {
  test(`Recommendation errors explain provider ${providerStatus} without exposing its body`, async () => {
    const recommend = createRecommender(store(), {
      client: {
        models: {
          generateContent: async () => {
            throw Object.assign(new Error("sensitive provider body"), {
              status: providerStatus,
            });
          },
        },
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(recommend("synthetic"), (error) => {
        assert.equal(error.status, status);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /sensitive provider body/);
        return true;
      });
    }
  });
}

for (const text of [
  "not json",
  "null",
  '{"reply":"Example", "suggestions":[null]}',
]) {
  test(`Invalid recommendation response is identified: ${text}`, async () => {
    const recommend = createRecommender(store(), {
      client: { models: { generateContent: async () => ({ text }) } },
    });
    await assert.rejects(recommend("synthetic"), {
      status: 502,
      message:
        "Gemini returned an invalid assessment suggestion. Retry or choose an assessment manually.",
    });
  });
}
