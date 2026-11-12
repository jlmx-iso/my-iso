import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EventTime from "./EventTime";

describe("EventTime on the server", () => {
  it("renders an empty placeholder as wide as the text, not a time in the server's zone", () => {
    const html = renderToString(<EventTime date="2026-11-22T21:00:00.000Z" timeZone="America/Denver" format="time" />);

    expect(html).toContain('data-testid="event-time-placeholder"');
    expect(html).toContain("min-width:11ch");
    expect(html).not.toContain("PM");
  });
});
