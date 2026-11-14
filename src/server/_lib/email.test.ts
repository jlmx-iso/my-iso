import { readFileSync } from "node:fs";
import path from "node:path";

import type { SendEmail as EmailBinding } from "@cloudflare/workers-types";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  EMAIL_NOT_CONFIGURED,
  emailBinding,
  isRecipientSuppressed,
  sendEmail,
  sendTemplateEmail,
  type TemplateName,
} from "./email";
import type * as EmailTemplates from "./emails";

type NodeEnv = "development" | "production" | "test";

const envRef = vi.hoisted(() => ({
  env: {
    AUTH_SECRET: "test-auth-secret-0123456789abcdef0123",
    EMAIL_FROM: "sender@example.test",
    NODE_ENV: "test" satisfies NodeEnv,
  },
}));
vi.mock("~/env", () => envRef);

const cloudflare = vi.hoisted(() => ({ getCloudflareContext: vi.fn((): unknown => { throw new Error("not on Cloudflare"); }) }));
vi.mock("@opennextjs/cloudflare", () => cloudflare);

const renderWelcome = vi.hoisted(() => vi.fn(async () => "<p>Welcome</p>"));
vi.mock("./emails", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailTemplates>()),
  renderWelcomeEmail: renderWelcome,
}));


const RECIPIENT = "member@example.com";

type Message = { from: string; html: string; subject: string; text: string; to: string };

/**
 * A stand-in for the binding: `send` records each message and accepts it,
 * or rejects with `failure` when one is given.
 */
function fakeBinding(failure?: unknown) {
  const send = vi.fn<(message: Message) => Promise<{ messageId: string }>>();
  if (failure === undefined) send.mockResolvedValue({ messageId: "m1" });
  else send.mockRejectedValue(failure);
  return { binding: { send } as unknown as EmailBinding, send };
}

/** An error shaped like the ones the binding throws. */
function serviceError(code: string): Error {
  return Object.assign(new Error(`cannot send to ${RECIPIENT}`), { code });
}

let logs: { error: MockInstance; info: MockInstance; warn: MockInstance };
const logged = () => JSON.stringify([...logs.error.mock.calls, ...logs.info.mock.calls, ...logs.warn.mock.calls]);

beforeEach(() => {
  envRef.env.NODE_ENV = "test";
  cloudflare.getCloudflareContext.mockImplementation(() => {
    throw new Error("not on Cloudflare");
  });
  logs = {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    info: vi.spyOn(console, "log").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emailBinding", () => {
  it("is the Worker's EMAIL binding", () => {
    const { binding } = fakeBinding();
    cloudflare.getCloudflareContext.mockReturnValue({ env: { EMAIL: binding } });
    expect(emailBinding()).toBe(binding);
  });

  it("is null when the Worker has none, or off Cloudflare", () => {
    cloudflare.getCloudflareContext.mockReturnValue({ env: {} });
    expect(emailBinding()).toBeNull();
    cloudflare.getCloudflareContext.mockImplementation(() => {
      throw new Error("not on Cloudflare");
    });
    expect(emailBinding()).toBeNull();
  });
});

describe("sendEmail", () => {
  it("sends HTML and a plain-text part from EMAIL_FROM", async () => {
    const { binding, send } = fakeBinding();
    const result = await sendEmail(
      { email: RECIPIENT, html: "<h1>Hello</h1><p>Your code is <strong>123456</strong>.</p>", subject: "Hi" },
      binding,
    );

    expect(result.isOk).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [message] = send.mock.calls[0] ?? [];
    expect(message).toMatchObject({
      from: "sender@example.test",
      html: "<h1>Hello</h1><p>Your code is <strong>123456</strong>.</p>",
      subject: "Hi",
      to: RECIPIENT,
    });
    expect(message?.text).toContain("Your code is 123456.");
    expect(message?.text).not.toContain("<");
  });

  it("uses the request's binding when none is passed", async () => {
    const { binding, send } = fakeBinding();
    cloudflare.getCloudflareContext.mockReturnValue({ env: { EMAIL: binding } });
    const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "s" });
    expect(result.isOk).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports a suppressed recipient as a warning, without the address", async () => {
    const { binding } = fakeBinding(serviceError("E_RECIPIENT_SUPPRESSED"));
    const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "s" }, binding);

    expect(result.isErr).toBe(true);
    if (!result.isErr) return;
    expect(result.error.code).toBe("E_RECIPIENT_SUPPRESSED");
    expect(isRecipientSuppressed(result.error)).toBe(true);
    expect(result.error.message).not.toContain(RECIPIENT);
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(logs.error).not.toHaveBeenCalled();
    expect(logged()).toContain("E_RECIPIENT_SUPPRESSED");
    expect(logged()).not.toContain(RECIPIENT);
  });

  it("reports any other refusal as an error, keeping only the code", async () => {
    const { binding } = fakeBinding(serviceError("E_DAILY_LIMIT_EXCEEDED"));
    const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "s" }, binding);

    expect(result.isErr && result.error.code).toBe("E_DAILY_LIMIT_EXCEEDED");
    expect(result.isErr && isRecipientSuppressed(result.error)).toBe(false);
    expect(result.isErr && result.error.message).toBe("Email Service refused the message (E_DAILY_LIMIT_EXCEEDED)");
    expect(logs.error).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(RECIPIENT);
  });

  it("does not trust a thrown value without an Email Service code", async () => {
    for (const thrown of [new Error(`no route to ${RECIPIENT}`), Object.assign(new Error("x"), { code: 42 }), "boom", null, { code: "not-a-code" }]) {
      const { binding } = fakeBinding(thrown);
      const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "s" }, binding);
      expect(result.isErr && result.error.code).toBe("E_UNKNOWN");
    }
    expect(logged()).not.toContain(RECIPIENT);
  });

  it("without a binding, sends nothing and says email is not configured", async () => {
    const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "123456 is your code" });

    expect(result.isErr && result.error.code).toBe(EMAIL_NOT_CONFIGURED);
    // Outside local development nothing about the message is logged.
    expect(logs.info).not.toHaveBeenCalled();
    expect(logged()).not.toContain("123456");
  });

  it("in local development, logs the subject and a hash of the recipient", async () => {
    envRef.env.NODE_ENV = "development";
    const result = await sendEmail({ email: RECIPIENT, html: "<p>x</p>", subject: "123456 is your code" });

    expect(result.isErr && result.error.code).toBe(EMAIL_NOT_CONFIGURED);
    expect(logs.info).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("123456 is your code");
    expect(String(logs.info.mock.calls[0]?.[0])).toMatch(/"recipient": "[0-9a-f]{32}"/);
    expect(logged()).not.toContain(RECIPIENT);
  });
});

