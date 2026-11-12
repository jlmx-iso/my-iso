import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { renderFirstEventEmail } from "../first-event";
import { Layout } from "./Layout";

/** Every <hr> in the HTML with its inline style. */
const dividers = (html: string) => [...html.matchAll(/<hr[^>]*style="([^"]*)"/g)].map((match) => match[1]);

describe("email layout", () => {
  it("renders the frame around the content (snapshot)", async () => {
    const html = await render(
      <Layout preview="Preview text" unsubscribeUrl="https://example.com/unsubscribe">
        <p>Body</p>
      </Layout>,
      { pretty: true },
    );
    expect(html).toMatchSnapshot();
  });

  it("draws the footer divider in the layout's colour, not Hr's default", async () => {
    const html = await render(<Layout preview="p"><p>Body</p></Layout>);
    const [footer] = dividers(html);
    expect(footer).toContain("border-top:1px solid #F3F4F6");
    expect(footer).not.toContain("#eaeaea");
  });
});

describe("an email with dividers", () => {
  it("keeps their colour (snapshot)", async () => {
    const html = await renderFirstEventEmail({
      browseEventsUrl: "https://example.com/app/events",
      createEventUrl: "https://example.com/app/events?create=1",
      firstName: "Ada",
    });
    const lines = dividers(html);
    // Two in the body, one in the footer.
    expect(lines).toHaveLength(3);
    for (const style of lines.slice(0, 2)) expect(style).toContain("border-top:1px solid #E5E7EB");
    expect(html).toMatchSnapshot();
  });
});
