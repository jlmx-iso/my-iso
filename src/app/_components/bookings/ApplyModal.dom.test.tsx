// @vitest-environment happy-dom
//
// Applying to an event: the dialog sends the trimmed rate and notes,
// confirms and closes; a refusal is explained inside the dialog (and gone
// when it is reopened); the dialog cannot be closed while sending.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { REASON_MESSAGES } from "~/_utils/userError";
import { allowConsoleError, renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import ApplyModal from "./ApplyModal";

function renderModal(applyToEvent: NonNullable<TrpcHandlers["booking"]>["applyToEvent"]) {
  const onSuccess = vi.fn();
  const view = renderWithProviders(
    <ApplyModal eventId="ev-1" eventTitle="Garden wedding" label="Apply" onSuccess={onSuccess} />,
    { trpc: { booking: { applyToEvent } } },
  );
  return { ...view, onSuccess };
}

const DIALOG = 'Apply to "Garden wedding"';

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  return screen.findByRole("dialog", { name: DIALOG });
}

describe("ApplyModal", () => {
  it("sends the trimmed rate and notes, confirms, closes and tells the page", async () => {
    const view = renderModal(() => ({}) as never);
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /Your rate/ }), "  $200 flat ");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Notes/ }), " Ten years of weddings. ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send application" }));

    expect(await screen.findByText("Your application has been sent to the event owner.")).toBeTruthy();
    expect(view.callsTo("booking.applyToEvent")).toEqual([
      { eventId: "ev-1", notes: "Ten years of weddings.", rate: "$200 flat" },
    ]);
    expect(view.onSuccess).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: DIALOG })).toBeNull());
  });

  it("leaves out an empty rate and notes", async () => {
    const view = renderModal(() => ({}) as never);
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Send application" }));

    await waitFor(() =>
      expect(view.callsTo("booking.applyToEvent")).toEqual([{ eventId: "ev-1", notes: undefined, rate: undefined }]),
    );
  });

  it("explains a refusal inside the dialog, and starts clean when reopened", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Error applying to event/);
    const view = renderModal(() => {
      throw trpcError("CONFLICT", "Event filled", { reason: ErrorReason.BOOKING_EVENT_FILLED });
    });
    let dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Send application" }));

    const alert = await within(dialog).findByTestId("apply-error");
    expect(alert.textContent).toContain("Application not sent");
    expect(alert.textContent).toContain(REASON_MESSAGES[ErrorReason.BOOKING_EVENT_FILLED]);
    expect(document.querySelectorAll(".mantine-Notification-root")).toHaveLength(0);
    expect(view.onSuccess).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: DIALOG })).toBeNull());
    dialog = await openDialog();
    expect(within(dialog).queryByTestId("apply-error")).toBeNull();
  });

  it("cannot be closed while sending", async () => {
    let answer!: () => void;
    renderModal(() => new Promise((resolve) => (answer = () => resolve({} as never))));
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Send application" }));

    await waitFor(() => expect(dialog.querySelector(".mantine-Modal-close")).toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: DIALOG })).toBeTruthy();

    await act(async () => answer());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: DIALOG })).toBeNull());
  });
});
