// @vitest-environment happy-dom
//
// Starting a conversation: search (only from two characters, once per pause
// in typing), pick someone, write, send; someone the member already talks
// to opens that conversation instead; ?new=<id> links open the composer
// for that person, or say why they cannot be messaged; failures are said in
// the dialog.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { NOT_MESSAGEABLE_MESSAGE } from "~/_utils/userError";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import NewMessageModal, { type Recipient } from "./NewMessageModal";

const BEA: Recipient = {
  firstName: "Bea",
  id: "bea",
  lastName: "Cole",
  photographer: { companyName: "Cole Studio", id: "ph-bea" },
  profilePic: null,
};
const BEN: Recipient = { firstName: "Ben", id: "ben", lastName: "Ito", photographer: null, profilePic: null };

type Thread = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["message"]>["getThreadByParticipants"]>>>;
const thread = (id: string) => ({ id }) as unknown as Thread;

function renderModal(message: TrpcHandlers["message"] = {}) {
  return renderWithProviders(<NewMessageModal />, {
    trpc: {
      message: {
        createThread: () => ({ id: "thread-new" }) as never,
        getPotentialRecipients: ({ query }) => [BEA, BEN].filter((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(query.toLowerCase())),
        getThreadByParticipants: () => null as Thread,
        ...message,
      },
    },
  });
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "New message" }));
  return screen.findByRole("dialog", { name: "New message" });
}

const recipientField = (dialog: HTMLElement) => within(dialog).getByLabelText(/^Recipient/, { selector: "input" });

async function pickBea(dialog: HTMLElement) {
  await userEvent.type(recipientField(dialog), "be");
  await userEvent.click(await screen.findByRole("option", { name: "Bea Cole" }));
}

