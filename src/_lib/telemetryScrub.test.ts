import { describe, expect, it } from "vitest";

import { scrubPersonProperties, scrubProperties, scrubText, stripUrlQuery } from "./telemetryScrub";

const WAITLIST = "https://myiso.app/join?waitlist=approved&email=a%40b.co";
const WAITLIST_RAW = "https://myiso.app/join?waitlist=approved&email=a@b.co";
const INVITE = "https://myiso.app/join?code=ISO-TEST-ABCDEFGH";

describe("stripUrlQuery", () => {
  it("removes the query string and the fragment", () => {
    expect(stripUrlQuery(WAITLIST)).toBe("https://myiso.app/join");
    expect(stripUrlQuery("/join?code=X#top")).toBe("/join");
    expect(stripUrlQuery("https://myiso.app/app#messages")).toBe("https://myiso.app/app");
    expect(stripUrlQuery("https://myiso.app/app")).toBe("https://myiso.app/app");
    expect(stripUrlQuery("")).toBe("");
  });
});

describe("scrubText", () => {
  it("strips query strings from URLs anywhere in a text", () => {
    expect(scrubText(`Failed to fetch ${INVITE} (500)`)).toBe("Failed to fetch https://myiso.app/join (500)");
    expect(scrubText(`GET "/join?code=ISO-TEST-ABCDEFGH" failed`)).toBe('GET "/join" failed');
    expect(scrubText("/join?waitlist=approved&email=a@b.co")).toBe("/join");
    expect(scrubText("wss://myiso.app/api/messages/ws?threadId=abc")).toBe("wss://myiso.app/api/messages/ws");
  });

  it("removes email addresses, plain or URL-encoded", () => {
    expect(scrubText("No account for Ada.Lovelace+iso@example.co.uk yet")).toBe(
      "No account for [email] yet",
    );
    expect(scrubText("email=a%40b.co")).toBe("email=[email]");
  });

  it("removes invite codes in any letter case", () => {
    expect(scrubText("Invite ISO-SARAH-K7M2P9QX is full")).toBe("Invite [invite-code] is full");
    expect(scrubText("code iso-abc-abcdefgh")).toBe("code [invite-code]");
  });

  it("removes six-digit sign-in codes only when asked, and only standalone ones", () => {
    expect(scrubText("Code 123456 is wrong")).toBe("Code 123456 is wrong");
    expect(scrubText("Code 123456 is wrong", { codes: true })).toBe("Code [code] is wrong");
    expect(scrubText("code: 123456.", { codes: true })).toBe("code: [code].");
    // Not codes: longer or shorter numbers, ids, versions, paths, file names.
    for (const text of [
      "took 1234567 ms",
      "12345 rows",
      "id 01a1ce05-123456-725a",
      "v1.123456.0",
      "/_next/static/chunks/123456.js",
      "chunk-123456.js",
      "abc123456",
    ]) {
      expect(scrubText(text, { codes: true })).toBe(text);
    }
  });

  it("leaves ordinary text, paths and package names alone", () => {
    for (const text of [
      "Cannot read properties of undefined (reading 'map')",
      "/app/discover/matches",
      "https://myiso.app/photographer/@sarah",
      "node_modules/@trpc/server/dist/index.mjs",
      "next@16.4.6/node_modules/next/dist/server.js",
      "1.447.12",
      "2026-11-12T04:23:14.768Z",
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});

describe("scrubProperties", () => {
  it("scrubs every URL-bearing property posthog-js sets, whatever its name", () => {
    const scrubbed = scrubProperties({
      $current_url: WAITLIST_RAW,
      $external_click_url: INVITE,
      $host: "myiso.app",
      $initial_current_url: INVITE,
      $initial_referrer: WAITLIST,
      $pathname: "/join",
      $prev_pageview_pathname: "/join",
      $referrer: `${INVITE}#x`,
      $referring_domain: "myiso.app",
      $session_entry_referrer: WAITLIST,
      $session_entry_url: INVITE,
      some_future_url_property: WAITLIST_RAW,
    });

    expect(scrubbed).toEqual({
      $current_url: "https://myiso.app/join",
      $external_click_url: "https://myiso.app/join",
      $host: "myiso.app",
      $initial_current_url: "https://myiso.app/join",
      $initial_referrer: "https://myiso.app/join",
      $pathname: "/join",
      $prev_pageview_pathname: "/join",
      $referrer: "https://myiso.app/join",
      $referring_domain: "myiso.app",
      $session_entry_referrer: "https://myiso.app/join",
      $session_entry_url: "https://myiso.app/join",
      some_future_url_property: "https://myiso.app/join",
    });
  });

  it("scrubs autocapture links, nested elements and the elements chain", () => {
    const scrubbed = scrubProperties({
      $elements: [
        { attr__href: "/join?code=ISO-TEST-ABCDEFGH", tag_name: "a", $el_text: "Join" },
        { attr__href: INVITE, attributes: { "attr__data-email": "a@b.co" }, tag_name: "a" },
      ],
      $elements_chain: 'a.link:attr__href="/join?waitlist=approved&email=a@b.co"nth-child="1";div',
    });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toMatch(/@|code=|ISO-TEST|email=/);
    expect(scrubbed.$elements_chain).toBe('a.link:attr__href="/join"nth-child="1";div');
  });

  it("scrubs exception messages and stack frames, sign-in codes included", () => {
    const scrubbed = scrubProperties({
      $exception_list: [
        {
          mechanism: { handled: false },
          stacktrace: {
            frames: [
              {
                abs_path: "https://myiso.app/_next/static/chunks/123456.js?dpl=abc",
                colno: 123456,
                context_line: 'throw new Error("no user a@b.co")',
                filename: "/_next/static/chunks/123456.js",
                lineno: 12,
              },
            ],
          },
          type: "Error",
          value: `Code 654321 rejected for a@b.co at ${INVITE}`,
        },
      ],
      $exception_message: "Invite ISO-TEST-ABCDEFGH used; code 654321",
    });

    const [exception] = scrubbed.$exception_list as Array<{
      stacktrace: { frames: Array<Record<string, unknown>> };
      value: string;
    }>;
    expect(exception?.value).toBe("Code [code] rejected for [email] at https://myiso.app/join");
    expect(scrubbed.$exception_message).toBe("Invite [invite-code] used; code [code]");
    const frame = exception?.stacktrace.frames[0];
    // File names survive (source maps resolve by them); numbers are not text.
    expect(frame?.abs_path).toBe("https://myiso.app/_next/static/chunks/123456.js");
    expect(frame?.filename).toBe("/_next/static/chunks/123456.js");
    expect(frame?.colno).toBe(123456);
    expect(frame?.context_line).toBe('throw new Error("no user [email]")');
  });

  it("does not treat six-digit numbers outside exceptions as codes", () => {
    expect(scrubProperties({ order: "123456", $exception_message: "123456" })).toEqual({
      $exception_message: "[code]",
      order: "123456",
    });
  });

  it("keeps non-string values and the replay payload as they are", () => {
    const snapshot = [{ data: "H4sIAAAA...a@b.co", type: 3 }];
    const scrubbed = scrubProperties({
      $snapshot_data: snapshot,
      count: 3,
      flag: true,
      nothing: null,
      when: 1731384000,
    });
    expect(scrubbed.$snapshot_data).toBe(snapshot);
    expect(scrubbed).toMatchObject({ count: 3, flag: true, nothing: null, when: 1731384000 });
  });

  it("does not modify its input", () => {
    const input = { $current_url: INVITE, nested: { url: INVITE } };
    scrubProperties(input);
    expect(input).toEqual({ $current_url: INVITE, nested: { url: INVITE } });
  });

  it("copes with very deep structures", () => {
    let deep: Record<string, unknown> = { url: INVITE };
    for (let i = 0; i < 50; i++) deep = { deep };
    expect(() => scrubProperties(deep)).not.toThrow();
  });
});

describe("scrubPersonProperties", () => {
  it("keeps the email and name set on purpose, scrubs everything else", () => {
    expect(
      scrubPersonProperties({
        $initial_current_url: WAITLIST_RAW,
        $initial_referrer: INVITE,
        email: "sarah@example.com",
        name: "Sarah Chen",
        note: "reach me at sarah@example.com",
      }),
    ).toEqual({
      $initial_current_url: "https://myiso.app/join",
      $initial_referrer: "https://myiso.app/join",
      email: "sarah@example.com",
      name: "Sarah Chen",
      note: "reach me at [email]",
    });
  });

  it("is applied to $set and $set_once inside properties too", () => {
    const scrubbed = scrubProperties({
      $set: { email: "sarah@example.com", last_url: INVITE },
      $set_once: { $initial_current_url: WAITLIST_RAW },
    });
    expect(scrubbed).toEqual({
      $set: { email: "sarah@example.com", last_url: "https://myiso.app/join" },
      $set_once: { $initial_current_url: "https://myiso.app/join" },
    });
  });
});
