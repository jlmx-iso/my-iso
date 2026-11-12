// @vitest-environment happy-dom
//
// The Pro insights dashboard, rendered: the numbers and their comparisons,
// the "through yesterday" period and its footnote, the empty state when
// nobody has viewed the profile, "Counting started on", the period switch,
// the keyboard-reachable chart and the error state.

import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { allowConsoleError, renderWithProviders, trpcError } from "~/test/dom/render";
import type { RouterOutputs } from "~/trpc/react";

import DailyViewsChart, { nextColumn } from "./DailyViewsChart";
import InsightsDashboard, { changeLabel } from "./InsightsDashboard";

type Insights = RouterOutputs["insights"]["getSummary"];

const PROFILE_URL = "https://myiso.app/photographer/olive";

function days(from: string, counts: number[]) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return counts.map((count, index) => ({ count, day: new Date(start + index * 86_400_000).toISOString().slice(0, 10) }));
}

function insights(overrides: Partial<Insights> = {}): Insights {
  return {
    applications: { changePercent: null, previous: 0, value: 2 },
    conversationsStarted: { changePercent: -50, previous: 2, value: 1 },
    countingSince: "2030-01-01",
    days: 7,
    eventViews: { changePercent: 12, previous: 25, value: 28 },
    from: "2030-06-08",
    profileViews: {
      changePercent: 0,
      daily: days("2030-06-08", [1, 0, 4, 2, 0, 3, 2]),
      previous: 12,
      sources: [
        { count: 7, source: "search" },
        { count: 5, source: "other" },
      ],
      value: 12,
    },
    to: "2030-06-14",
    topEvents: [{ applications: 2, date: new Date("2030-09-01T15:00:00Z"), id: "e1", title: "Garden wedding", views: 28 }],
    ...overrides,
  };
}

const emptyViews = (overrides: Partial<Insights["profileViews"]> = {}): Insights["profileViews"] => ({
  changePercent: null,
  daily: days("2030-06-08", [0, 0, 0, 0, 0, 0, 0]),
  previous: 0,
  sources: [],
  value: 0,
  ...overrides,
});

describe("InsightsDashboard", () => {
  it("shows each number with its caption and its change, and the period through yesterday", async () => {
    const view = renderWithProviders(<InsightsDashboard profileUrl={PROFILE_URL} />, {
      trpc: { insights: { getSummary: () => insights() } },
    });

    expect(await screen.findByText("Jun 8 to Jun 14, through yesterday*")).toBeTruthy();
    expect(view.callsTo("insights.getSummary")).toEqual([{ days: 30 }]);

    const profile = screen.getByTestId("stat-profile-views");
    expect(within(profile).getByText("12")).toBeTruthy();
    expect(within(profile).getByText("Times your profile was opened")).toBeTruthy();
    expect(within(profile).getByText("Same as the previous 30 days")).toBeTruthy();
    expect(within(screen.getByTestId("stat-event-views")).getByText("+12% vs previous 30 days")).toBeTruthy();
    expect(within(screen.getByTestId("stat-event-views")).getByText("Times your events were opened")).toBeTruthy();
    expect(within(screen.getByTestId("stat-applications")).getByText("New: none in the previous 30 days")).toBeTruthy();
    expect(within(screen.getByTestId("stat-applications")).getByText("Applications to your events")).toBeTruthy();
    expect(within(screen.getByTestId("stat-conversations")).getByText("−50% vs previous 30 days")).toBeTruthy();
    expect(within(screen.getByTestId("stat-conversations")).getByText("Photographers who messaged you first")).toBeTruthy();

    // Sources, with the small ones already folded into Other by the server.
    const sources = screen.getByTestId("view-sources");
    expect(within(sources).getByText("Search")).toBeTruthy();
    expect(within(sources).getByText("Other")).toBeTruthy();
    expect(screen.getByText(/12 views, by the part of ISO/)).toBeTruthy();

    expect(within(screen.getByTestId("top-events")).getByRole("link", { name: "Garden wedding" }).getAttribute("href")).toBe("/app/events/e1");
    expect(screen.getByTestId("utc-footnote").textContent).toContain(
      "Days run midnight to midnight UTC, so a late-evening view may land on the next day.",
    );
    // Counting began long before this period: nothing to say about it.
    expect(screen.queryByTestId("counting-since")).toBeNull();
    expect(screen.queryByTestId("insights-empty")).toBeNull();
  });

  it("asks for the period the member picks", async () => {
    const view = renderWithProviders(<InsightsDashboard profileUrl={PROFILE_URL} />, {
      trpc: { insights: { getSummary: ({ days }) => insights({ days: days as Insights["days"] }) } },
    });
    await screen.findByTestId("stat-profile-views");
    await userEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(await screen.findByText("Same as the previous 7 days")).toBeTruthy();
    expect(view.callsTo("insights.getSummary")).toEqual([{ days: 30 }, { days: 7 }]);
  });

  it("replaces the chart with an empty state, with the two things that bring views, when nobody looked", async () => {
    renderWithProviders(<InsightsDashboard profileUrl={PROFILE_URL} />, {
      trpc: { insights: { getSummary: () => insights({ profileViews: emptyViews() }) } },
    });

    const empty = await screen.findByTestId("insights-empty");
    expect(within(empty).getByText("No profile views yet in the last 30 days")).toBeTruthy();
    expect(within(empty).getByRole("link", { name: "Add portfolio images" }).getAttribute("href")).toBe("/app/profile");
    expect(screen.queryByTestId("daily-views-chart")).toBeNull();
    // No "0 views, by ..." breakdown.
    expect(screen.queryByTestId("view-sources")).toBeNull();
    expect(screen.queryByText(/views?, by the part of ISO/)).toBeNull();

    await userEvent.click(within(empty).getByRole("button", { name: "Copy your profile link" }));
    expect(await within(empty).findByRole("button", { name: "Link copied" })).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(PROFILE_URL);
  });

  it("says when counting started if that was inside the period", async () => {
    renderWithProviders(<InsightsDashboard profileUrl={PROFILE_URL} />, {
      trpc: {
        insights: {
          getSummary: () =>
            insights({ countingSince: "2030-06-12", profileViews: { ...insights().profileViews, daily: days("2030-06-12", [1, 0, 2]) } }),
        },
      },
    });
    expect((await screen.findByTestId("counting-since")).textContent).toBe("Counting started on Jun 12");
    // The chart starts there too.
    expect(screen.getAllByRole("img", { name: /views?$/ })).toHaveLength(3);
  });

  it("says the period could not be loaded, and tries again", async () => {
    allowConsoleError(/Insights are resting/);
    let fail = true;
    renderWithProviders(<InsightsDashboard profileUrl={PROFILE_URL} />, {
      trpc: {
        insights: {
          getSummary: () => {
            if (fail) throw trpcError("TOO_MANY_REQUESTS", "Insights are resting");
            return insights();
          },
        },
      },
    });
    expect(await screen.findByText("Your insights could not be loaded")).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("stat-profile-views")).toBeTruthy();
  });
});

