// @vitest-environment happy-dom
//
// How members get help: Pro members write to the team from a dialog that
// stays open with a confirmation after sending and keeps the message when
// sending fails; everyone else is pointed at the support address.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { allowConsoleError, renderWithProviders, trpcError } from "~/test/dom/render";

import SupportCard from "./SupportCard";

const REPLY_TO = "olive@example.com";

async function openAndFill() {
  await userEvent.click(screen.getByRole("button", { name: "Contact support" }));
  const dialog = await screen.findByRole("dialog", { name: "Contact priority support" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: /Subject/ }), "Invoice");
  await userEvent.type(within(dialog).getByRole("textbox", { name: /Message/ }), "My invoice shows the wrong name.");
  return dialog;
}

describe("SupportCard for a Pro member", () => {
  it("says messages are flagged Pro, shows where the reply goes, and confirms in the dialog", async () => {
    const view = renderWithProviders(<SupportCard isPro replyTo={REPLY_TO} />, {
      trpc: { support: { contact: () => ({ sent: true as const }) } },
    });
    expect(screen.getByText("Your messages are flagged Pro and read first.")).toBeTruthy();
    expect(screen.getByText("Priority")).toBeTruthy();

    const dialog = await openAndFill();
    expect(within(dialog).getByTestId("support-reply-to").textContent).toBe(REPLY_TO);
    // Nothing promises how soon.
    expect(dialog.textContent).not.toMatch(/hour|within|business day/i);

    await userEvent.click(within(dialog).getByRole("button", { name: "Send to support" }));
    expect(await within(dialog).findByText("Message sent")).toBeTruthy();
    expect(within(screen.getByTestId("support-sent")).getByText(REPLY_TO)).toBeTruthy();
    expect(view.callsTo("support.contact")).toEqual([{ message: "My invoice shows the wrong name.", subject: "Invoice" }]);

    // "Write another" goes back to an empty form; "Done" closes.
    await userEvent.click(within(dialog).getByRole("button", { name: "Write another" }));
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: /Subject/ }).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the confirmation with Done", async () => {
    renderWithProviders(<SupportCard isPro replyTo={REPLY_TO} />, {
      trpc: { support: { contact: () => ({ sent: true as const }) } },
    });
    const dialog = await openAndFill();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to support" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Opening again starts with the form, not the old confirmation.
    await userEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(await screen.findByRole("button", { name: "Send to support" })).toBeTruthy();
  });

  it("keeps the message and says what to do when sending fails", async () => {
    allowConsoleError(/Support request failed/);
    renderWithProviders(<SupportCard isPro replyTo={REPLY_TO} />, {
      trpc: {
        support: {
          contact: () => {
            throw trpcError("SERVICE_UNAVAILABLE", `Your message could not be sent. Please email ${SUPPORT_EMAIL} instead.`);
          },
        },
      },
    });
    const dialog = await openAndFill();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to support" }));
    const error = await within(dialog).findByTestId("support-error");
    expect(error.textContent).toContain(`email ${SUPPORT_EMAIL}`);
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: /Subject/ }).value).toBe("Invoice");
    expect(within(dialog).queryByText("Message sent")).toBeNull();
  });

  it("locks the subject and message while the message is being sent", async () => {
    let release: (value: { sent: true }) => void = () => undefined;
    renderWithProviders(<SupportCard isPro replyTo={REPLY_TO} />, {
      trpc: {
        support: {
          contact: () =>
            new Promise<{ sent: true }>((resolve) => {
              release = resolve;
            }),
        },
      },
    });
    const dialog = await openAndFill();
    const subject = within(dialog).getByRole<HTMLInputElement>("textbox", { name: /Subject/ });
    const message = within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: /Message/ });
    expect([subject.disabled, message.disabled]).toEqual([false, false]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to support" }));
    await waitFor(() => expect([subject.disabled, message.disabled]).toEqual([true, true]));
    release({ sent: true });
    expect(await within(dialog).findByText("Message sent")).toBeTruthy();
  });

  it("will not send a message that is too short", async () => {
    renderWithProviders(<SupportCard isPro replyTo={REPLY_TO} />);
    await userEvent.click(screen.getByRole("button", { name: "Contact support" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Subject/ }), "Hi");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Message/ }), "short");
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Send to support" }).disabled).toBe(true);
  });
});

describe("SupportCard for a member without Pro", () => {
  it("points at the support address, with no Pro dialog", () => {
    renderWithProviders(<SupportCard isPro={false} replyTo={REPLY_TO} />);
    const email = screen.getByRole("link", { name: "Email support" });
    expect(email.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}?subject=ISO%20support`);
    expect(screen.getByText(/Pro members get priority support/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Contact support" })).toBeNull();
    expect(screen.queryByText("Priority")).toBeNull();
  });
});