describe("NewMessageModal", () => {
  it("searches from two characters, once per pause, and explains who can be messaged", async () => {
    const view = renderModal();
    const dialog = await openDialog();

    expect(within(dialog).getByText(/You can message photographers who are visible in Discover/)).toBeTruthy();
    await userEvent.type(recipientField(dialog), "b");
    // Past the debounce, inside act: the dropdown's transition settles too.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(view.callsTo("message.getPotentialRecipients")).toEqual([]);

    await userEvent.type(recipientField(dialog), "e");
    expect(await screen.findByRole("option", { name: "Bea Cole" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ben Ito" })).toBeTruthy();
    expect(view.callsTo("message.getPotentialRecipients")).toEqual([{ query: "be" }]);
  });

  it("says when nobody matches, and where to find people", async () => {
    renderModal();
    const dialog = await openDialog();

    await userEvent.type(recipientField(dialog), "zz");

    const empty = await within(dialog).findByTestId("recipient-empty");
    expect(empty.textContent).toContain("No one to message matches “zz”");
    expect(within(empty).getByRole("link", { name: "Discover" }).getAttribute("href")).toBe("/app/discover");
    expect(within(empty).getByRole("link", { name: "events" }).getAttribute("href")).toBe("/app/events");
  });

  it("shows why a search failed on the field", async () => {
    renderModal({
      getPotentialRecipients: () => {
        throw trpcError("TOO_MANY_REQUESTS", "Searching too fast. Wait 10 seconds.");
      },
    });
    const dialog = await openDialog();

    await userEvent.type(recipientField(dialog), "be");

    expect(await within(dialog).findByText("Searching too fast. Wait 10 seconds.")).toBeTruthy();
  });

  it("sends the first message to the picked person and opens the new conversation", async () => {
    const view = renderModal();
    const dialog = await openDialog();

    await pickBea(dialog);

    expect(await within(dialog).findByText("Bea Cole")).toBeTruthy();
    expect(within(dialog).getByText("Cole Studio")).toBeTruthy();
    expect(view.callsTo("message.getThreadByParticipants")).toEqual([{ participants: ["bea"] }]);

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Message" }), "  Hi Bea!  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith("/app/messages/thread-new"));
    expect(view.callsTo("message.createThread")).toEqual([{ initialMessage: "Hi Bea!", participants: ["bea"] }]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New message" })).toBeNull());
  });

  it("asks for a message before sending, and sends with Ctrl+Enter", async () => {
    const view = renderModal();
    const dialog = await openDialog();
    await pickBea(dialog);

    await userEvent.click(await within(dialog).findByRole("button", { name: "Send message" }));
    expect(await within(dialog).findByText("Write a message first")).toBeTruthy();
    expect(view.callsTo("message.createThread")).toEqual([]);

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Message" }), "Hello{Control>}{Enter}{/Control}");
    await waitFor(() => expect(view.callsTo("message.createThread")).toEqual([{ initialMessage: "Hello", participants: ["bea"] }]));
  });

  it("keeps the draft and says why when the message is not sent", async () => {
    renderModal({
      createThread: () => {
        throw trpcError("TOO_MANY_REQUESTS", "{}", { reason: ErrorReason.NEW_CONVERSATION_LIMIT });
      },
    });
    const dialog = await openDialog();
    await pickBea(dialog);

    const box = await within(dialog).findByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
    await userEvent.type(box, "Hello");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send message" }));

    expect((await within(dialog).findByTestId("compose-error")).textContent).toMatch(/You've reached today's limit/);
    expect(box.value).toBe("Hello");
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("opens the existing conversation instead of starting a second one", async () => {
    const view = renderModal({ getThreadByParticipants: () => thread("thread-old") });
    const dialog = await openDialog();

    await pickBea(dialog);

    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith("/app/messages/thread-old"));
    expect(view.callsTo("message.createThread")).toEqual([]);
  });

  it("still lets the member write when the existing-conversation check fails", async () => {
    renderModal({
      getThreadByParticipants: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "db down");
      },
    });
    const dialog = await openDialog();

    await pickBea(dialog);

    expect(await within(dialog).findByRole("textbox", { name: "Message" })).toBeTruthy();
  });

  it("goes back to the search with Change", async () => {
    renderModal();
    const dialog = await openDialog();
    await pickBea(dialog);

    await userEvent.click(await within(dialog).findByRole("button", { name: "Change" }));

    expect(recipientField(dialog)).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: "Message" })).toBeNull();
  });

  describe("?new=<user id>", () => {
    it("opens the composer for that person, and drops ?new when closed", async () => {
      testRouter.setLocation("/app/messages", "new=bea");
      const view = renderModal({ getRecipientById: () => BEA });

      const dialog = await screen.findByRole("dialog", { name: "New message" });
      expect(await within(dialog).findByText("Bea Cole")).toBeTruthy();
      expect(view.callsTo("message.getRecipientById")).toEqual([{ userId: "bea" }]);
      expect(view.callsTo("message.getThreadByParticipants")).toEqual([{ participants: ["bea"] }]);

      await userEvent.keyboard("{Escape}");

      expect(testRouter.replace).toHaveBeenCalledWith("/app/messages");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New message" })).toBeNull());
    });

    it("opens the conversation the two already have", async () => {
      testRouter.setLocation("/app/messages", "new=bea");
      renderModal({ getRecipientById: () => BEA, getThreadByParticipants: () => thread("thread-old") });

      await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith("/app/messages/thread-old"));
    });

    it("says the person cannot be messaged yet, and offers the search", async () => {
      testRouter.setLocation("/app/messages", "new=carol");
      renderModal({
        getRecipientById: () => {
          throw trpcError("FORBIDDEN", "Not allowed", { reason: ErrorReason.RECIPIENT_NOT_MESSAGEABLE });
        },
      });

      const dialog = await screen.findByRole("dialog", { name: "New message" });
      expect(await within(dialog).findByText(NOT_MESSAGEABLE_MESSAGE)).toBeTruthy();
      expect(recipientField(dialog)).toBeTruthy();
    });

    it("says the person was not found", async () => {
      testRouter.setLocation("/app/messages", "new=ghost");
      renderModal({ getRecipientById: () => null });

      const dialog = await screen.findByRole("dialog", { name: "New message" });
      expect(await within(dialog).findByText("We couldn't find that person. Search for someone else instead.")).toBeTruthy();
    });
  });
});
