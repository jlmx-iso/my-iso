// Which Claude models the match insights may run on. Plain JavaScript because
// src/env.js validates ANTHROPIC_MODEL against it.

/**
 * Models that accept the request src/server/_lib/ai.ts sends: thinking
 * turned off (`thinking: { type: "disabled" }`) at effort "low", with a JSON
 * output format. Not every Claude model does: Claude Sonnet 5.5, Claude
 * Opus 5.5 and the Fable models answer 400 to disabled thinking, and older
 * Haiku models reject `effort`. An override outside this list would make
 * every request fail, so the environment refuses it at startup instead.
 *
 * Add a model only after checking its request surface.
 */
export const AI_MODELS = /** @type {const} */ ([
  "claude-haiku-5-5",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-opus-4-8",
]);

/** The model used when ANTHROPIC_MODEL is not set. */
export const DEFAULT_AI_MODEL = "claude-haiku-5-5";
