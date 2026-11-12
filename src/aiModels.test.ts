import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AI_MODELS, DEFAULT_AI_MODEL } from "~/aiModels.js";

// The schema src/env.js applies to ANTHROPIC_MODEL.
const anthropicModel = z.enum(AI_MODELS).optional();

describe("ANTHROPIC_MODEL", () => {
  it("accepts the default and the models that take disabled thinking at low effort", () => {
    expect(AI_MODELS).toContain(DEFAULT_AI_MODEL);
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5", "claude-opus-4-8"]) {
      expect(anthropicModel.safeParse(model).success).toBe(true);
    }
    expect(anthropicModel.safeParse(undefined).success).toBe(true);
  });

  it("refuses models that reject the request the app sends", () => {
    // 400 on thinking: { type: "disabled" }.
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]) {
      expect(anthropicModel.safeParse(model).success).toBe(false);
    }
    // Rejects `effort`.
    expect(anthropicModel.safeParse("claude-haiku-4-5").success).toBe(false);
    // Not a model id at all.
    expect(anthropicModel.safeParse("gpt-5").success).toBe(false);
  });
});
