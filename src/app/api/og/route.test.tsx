import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The image renderer (Satori and resvg, WebAssembly) is replaced at the
// boundary: what is under test is what the route asks it to draw.
const rendered = vi.hoisted(() => ({ calls: [] as { element: unknown; options: unknown }[] }));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options: { headers?: Record<string, string> }) {
      super("png", { headers: { "content-type": "image/png", ...options.headers } });
      rendered.calls.push({ element, options });
    }
  },
}));

import { GET } from "./route";

function lastMarkup(): string {
  return renderToStaticMarkup(rendered.calls.at(-1)?.element as ReactElement);
}

describe("GET /api/og", () => {
  it("draws the default title and subtitle at 1200x630, cached", async () => {
    const response = await GET(new Request("http://localhost:3000/api/og"));

    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    expect(rendered.calls.at(-1)?.options).toMatchObject({ height: 630, width: 1200 });
    const markup = lastMarkup();
    expect(markup).toContain("ISO");
    expect(markup).toContain("The Photographer Network");
  });

  it("caps the title and subtitle taken from the URL", async () => {
    const title = "T".repeat(200);
    const subtitle = "S".repeat(300);

    await GET(new Request(`http://localhost:3000/api/og?title=${title}&subtitle=${subtitle}`));

    const markup = lastMarkup();
    expect(markup).toContain(`>${"T".repeat(80)}<`);
    expect(markup).toContain(`>${"S".repeat(120)}<`);
  });
});