describe("changeLabel", () => {
  it("says what changed, and plain words when there is nothing to compare with", () => {
    expect(changeLabel({ changePercent: null, previous: null, value: 4 }, 30)).toBe("No earlier period to compare with yet");
    expect(changeLabel({ changePercent: null, previous: 0, value: 0 }, 7)).toBe("Same as the previous 7 days");
    expect(changeLabel({ changePercent: null, previous: 0, value: 3 }, 7)).toBe("New: none in the previous 7 days");
    expect(changeLabel({ changePercent: 25, previous: 4, value: 5 }, 90)).toBe("+25% vs previous 90 days");
    expect(changeLabel({ changePercent: -100, previous: 4, value: 0 }, 90)).toBe("−100% vs previous 90 days");
  });
});

describe("DailyViewsChart", () => {
  const daily = days("2030-06-08", [1, 0, 4, 2]);

  it("names the busiest day until a column is pointed at, then that column", () => {
    renderWithProviders(<DailyViewsChart daily={daily} />);
    const readout = screen.getByTestId("chart-readout");
    expect(readout.textContent).toBe("Jun 10: 4 views (busiest day)");
    expect(screen.getByText("Most in a day: 4")).toBeTruthy();

    fireEvent.mouseEnter(screen.getByRole("img", { name: "Jun 9: 0 views" }));
    expect(readout.textContent).toBe("Jun 9: 0 views");
    fireEvent.mouseLeave(screen.getByTestId("daily-views-chart"));
    expect(readout.textContent).toBe("Jun 10: 4 views (busiest day)");
    fireEvent.touchStart(screen.getByRole("img", { name: "Jun 8: 1 view" }));
    expect(readout.textContent).toBe("Jun 8: 1 view");
  });

  it("is one tab stop; the arrow keys, Home and End move between days with the same readout", async () => {
    renderWithProviders(<DailyViewsChart daily={daily} />);
    const columns = screen.getAllByRole("img");
    // Only the latest day is in the tab order.
    expect(columns.map((column) => column.getAttribute("tabindex"))).toEqual(["-1", "-1", "-1", "0"]);

    await userEvent.tab();
    expect(document.activeElement).toBe(columns[3]);
    expect(screen.getByTestId("chart-readout").textContent).toBe("Jun 11: 2 views");

    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(columns[2]);
    expect(screen.getByTestId("chart-readout").textContent).toBe("Jun 10: 4 views");
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(columns[0]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(columns[3]);
    // Other keys do nothing.
    await userEvent.keyboard("a");
    expect(document.activeElement).toBe(columns[3]);
    expect(columns.map((column) => column.getAttribute("tabindex"))).toEqual(["-1", "-1", "-1", "0"]);

    act(() => {
      columns[3]?.blur();
    });
    expect(screen.getByTestId("chart-readout").textContent).toBe("Jun 10: 4 views (busiest day)");
  });

  it("lists every day in a table for screen readers", () => {
    renderWithProviders(<DailyViewsChart daily={daily} />);
    const table = screen.getByRole("table", { name: "Profile views per day" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
  });

  it("nextColumn stays inside the chart", () => {
    expect(nextColumn("ArrowLeft", 0, 4)).toBe(0);
    expect(nextColumn("ArrowDown", 2, 4)).toBe(1);
    expect(nextColumn("ArrowRight", 3, 4)).toBe(3);
    expect(nextColumn("ArrowUp", 1, 4)).toBe(2);
    expect(nextColumn("Home", 3, 4)).toBe(0);
    expect(nextColumn("End", 0, 4)).toBe(3);
    expect(nextColumn("Enter", 1, 4)).toBeNull();
  });
});
