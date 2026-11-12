// @vitest-environment happy-dom
//
// The Discover deck: Like and Pass send the swipe for the card on top and
// show the next; a mutual like opens the match dialog; a swipe that was not
// saved puts its card back and says so; an empty batch asks the server for
// more once; and a deck that cannot load says so with "Try again".

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import CardStack from "./CardStack";

type Deck = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["discover"]>["getCardDeck"]>>>;
type Preferences = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["discover"]>["getPreferences"]>>>;

function person(id: string, firstName: string, lastName: string) {
  return {
    city: "Austin",
    firstName,
    id,
    lastName,
    photographer: {
      avatar: null,
      avgRating: 4.5,
      bio: `${firstName} shoots weddings.`,
      companyName: `${firstName} Photo`,
      eventCount: 2,
      instagram: null,
      location: "Austin, TX",
      name: `${firstName} ${lastName}`,
      portfolioImages: [],
      reviewCount: 3,
      specializations: ["Wedding"],
      website: null,
    },
    profilePic: null,
    state: "TX",
  };
}

const BEA = person("bea", "Bea", "Cole");
const CAL = person("cal", "Cal", "Diaz");

const PREFERENCES = { isDiscoverable: true, photographer: { avatar: null } } as unknown as Preferences;

function renderStack(discover: TrpcHandlers["discover"]) {
  return renderWithProviders(<CardStack />, {
    trpc: { discover: { getPreferences: () => PREFERENCES, ...discover } },
  });
}

/** Answers each call with the next batch; the last one repeats. */
function batches(...answers: Array<Deck | Error>) {
  let call = 0;
  return () => {
    const answer = answers[Math.min(call, answers.length - 1)]!;
    call += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

const deck = (...people: Array<ReturnType<typeof person>>) => people as unknown as Deck;
const announcement = () => screen.getAllByRole("status").find((node) => node.classList.contains("sr-only"))?.textContent;

describe("CardStack", () => {
  it("shows a loader, then the first photographer with Like and Pass", async () => {
    const view = renderStack({ getCardDeck: () => deck(BEA, CAL) });

    expect(screen.getByLabelText("Finding photographers")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Bea Cole" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Like Bea Cole" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pass on Bea Cole" })).toBeTruthy();
    // The card underneath is hidden from assistive technology and has no buttons.
    expect(screen.queryByRole("button", { name: "Like Cal Diaz" })).toBeNull();
    expect(view.callsTo("discover.getCardDeck")).toEqual([{ limit: 20 }]);
  });

  it("likes the top card, announces it, and moves to the next", async () => {
    const view = renderStack({
      getCardDeck: () => deck(BEA, CAL),
      swipe: () => ({ matched: false, threadId: null }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Like Bea Cole" }));

    expect(await screen.findByRole("button", { name: "Like Cal Diaz" })).toBeTruthy();
    expect(announcement()).toBe("Liked Bea Cole");
    expect(view.callsTo("discover.swipe")).toEqual([{ direction: "like", targetId: "bea" }]);
  });

  it("passes on the top card", async () => {
    const view = renderStack({
      getCardDeck: () => deck(BEA, CAL),
      swipe: () => ({ matched: false, threadId: null }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pass on Bea Cole" }));

    expect(await screen.findByRole("button", { name: "Pass on Cal Diaz" })).toBeTruthy();
    expect(announcement()).toBe("Passed on Bea Cole");
    expect(view.callsTo("discover.swipe")).toEqual([{ direction: "pass", targetId: "bea" }]);
  });

  it("celebrates a match with a link to the new conversation; Keep swiping closes it", async () => {
    renderStack({
      getCardDeck: () => deck(BEA, CAL),
      swipe: () => ({ matched: true, threadId: "thread-9" }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Like Bea Cole" }));

    const dialog = await screen.findByRole("dialog", { name: "You matched" });
    expect(within(dialog).getByText("Bea Cole")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Send a message" }).getAttribute("href")).toBe("/app/messages/thread-9");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep swiping" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "You matched" })).toBeNull());
    expect(screen.getByRole("button", { name: "Like Cal Diaz" })).toBeTruthy();
  });

  it("puts the card back and says so when a swipe is not saved", async () => {
    renderStack({
      getCardDeck: () => deck(BEA, CAL),
      swipe: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "db down");
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Like Bea Cole" }));

    expect(await screen.findByText("Couldn't save your like")).toBeTruthy();
    expect(screen.getByText("Your like wasn't saved, so Bea Cole is back on top. Please try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Like Bea Cole" })).toBeTruthy();
    expect(announcement()).toBe("Your like on Bea Cole was not saved");
  });

  it("says to slow down when swipes are rate limited, with the server's wait", async () => {
    renderStack({
      getCardDeck: () => deck(BEA, CAL),
      swipe: () => {
        throw trpcError("TOO_MANY_REQUESTS", "Try again in 30 seconds.");
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pass on Bea Cole" }));

    expect(await screen.findByText("You're swiping too fast")).toBeTruthy();
    expect(screen.getByText("Your pass wasn't saved, so Bea Cole is back on top. Try again in 30 seconds.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pass on Bea Cole" })).toBeTruthy();
  });

  it("asks for the next batch after the last card, once, and says when everyone has been seen", async () => {
    const view = renderStack({
      getCardDeck: batches(deck(BEA), deck()),
      swipe: () => ({ matched: false, threadId: null }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pass on Bea Cole" }));

    expect(await screen.findByText("No more photographers to show")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See your matches" }).getAttribute("href")).toBe("/app/discover/matches");
    expect(screen.getByRole("link", { name: "Search photographers" }).getAttribute("href")).toBe("/app/search");
    expect(view.callsTo("discover.getCardDeck")).toHaveLength(2);
  });

  it("shows the next batch when the server has one", async () => {
    renderStack({
      getCardDeck: batches(deck(BEA), deck(CAL)),
      swipe: () => ({ matched: false, threadId: null }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Like Bea Cole" }));

    expect(await screen.findByRole("button", { name: "Like Cal Diaz" })).toBeTruthy();
  });

  it("tells a hidden member why nobody can match with them", async () => {
    renderWithProviders(<CardStack />, {
      trpc: {
        discover: {
          getCardDeck: () => deck(),
          getPreferences: () => ({ ...PREFERENCES, isDiscoverable: false }),
        },
      },
    });

    expect(await screen.findByText(/You're also hidden from Discover, so nobody can match with you/)).toBeTruthy();
  });

  it("says the deck could not load, and Try again loads it", async () => {
    const view = renderStack({ getCardDeck: batches(trpcError("INTERNAL_SERVER_ERROR", "db down"), deck(BEA)) });

    const alert = await screen.findByTestId("deck-error");
    expect(alert.textContent).toContain("We couldn't load photographers");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Bea Cole" })).toBeTruthy();
    expect(view.callsTo("discover.getCardDeck")).toHaveLength(2);
  });

  it("says more could not load when the refill fails, without retrying by itself", async () => {
    const view = renderStack({
      getCardDeck: batches(deck(BEA), trpcError("INTERNAL_SERVER_ERROR", "db down")),
      swipe: () => ({ matched: false, threadId: null }) as never,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Like Bea Cole" }));

    const alert = await screen.findByTestId("deck-error");
    expect(alert.textContent).toContain("We couldn't load more photographers");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.callsTo("discover.getCardDeck")).toHaveLength(2);
  });
});
