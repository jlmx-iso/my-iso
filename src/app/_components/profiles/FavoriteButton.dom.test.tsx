// @vitest-environment happy-dom
//
// Saving a photographer: a toggle whose name stays "Save <name>" while
// aria-pressed carries the state, adding or removing on the server, and
// keeping its state with a toast when that fails.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import { FavoriteButton } from "./FavoriteButton";

function renderButton(isFavorite: boolean, user: NonNullable<TrpcHandlers["user"]> = {}) {
  return renderWithProviders(<FavoriteButton isFavorite={isFavorite} photographerId="ph-1" photographerName="Ann Lee" />, {
    trpc: { user: { addFavorite: () => ({}) as never, removeFavorite: () => ({}) as never, ...user } },
  });
}

const toggle = () => screen.getByRole("button", { name: "Save Ann Lee" });

describe("FavoriteButton", () => {
  it("saves a photographer, then removes them again", async () => {
    const view = renderButton(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("true"));
    expect(view.callsTo("user.addFavorite")).toEqual([{ photographerId: "ph-1" }]);

    await userEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-pressed")).toBe("false"));
    expect(view.callsTo("user.removeFavorite")).toEqual([{ photographerId: "ph-1" }]);
  });

  it("keeps its state and says so when the change fails", async () => {
    renderButton(true, {
      removeFavorite: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      },
    });

    await userEvent.click(toggle());

    expect(await screen.findByText("Couldn't update your saved photographers")).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });
});
