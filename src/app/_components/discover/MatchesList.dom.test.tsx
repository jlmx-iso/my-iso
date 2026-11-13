// @vitest-environment happy-dom
//
// The matches list: each match links to its conversation (or the profile
// when it has none), says how long is left to message a fresh match, marks
// one already messaged, and shows the business name and the AI summary (or
// the location). Loading, error with retry, and an empty state that points
// to Discover.

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import MatchesList from "./MatchesList";

type Match = RouterOutputs["discover"]["getMatches"][number];
type GetMatches = NonNullable<NonNullable<TrpcHandlers["discover"]>["getMatches"]>;

const HOUR = 60 * 60 * 1000;

function match(id: string, firstName: string, overrides: Record<string, unknown> = {}, photographer: Record<string, unknown> | null = {}) {
  return {
    aiSummary: null,
    expiresAt: null,
    id,
    messageThreadId: `thread-${id}`,
    otherUser: {
      firstName,
      id: `user-${id}`,
      lastName: "Lee",
      photographer: photographer && { avatar: null, companyName: null, location: null, ...photographer },
      profilePic: null,
    },
    status: "matched",
    ...overrides,
  } as unknown as Match;
}

function renderMatches(getMatches: GetMatches) {
  return renderWithProviders(<MatchesList />, { trpc: { discover: { getMatches } } });
}

describe("MatchesList", () => {
  it("lists matches linking to their conversation, with time left, business and summary", async () => {
    const view = renderMatches(() => [
      match("m1", "Ann", { aiSummary: "You both shoot weddings in Austin.", expiresAt: new Date(Date.now() + 5.5 * HOUR) }, { companyName: "Lee Studio" }),
      match("m2", "Ben", { expiresAt: new Date(Date.now() + 20 * 60 * 1000) }, { location: "Denver, CO" }),
      match("m3", "Cat", { expiresAt: new Date(Date.now() - HOUR) }),
      match("m4", "Dan", { messageThreadId: null, status: "messaged" }, null),
    ]);

    expect(screen.getByLabelText("Loading matches")).toBeTruthy();
    const items = await screen.findAllByRole("listitem");
    expect(view.callsTo("discover.getMatches")).toEqual([{ limit: 50, offset: 0 }]);

    const ann = within(items[0]!);
    expect(ann.getByRole("link").getAttribute("href")).toBe("/app/messages/thread-m1");
    expect(ann.getByText("5h left to message")).toBeTruthy();
    expect(ann.getByText("Lee Studio")).toBeTruthy();
    expect(ann.getByText("You both shoot weddings in Austin.")).toBeTruthy();

    const ben = within(items[1]!);
    expect(ben.getByText(/^(19|20)m left to message$/)).toBeTruthy();
    expect(ben.getByText("Denver, CO")).toBeTruthy();

    expect(within(items[2]!).getByText("Expired")).toBeTruthy();

    const dan = within(items[3]!);
    expect(dan.getByText("Messaged")).toBeTruthy();
    expect(dan.getByRole("link").getAttribute("href")).toBe("/app/photographer/user-m4");
  });

  it("points to Discover when there are no matches", async () => {
    renderMatches(() => []);
    expect(await screen.findByText("No matches yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Discover" }).getAttribute("href")).toBe("/app/discover");
  });

  it("offers a retry when the matches cannot be loaded", async () => {
    let calls = 0;
    renderMatches(() => {
      calls += 1;
      if (calls === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      return [match("m1", "Ann")];
    });

    expect(await screen.findByText("We couldn't load your matches")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ann Lee")).toBeTruthy();
  });
});
