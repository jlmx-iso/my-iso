import { describe, expect, it } from "vitest";

import {
  classifyHandshakeFailure,
  RECONNECT_MAX_DELAY_MS,
  reconnectDelay,
} from "./realtimeConnection";

describe("reconnectDelay", () => {
  const noJitter = () => 0;

  it("doubles with each attempt", () => {
    expect([0, 1, 2, 3].map((attempt) => reconnectDelay(attempt, noJitter)))
      .toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("is capped", () => {
    expect(reconnectDelay(5, noJitter)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(reconnectDelay(1_000, noJitter)).toBe(RECONNECT_MAX_DELAY_MS);
  });

  it("subtracts at most a quarter as jitter", () => {
    expect(reconnectDelay(2, () => 1)).toBe(3_000);
    expect(reconnectDelay(1_000, () => 1)).toBe(RECONNECT_MAX_DELAY_MS * 0.75);
  });
});

describe("classifyHandshakeFailure", () => {
  it.each([401, 403])("stops on %i", (status) => {
    expect(classifyHandshakeFailure(status)).toBe("denied");
  });

  it("treats a missing endpoint as unavailable", () => {
    expect(classifyHandshakeFailure(404)).toBe("unavailable");
  });

  it.each([426, 500, 503, null])("retries on %s", (status) => {
    expect(classifyHandshakeFailure(status)).toBe("retry");
  });
});
