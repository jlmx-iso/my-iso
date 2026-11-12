import { describe, expect, it } from "vitest";

import {
  REDACTED_TOO_DEEP,
  scrubErrorForLog,
  scrubPersonProperties,
  scrubProperties,
  scrubText,
  stripUrlQuery,
} from "~/_lib/telemetryScrub";

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

  it("removes a query whole even when it contains parentheses", () => {
    expect(scrubText("https://myiso.app/join?token=(secret-value)")).toBe("https://myiso.app/join");
    expect(scrubText("see /join?token=(secret-value) now")).toBe("see /join now");
    expect(scrubText("x https://h/p?a=1(b)c&d=(e) y")).toBe("x https://h/p y");
    // A URL in parentheses: the closing one may go with the query, nothing else.
    expect(scrubText("(https://h/p?a=secret)")).toBe("(https://h/p");
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

  it("copes with very deep structures, and never passes the deep part on unscrubbed", () => {
    let deep: Record<string, unknown> = { url: INVITE };
    for (let i = 0; i < 50; i++) deep = { deep };
    expect(() => scrubProperties(deep)).not.toThrow();
    const serialized = JSON.stringify(scrubProperties(deep));
    expect(serialized).not.toContain("code=");
    expect(serialized).toContain(REDACTED_TOO_DEEP);

    // Just past the limit, and arrays count as levels too.
    let nested: unknown = { url: "/join?token=secret-value" };
    for (let i = 0; i < 8; i++) nested = i % 2 ? { nested } : [nested];
    expect(JSON.stringify(scrubProperties({ prop: nested }))).not.toContain("secret-value");
  });
});

describe("scrubPersonProperties", () => {
  it("drops name and email (any case, with or without \$) and scrubs everything else", () => {
    expect(
      scrubPersonProperties({
        $email: "sarah@example.com",
        $initial_current_url: WAITLIST_RAW,
        $initial_referrer: INVITE,
        Email: "sarah@example.com",
        first_name: "Sarah",
        last_name: "Chen",
        name: "Sarah Chen",
        note: "reach me at sarah@example.com",
        phone: "555 0100",
        plan: "pro",
      }),
    ).toEqual({
      $initial_current_url: "https://myiso.app/join",
      $initial_referrer: "https://myiso.app/join",
      note: "reach me at [email]",
      plan: "pro",
    });
  });

  it("is applied to $set and $set_once inside properties too", () => {
    const scrubbed = scrubProperties({
      $set: { email: "sarah@example.com", last_url: INVITE },
      $set_once: { $initial_current_url: WAITLIST_RAW },
    });
    expect(scrubbed).toEqual({
      $set: { last_url: "https://myiso.app/join" },
      $set_once: { $initial_current_url: "https://myiso.app/join" },
    });
  });
});

describe("scrubErrorForLog", () => {
  it("keeps the name and scrubs the message and the stack", () => {
    const error = new TypeError(`Sign-in for sarah@example.com with 123456 failed at ${INVITE}`);
    const logged = scrubErrorForLog(error);
    expect(logged.name).toBe("TypeError");
    const text = JSON.stringify(logged);
    for (const secret of ["sarah@example.com", "123456", "code="]) expect(text).not.toContain(secret);
    expect(logged.message).toContain("https://myiso.app/join");
    expect(logged.stack).toContain("TypeError");
  });

  it("reduces anything else to scrubbed text", () => {
    expect(scrubErrorForLog("bad /join?code=x for a@b.co")).toEqual({ message: "bad /join for [email]", name: "NonError" });
  });
});

// Cases found by mutation testing (npm run test:mutation): each pins a
// behaviour no earlier test noticed changing.
describe("scrubbing edge cases", () => {
  it("strips query strings from http:// and ws:// URLs, not just https:// and wss://", () => {
    expect(scrubText("GET http://localhost:3000/join?code=x failed")).toBe("GET http://localhost:3000/join failed");
    expect(scrubText("socket ws://localhost:8787/realtime?token=secret closed")).toBe(
      "socket ws://localhost:8787/realtime closed",
    );
  });

  it("does not take a six-digit file name for a code", () => {
    expect(scrubText("at 123456.js:10", { codes: true })).toBe("at 123456.js:10");
  });

  it("replaces an object or array exactly at the depth limit, and keeps the level above", () => {
    const REDACTED = "[too deep]";
    expect(REDACTED_TOO_DEEP).toBe(REDACTED);

    // A property's value is level 0; levels 0-7 are kept, level 8 is not.
    let objects: unknown = { leaf: "kept?" };
    for (let i = 0; i < 8; i++) objects = { child: objects };
    let level = scrubProperties({ prop: objects }).prop as Record<string, unknown>;
    for (let i = 0; i < 7; i++) level = level.child as Record<string, unknown>;
    expect(level).toEqual({ child: REDACTED });

    let arrays: unknown = ["kept?"];
    for (let i = 0; i < 8; i++) arrays = [arrays];
    let item = scrubProperties({ prop: arrays }).prop as unknown[];
    for (let i = 0; i < 7; i++) item = item[0] as unknown[];
    expect(item).toEqual([REDACTED]);
  });

  it("passes both replay payload properties through untouched", () => {
    const bytes = { compressed: "H4sI...sarah@example.com" };
    expect(scrubProperties({ $snapshot_bytes: bytes }).$snapshot_bytes).toBe(bytes);
  });

  it("drops email and name under $set and $set_once, and scrubs them elsewhere", () => {
    expect(
      scrubProperties({
        $set_once: { email: "sarah@example.com", name: "Sarah <sarah@example.com>" },
        other: { email: "sarah@example.com", name: "Sarah <sarah@example.com>" },
      }),
    ).toEqual({
      $set_once: {},
      other: { email: "[email]", name: "Sarah <[email]>" },
    });
  });

  it("scrubs a $set that is not an object like any other value", () => {
    expect(scrubProperties({ $set: ["sarah@example.com"], $set_once: null })).toEqual({
      $set: ["[email]"],
      $set_once: null,
    });
    expect(scrubProperties({ $set: "sarah@example.com" })).toEqual({ $set: "[email]" });
  });

  it("does not treat six-digit numbers in person properties as codes", () => {
    expect(scrubPersonProperties({ zip_hint: "123456" })).toEqual({ zip_hint: "123456" });
  });

  it("removes sign-in codes from thrown values that are not Errors", () => {
    expect(scrubErrorForLog("code 123456 rejected")).toEqual({ message: "code [code] rejected", name: "NonError" });
  });
});
