// @vitest-environment happy-dom
//
// Discover preferences: the visibility switch saves the moment it is
// toggled (and holds its new position while that is sent), being hidden is
// spelled out, and the matching preferences (types sought, budget range)
// are saved together, only when changed and only with a sane range.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import DiscoverPreferences from "./DiscoverPreferences";

type Preferences = RouterOutputs["discover"]["getPreferences"];
type DiscoverHandlers = NonNullable<TrpcHandlers["discover"]>;

const HIDDEN_NOTE = "You're hidden: nobody new can find, match with or message you until you turn this on.";

function preferences(overrides: Partial<Preferences> = {}): Preferences {
  return { budgetMax: null, budgetMin: null, isDiscoverable: true, photographer: null, seekingTypes: [], ...overrides };
}

/** A server that stores what it is sent, as discover.updatePreferences does. */
function server(initial: Preferences, update?: DiscoverHandlers["updatePreferences"]): DiscoverHandlers {
  let saved = initial;
  return {
    getPreferences: () => saved,
    updatePreferences:
      update ??
      ((input) => {
        saved = { ...saved, ...input };
        return { budgetMax: saved.budgetMax, budgetMin: saved.budgetMin, isDiscoverable: saved.isDiscoverable, seekingTypes: JSON.stringify(saved.seekingTypes) };
      }),
  };
}

function renderPreferences(discover: DiscoverHandlers) {
  return renderWithProviders(<DiscoverPreferences />, { trpc: { discover } });
}

const visibility = () => screen.getByRole<HTMLInputElement>("switch", { name: /Show my profile in Discover/ });

async function openPreferences() {
  const toggle = await screen.findByRole("button", { name: "Matching preferences" });
  await userEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Hide matching preferences" }).getAttribute("aria-expanded")).toBe("true");
}

describe("DiscoverPreferences", () => {
  it("renders nothing until the preferences are loaded, then the saved visibility", async () => {
    renderPreferences(server(preferences({ isDiscoverable: false })));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    expect((await screen.findByRole<HTMLInputElement>("switch", { name: /Show my profile in Discover/ })).checked).toBe(false);
    expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy();
  });

  it("saves visibility as soon as it is switched on, and says what it means", async () => {
    const view = renderPreferences(server(preferences({ isDiscoverable: false })));
    await screen.findByRole("switch", { name: /Show my profile in Discover/ });

    await userEvent.click(visibility());

    expect(await screen.findByText("You're visible in Discover")).toBeTruthy();
    expect(screen.getByText("Other photographers can now find and match with you.")).toBeTruthy();
    expect(view.callsTo("discover.updatePreferences")).toEqual([{ isDiscoverable: true }]);
    expect(visibility().checked).toBe(true);
    expect(screen.queryByText(HIDDEN_NOTE)).toBeNull();
  });

  it("hides the profile when switched off", async () => {
    const view = renderPreferences(server(preferences()));
    await screen.findByRole("switch", { name: /Show my profile in Discover/ });

    await userEvent.click(visibility());

    expect(await screen.findByText("You're hidden from Discover")).toBeTruthy();
    expect(view.callsTo("discover.updatePreferences")).toEqual([{ isDiscoverable: false }]);
    expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy();
  });

  it("puts the switch back and says so when the change could not be saved", async () => {
    renderPreferences(
      server(preferences(), () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      }),
    );
    await screen.findByRole("switch", { name: /Show my profile in Discover/ });

    await userEvent.click(visibility());

    expect(await screen.findByText("Couldn't update visibility")).toBeTruthy();
    expect(screen.getByText("Your visibility wasn't changed. Please try again.")).toBeTruthy();
    await waitFor(() => expect(visibility().checked).toBe(true));
  });

  it("saves the types sought and the budget range together, once something changed", async () => {
    const view = renderPreferences(server(preferences({ budgetMin: 100, seekingTypes: ["portrait"] })));
    await openPreferences();
    const save = screen.getByRole("button", { name: "Save preferences" });
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "portrait" }).checked).toBe(true);

    await userEvent.click(screen.getByRole("checkbox", { name: "wedding" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Max budget" }), "800");
    await userEvent.click(save);

    expect(await screen.findByText("Preferences saved")).toBeTruthy();
    expect(view.callsTo("discover.updatePreferences")).toEqual([
      { budgetMax: 800, budgetMin: 100, seekingTypes: ["portrait", "wedding"] },
    ]);
    // The form now starts from what was saved.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save preferences" }).hasAttribute("disabled")).toBe(true));
  });

  it("clears a budget, and saves nothing while the range is upside down", async () => {
    const view = renderPreferences(server(preferences({ budgetMax: 500, budgetMin: 100 })));
    await openPreferences();

    await userEvent.clear(screen.getByRole("textbox", { name: "Max budget" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Max budget" }), "50");
    expect(screen.getByText("Max budget must be at least the min budget")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(view.callsTo("discover.updatePreferences")).toEqual([]);

    await userEvent.clear(screen.getByRole("textbox", { name: "Max budget" }));
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(view.callsTo("discover.updatePreferences")).toEqual([{ budgetMax: null, budgetMin: 100, seekingTypes: [] }]),
    );
  });

  it("says when the preferences could not be saved", async () => {
    renderPreferences(
      server(preferences(), () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      }),
    );
    await openPreferences();
    await userEvent.click(screen.getByRole("checkbox", { name: "event" }));
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(await screen.findByText("Couldn't save preferences")).toBeTruthy();
    expect(screen.getByText("Your preferences weren't saved. Please try again.")).toBeTruthy();
  });

  it("collapses the matching preferences again", async () => {
    renderPreferences(server(preferences()));
    await openPreferences();
    await userEvent.click(screen.getByRole("button", { name: "Hide matching preferences" }));
    expect(screen.getByRole("button", { name: "Matching preferences" }).getAttribute("aria-expanded")).toBe("false");
  });
});
