// @vitest-environment happy-dom
//
// Editing an event: the owner's "Edit event" dialog starts from the event as
// it is, sends what changed (the start time and its zone only when the time
// moved; pay cleared with null), and asks before throwing changes away.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { allowConsoleError, renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import EditEventButton from "./EditEventButton";

type Updated = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["event"]>["update"]>>>;

const EVENT = {
  date: "2027-03-14T16:00:00.000Z",
  description: "Ceremony and portraits",
  duration: 6,
  id: "ev-1",
  location: "Austin, TX",
  payCents: 45_000,
  // 10:00 AM in Denver (daylight time from that morning, UTC-6).
  timeZone: "America/Denver",
  title: "Spring wedding",
};

const saved = () => ({ id: "ev-1", title: "Spring wedding" }) as Updated;

function renderEdit(update: NonNullable<TrpcHandlers["event"]>["update"] = saved) {
  return renderWithProviders(<EditEventButton event={EVENT} />, {
    trpc: { event: { update }, google: { getAutocompleteLocations: () => [] } },
  });
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Edit event" }));
  return screen.findByRole("dialog", { name: "Edit event" });
}

const titleField = (dialog: HTMLElement) => within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Title" });
const payField = (dialog: HTMLElement) => within(dialog).getByRole<HTMLInputElement>("textbox", { name: /^Pay/ });

describe("editing an event", () => {
  it("starts from the event as it is", async () => {
    renderEdit();
    const dialog = await openDialog();

    expect(titleField(dialog).value).toBe("Spring wedding");
    expect(payField(dialog).value).toBe("$450");
    // The picker reads as the clock does where the event is, not here (UTC).
    expect(within(dialog).getByLabelText<HTMLInputElement>(/^Time zone/, { selector: "input" }).value).toMatch(/^America\/Denver/);
    expect(within(dialog).getByRole("button", { name: /Date and time/ }).textContent).toContain("14 Mar 2027 10:00 AM");
    expect(within(dialog).getByText(/Leave empty to keep the current one/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("saves a new title and cleared pay without touching the start time, and confirms", async () => {
    const view = renderEdit();
    const dialog = await openDialog();

    await userEvent.clear(titleField(dialog));
    await userEvent.type(titleField(dialog), "Spring wedding, Hill Country");
    await userEvent.clear(payField(dialog));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Changes saved")).toBeTruthy();
    const [sent] = view.callsTo("event.update");
    expect(sent).toMatchObject({ id: "ev-1", payCents: null, title: "Spring wedding, Hill Country" });
    expect(sent).not.toHaveProperty("date");
    expect(sent).not.toHaveProperty("timeZone");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit event" })).toBeNull());
  });

  it("sends the start and its zone when the zone changes, keeping the clock time", async () => {
    const view = renderEdit();
    const dialog = await openDialog();

    const zone = within(dialog).getByLabelText(/^Time zone/, { selector: "input" });
    await userEvent.click(zone);
    await userEvent.clear(zone);
    await userEvent.type(zone, "New York");
    await userEvent.click(await screen.findByRole("option", { name: /America\/New York/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await screen.findByText("Changes saved");
    // 10:00 AM in New York (EDT, UTC-4).
    expect(view.callsTo("event.update")[0]).toMatchObject({ date: "2027-03-14T14:00:00.000Z", timeZone: "America/New_York" });
  });

  it("keeps the changes and says nothing was saved when the server fails", async () => {
    allowConsoleError(/Error updating event/);
    renderEdit(() => {
      throw trpcError("INTERNAL_SERVER_ERROR", "db down");
    });
    const dialog = await openDialog();

    await userEvent.type(titleField(dialog), "!");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("We couldn't save your changes. They are still here — please try again."),
    ).toBeTruthy();
    expect(titleField(dialog).value).toBe("Spring wedding!");
  });

  it("closes at once when nothing changed, and asks before throwing changes away", async () => {
    renderEdit();
    let dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit event" })).toBeNull());

    dialog = await openDialog();
    await userEvent.type(titleField(dialog), "!");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard your changes?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit event" })).toBeNull());
  });
});
