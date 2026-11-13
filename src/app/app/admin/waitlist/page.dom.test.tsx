// @vitest-environment happy-dom
//
// The founders' waitlist review: applications by status, a page at a time,
// each pending one approved or declined through a confirmation that names
// the person, with the list refreshed and a toast on success and the reason
// in the dialog on failure. A non-founder is told the page is not theirs.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import Page from "./page";

type Entry = RouterOutputs["waitlist"]["getAll"]["items"][number];
type WaitlistHandlers = NonNullable<TrpcHandlers["waitlist"]>;

const CREATED = new Date("2030-05-01T12:00:00Z");

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "name">): Entry {
  return {
    convertedAt: null,
    createdAt: CREATED,
    email: `${overrides.id}@example.com`,
    instagram: null,
    position: null,
    referralSource: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedById: null,
    status: "pending",
    userType: "both",
    website: null,
    ...overrides,
  };
}

const ANN = entry({
  id: "ann",
  instagram: "@ann.shoots",
  name: "Ann Lee",
  position: 4,
  referralSource: "A friend",
  userType: "second",
  website: "ann.photo",
});
const BEN = entry({ id: "ben", instagram: "https://instagram.com/ben", name: "Ben Ito", userType: "lead" });

function page(items: Entry[], total = items.length, totalPages = 1) {
  return { items, page: 1, total, totalPages };
}

function renderPage(handlers: WaitlistHandlers = {}) {
  return renderWithProviders(<Page />, {
    trpc: {
      waitlist: {
        approve: () => ({ success: true }),
        getAll: () => page([ANN, BEN]),
        reject: () => ({ success: true }),
        ...handlers,
      },
    },
  });
}

const rows = () => screen.getAllByRole("listitem");

describe("admin waitlist review", () => {
  it("lists the pending applications with their details and safe links", async () => {
    const view = renderPage();

    expect(screen.getByLabelText("Loading waitlist")).toBeTruthy();
    expect(await screen.findByText("Ann Lee")).toBeTruthy();
    expect(view.callsTo("waitlist.getAll")).toEqual([{ limit: 20, page: 1, status: "pending" }]);
    expect(screen.getByRole("radio", { name: "Pending (2)" })).toBeTruthy();

    const ann = within(rows()[0]!);
    expect(ann.getByText("ann@example.com")).toBeTruthy();
    expect(ann.getByText("Second")).toBeTruthy();
    expect(ann.getByText("Source: A friend")).toBeTruthy();
    expect(ann.getByText(/#4/)).toBeTruthy();
    expect(ann.getByRole("link", { name: /Instagram/ }).getAttribute("href")).toBe("https://instagram.com/ann.shoots");
    expect(ann.getByRole("link", { name: /Website/ }).getAttribute("href")).toBe("https://ann.photo/");
    expect(ann.getByRole("link", { name: /Website/ }).getAttribute("rel")).toBe("noopener noreferrer");

    const ben = within(rows()[1]!);
    expect(ben.getByText("Lead")).toBeTruthy();
    expect(ben.getByRole("link", { name: /Instagram/ }).getAttribute("href")).toBe("https://instagram.com/ben");
    expect(ben.queryByRole("link", { name: /Website/ })).toBeNull();
  });

  it("filters by status from the first page, and offers no decision on reviewed applications", async () => {
    const view = renderPage({
      getAll: ({ status }) =>
        status === "approved" ? page([entry({ id: "cat", name: "Cat Moe", status: "approved" })]) : page([ANN], 1),
    });
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("radio", { name: "Approved" }));

    expect(await screen.findByText("Cat Moe")).toBeTruthy();
    expect(view.callsTo("waitlist.getAll")).toContainEqual({ limit: 20, page: 1, status: "approved" });
    expect(screen.queryByRole("button", { name: "Approve Cat Moe" })).toBeNull();
    // The count belongs to the pending tab only.
    expect(screen.getByRole("radio", { name: "Pending" })).toBeTruthy();
  });

  it("says when there is nothing to review", async () => {
    renderPage({ getAll: () => page([], 0, 0) });
    expect(await screen.findByText("No pending applications.")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(await screen.findByText("No applications.")).toBeTruthy();
  });

  it("pages through the applications", async () => {
    const view = renderPage({
      getAll: ({ page: number }) => ({ ...page([number === 2 ? BEN : ANN], 25, 2), page: number }),
    });
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("button", { name: "2" }));

    expect(await screen.findByText("Ben Ito")).toBeTruthy();
    expect(view.callsTo("waitlist.getAll")).toContainEqual({ limit: 20, page: 2, status: "pending" });
  });

  it("approves after confirming, refreshes the list and says what happened", async () => {
    let approved = false;
    const view = renderPage({
      approve: () => {
        approved = true;
        return { success: true };
      },
      getAll: () => page(approved ? [BEN] : [ANN, BEN]),
    });
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("button", { name: "Approve Ann Lee" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve this application?" });
    expect(within(dialog).getByText("Ann Lee (ann@example.com) will be able to create an ISO account.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("Ann Lee can now join ISO with ann@example.com.")).toBeTruthy();
    expect(screen.getByText("Application approved")).toBeTruthy();
    expect(view.callsTo("waitlist.approve")).toEqual([{ id: "ann" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Ann Lee")).toBeNull());
  });

  it("declines after confirming", async () => {
    const view = renderPage();
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("button", { name: "Decline Ben Ito" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline this application?" });
    expect(within(dialog).getByText(/Ben Ito \(ben@example.com\) will be moved to Rejected/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline" }));

    expect(await screen.findByText("Ben Ito was moved to Rejected.")).toBeTruthy();
    expect(view.callsTo("waitlist.reject")).toEqual([{ id: "ben" }]);
    expect(view.callsTo("waitlist.approve")).toEqual([]);
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    const view = renderPage();
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("button", { name: "Approve Ann Lee" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve this application?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.callsTo("waitlist.approve")).toEqual([]);
  });

  it("explains a failed decision in the dialog and keeps it open", async () => {
    renderPage({
      reject: () => {
        throw trpcError("BAD_REQUEST", "Entry has already been reviewed.");
      },
    });
    await screen.findByText("Ann Lee");

    await userEvent.click(screen.getByRole("button", { name: "Decline Ann Lee" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline this application?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline" }));

    const error = await within(dialog).findByTestId("dialog-error");
    expect(error.textContent).toContain("Couldn't decline application");
    expect(error.textContent).toContain("Entry has already been reviewed.");

    // Closing clears it for the next decision.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve Ann Lee" }));
    const next = await screen.findByRole("dialog", { name: "Approve this application?" });
    expect(within(next).queryByTestId("dialog-error")).toBeNull();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    let calls = 0;
    renderPage({
      getAll: () => {
        calls += 1;
        if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
        return page([ANN]);
      },
    });

    expect(await screen.findByText("We couldn't load the waitlist")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ann Lee")).toBeTruthy();
  });

  it("tells a member who is not a founder or ambassador that the page is not theirs", async () => {
    renderPage({
      getAll: () => {
        throw trpcError("FORBIDDEN", "Forbidden");
      },
    });
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