describe("isRecipientSuppressed", () => {
  it("is true only for an error with that code", () => {
    expect(isRecipientSuppressed(serviceError("E_RECIPIENT_SUPPRESSED"))).toBe(true);
    expect(isRecipientSuppressed(serviceError("E_DELIVERY_FAILED"))).toBe(false);
    expect(isRecipientSuppressed({ code: "E_RECIPIENT_SUPPRESSED" })).toBe(false);
    expect(isRecipientSuppressed(undefined)).toBe(false);
  });
});

describe("sendTemplateEmail", () => {
  it("renders the template and sends it", async () => {
    const { binding, send } = fakeBinding();
    cloudflare.getCloudflareContext.mockReturnValue({ env: { EMAIL: binding } });

    const result = await sendTemplateEmail({
      email: RECIPIENT,
      props: { name: "Ada" },
      subject: "You're on the list",
      template: "waitlist-confirmation",
    });

    expect(result.isOk).toBe(true);
    const [message] = send.mock.calls[0] ?? [];
    expect(message?.subject).toBe("You're on the list");
    expect(message?.html).toContain("Ada, you&#x27;re on the list.");
    // Headings come out in capitals in the text part.
    expect(message?.text).toMatch(/ada, you're on the list\./i);
  });

  it("refuses a template it does not know", async () => {
    const result = await sendTemplateEmail({
      email: RECIPIENT,
      props: {},
      subject: "s",
      template: "no-such-template" as TemplateName,
    });
    expect(result.isErr && result.error.message).toContain('Unknown email template: "no-such-template"');
  });

  it("returns a render failure instead of throwing", async () => {
    renderWelcome.mockRejectedValueOnce(new Error("bad props"));
    const result = await sendTemplateEmail({
      email: RECIPIENT,
      props: { firstName: "Ada", profileUrl: "https://example.test/p" },
      subject: "s",
      template: "welcome",
    });
    expect(result.isErr && result.error.message).toBe("bad props");

    renderWelcome.mockRejectedValueOnce("not an error");
    const second = await sendTemplateEmail({
      email: RECIPIENT,
      props: { firstName: "Ada", profileUrl: "https://example.test/p" },
      subject: "s",
      template: "welcome",
    });
    expect(second.isErr && second.error.message).toBe("not an error");
  });
});

describe("wrangler.toml", () => {
  const toml = readFileSync(path.resolve(__dirname, "../../../wrangler.toml"), "utf8");

  /** The `[[send_email]]` tables of production (top level) and staging. */
  const bindings = (prefix: string) =>
    [...toml.matchAll(new RegExp(`^\\[\\[${prefix.replace(/\./g, "\\.")}send_email\\]\\]\\n((?:(?!\\[).*\\n)*)`, "gm"))].map(
      (match) => match[1] ?? "",
    );

  /** EMAIL_FROM in an environment's [vars], if it is set there. */
  const emailFrom = (prefix: string) => {
    const vars = new RegExp(`^\\[${prefix.replace(/\./g, "\\.")}vars\\]\\n((?:(?!\\[).*\\n)*)`, "m").exec(toml)?.[1] ?? "";
    return /^EMAIL_FROM\s*=\s*"([^"]+)"/m.exec(vars)?.[1];
  };

  it.each([
    ["production", ""],
    ["staging", "env.staging."],
  ])("binds EMAIL in %s, allowing at most the sender the app uses", (_name, prefix) => {
    const tables = bindings(prefix).filter((body) => /^name\s*=\s*"EMAIL"/m.test(body));
    expect(tables).toHaveLength(1);
    const allowed = /^allowed_sender_addresses\s*=\s*\[([^\]]*)\]/m.exec(tables[0] ?? "")?.[1];
    if (allowed !== undefined) {
      // A restricted binding refuses every other sender: it must allow EMAIL_FROM.
      const from = emailFrom(prefix);
      expect(from, "EMAIL_FROM in [vars] next to allowed_sender_addresses").toBeDefined();
      expect(allowed).toContain(`"${from}"`);
    }
  });
});
