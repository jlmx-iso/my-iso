// @vitest-environment happy-dom
//
// The member's invite page: the code and a /join link to copy, how many
// invites are used (and that a new code adds none), the people already
// invited, and regenerating the code after a confirmation (shown at once,
// kept on failure with the reason).

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import Page from "./page";

type InviteCode = RouterOutputs["invite"]["getMyCode"];
type InviteHandlers = NonNullable<TrpcHandlers["invite"]>;

function code(overrides: Record<string, unknown> = {}) {
  return {
    code: "ISO-ANN-1234",
    currentRedemptions: 1,
    maxRedemptions: 5,
    redemptions: [
      {
        id: "r1",
        redeemedAt: new Date("2030-05-01T12:00:00Z"),
        redeemedBy: { firstName: "Bea", lastName: "Cole", profilePic: null },
      },
    ],
    ...overrides,
  } as unknown as InviteCode;
}

function renderPage(invite: InviteHandlers) {
  return renderWithProviders(<Page />, { trpc: { invite } });
}

describe("invites page", () => {
  it("shows the code, the usage and the people invited", async () => {
    renderPage({ getMyCode: () => code() });

    expect(screen.getByText("Loading your invite code…")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Your invite code: ISO-ANN-1234" })).toBeTruthy();
    expect(within(screen.getByTestId("invite-usage")).getByText("1 of 5 invites used")).toBeTruthy();
    expect(screen.getByText("4 left")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Invites used" }).getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByText("People you've invited")).toBeTruthy();
    expect(screen.getByText("Bea Cole")).toBeTruthy();
    expect(screen.queryByText(/You've used all/)).toBeNull();
  });

  it("copies the code and a join link", async () => {
    const user = userEvent.setup();
    renderPage({ getMyCode: () => code() });

    await user.click(await screen.findByRole("button", { name: "Copy code" }));
    expect(await navigator.clipboard.readText()).toBe("ISO-ANN-1234");
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/join?code=ISO-ANN-1234`);
  });

  it("says when every invite is used, and lists nobody when nobody joined", async () => {
    renderPage({ getMyCode: () => code({ currentRedemptions: 5, redemptions: [] }) });
    expect(await screen.findByText(/You've used all 5 of your invites/)).toBeTruthy();
    expect(screen.getByText("0 left")).toBeTruthy();
    expect(screen.queryByText("People you've invited")).toBeNull();
  });

  it("regenerates the code after confirming, keeping the invites used", async () => {
    let current = code();
    const view = renderPage({
      getMyCode: () => current,
      regenerate: () => {
        current = code({ code: "ISO-ANN-9999" });
        return { code: "ISO-ANN-9999" } as never;
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Regenerate code" }));
    const dialog = await screen.findByRole("dialog", { name: "Regenerate invite code?" });
    expect(within(dialog).getByText(/\(1 of 5\) stays the same/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Yes, regenerate" }));

    expect(await screen.findByRole("heading", { name: "Your invite code: ISO-ANN-9999" })).toBeTruthy();
    expect(screen.getByText("New invite code ready")).toBeTruthy();
    expect(view.callsTo("invite.regenerate")).toEqual([undefined]);
    expect(screen.getByText("1 of 5 invites used")).toBeTruthy();
  });

  it("keeps the code when regenerating fails, and says why", async () => {
    renderPage({
      getMyCode: () => code(),
      regenerate: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate code" }));
    await userEvent.click(await screen.findByRole("button", { name: "Yes, regenerate" }));

    expect(await screen.findByText("We couldn't create a new code. Your current one still works.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your invite code: ISO-ANN-1234" })).toBeTruthy();
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    const view = renderPage({ getMyCode: () => code(), regenerate: () => ({}) as never });
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate code" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.callsTo("invite.regenerate")).toEqual([]);
  });

  it("says when the code could not be loaded", async () => {
    renderPage({
      getMyCode: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await screen.findByText("Could not load invite code")).toBeTruthy();
    expect(screen.getByText("We couldn't reach ISO. Check your connection and try again.")).toBeTruthy();
  });
});
