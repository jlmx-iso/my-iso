// @vitest-environment happy-dom
//
// Requesting an invite: the form asks for what is missing before sending,
// sends the trimmed details (optional ones left out when empty), confirms on
// success, and explains a refusal: next to the fields the server named, or
// in the alert above the form.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { NETWORK_ERROR_MESSAGE } from "~/_utils/userError";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import Page from "./page";

type Submit = NonNullable<NonNullable<TrpcHandlers["waitlist"]>["submit"]>;

function renderPage(submit: Submit = () => ({ position: 7, success: true }) as never) {
  return renderWithProviders(<Page />, { trpc: { waitlist: { submit } } });
}

const field = (name: string) => screen.getByRole("textbox", { name: new RegExp(`^${name}`) });
const join = () => screen.getByRole("button", { name: "Join the waitlist" });

async function fillRequired(name = "Jane Doe", email = "jane@example.com") {
  await userEvent.type(field("Full name"), name);
  await userEvent.type(field("Email"), email);
}

describe("waitlist page", () => {
  it("asks for a name and an email before sending anything", async () => {
    const view = renderPage();

    await userEvent.click(join());

    expect(await screen.findByText("Enter your name")).toBeTruthy();
    expect(screen.getByText("Enter your email address")).toBeTruthy();
    expect(view.callsTo("waitlist.submit")).toEqual([]);
  });

  it("checks the email and website look right", async () => {
    const view = renderPage();
    await fillRequired("Jane", "jane@nowhere");
    await userEvent.type(field("Website"), "jane.photo");

    await userEvent.click(join());

    expect(await screen.findByText("Enter a valid email address, like you@example.com")).toBeTruthy();
    expect(screen.getByText("Enter the full address, starting with https://")).toBeTruthy();
    expect(view.callsTo("waitlist.submit")).toEqual([]);
  });

  it("sends the trimmed details, leaving out the optional ones that are empty, and confirms", async () => {
    const view = renderPage();
    await fillRequired("  Jane Doe ", " jane@example.com ");

    await userEvent.click(join());

    expect(await screen.findByRole("heading", { name: "You're on the list!" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("We'll email your invite when a spot opens up.");
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
    expect(view.callsTo("waitlist.submit")).toEqual([
      {
        email: "jane@example.com",
        instagram: undefined,
        name: "Jane Doe",
        referralSource: undefined,
        userType: "both",
        website: undefined,
      },
    ]);
  });

  it("sends the optional details and the chosen role", async () => {
    const view = renderPage();
    await fillRequired();
    await userEvent.type(field("Instagram"), " @janedoe ");
    await userEvent.type(field("Website"), "https://jane.photo");
    await userEvent.type(field("How did you hear about ISO"), " A friend ");
    await userEvent.click(screen.getByLabelText("I'm looking to...", { selector: "input" }));
    await userEvent.click(await screen.findByRole("option", { name: "Find gigs (Second shooter)" }));

    await userEvent.click(join());

    await waitFor(() =>
      expect(view.callsTo("waitlist.submit")).toEqual([
        {
          email: "jane@example.com",
          instagram: "@janedoe",
          name: "Jane Doe",
          referralSource: "A friend",
          userType: "second",
          website: "https://jane.photo",
        },
      ]),
    );
  });

  it("shows the server's field errors next to their fields", async () => {
    renderPage(() => {
      throw trpcError("BAD_REQUEST", "Invalid input", {
        zodError: { fieldErrors: { instagram: ["Use your Instagram handle, like @yourname."] }, formErrors: [] },
      });
    });
    await fillRequired();
    await userEvent.type(field("Instagram"), "not a handle");

    await userEvent.click(join());

    expect(await screen.findByText("Use your Instagram handle, like @yourname.")).toBeTruthy();
    expect(screen.getByTestId("waitlist-error").textContent).toBe(
      "Some details need another look. Check the highlighted fields.",
    );
    expect(field("Instagram").getAttribute("aria-invalid")).toBe("true");
  });

  it("says why it failed otherwise, keeps what was typed, and clears the error on the next try", async () => {
    let attempt = 0;
    const view = renderPage(() => {
      attempt += 1;
      if (attempt === 1) throw trpcError("TOO_MANY_REQUESTS", "Too many requests. Try again in a minute.");
      if (attempt === 2) throw new TypeError("Failed to fetch");
      return { position: 3, success: true } as never;
    });
    await fillRequired();

    await userEvent.click(join());
    expect((await screen.findByTestId("waitlist-error")).textContent).toBe("Too many requests. Try again in a minute.");
    expect((field("Full name") as HTMLInputElement).value).toBe("Jane Doe");

    await userEvent.click(join());
    await waitFor(() => expect(screen.getByTestId("waitlist-error").textContent).toBe(NETWORK_ERROR_MESSAGE));

    await userEvent.click(join());
    expect(await screen.findByRole("heading", { name: "You're on the list!" })).toBeTruthy();
    expect(view.callsTo("waitlist.submit")).toHaveLength(3);
  });

  it("announces errors in an alert region and links to the invite-code page", () => {
    renderPage();
    expect(within(screen.getByRole("alert")).queryByTestId("waitlist-error")).toBeNull();
    expect(screen.getByRole("link", { name: "Enter it here" }).getAttribute("href")).toBe("/join");
    expect(screen.getByRole("heading", { level: 1, name: "Request an invite" })).toBeTruthy();
  });
});
