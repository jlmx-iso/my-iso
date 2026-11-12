// @vitest-environment happy-dom
//
// Editing one's own profile: the form starts from what is saved (social
// links shown as bare handles), checks fields before sending, changes the
// username first and stops if it is refused, sends the normalised profile,
// and on failure keeps everything typed and says why above the form or on
// the field concerned.

import type { Photographer } from "@prisma/client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { allowConsoleError, renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

import EditProfile from "./EditProfile";

const AT = new Date("2030-01-01T00:00:00Z");

const PHOTOGRAPHER: Photographer = {
  avatar: null,
  bio: "Weddings in Texas",
  companyName: "Ann Lee Photo",
  createdAt: AT,
  facebook: "https://facebook.com/annlee",
  id: "ph-1",
  instagram: "https://instagram.com/annlee.photo",
  location: "Austin, TX",
  name: "Ann Marie Lee",
  tiktok: null,
  twitter: null,
  updatedAt: AT,
  userId: "user-1",
  vimeo: null,
  website: "https://annlee.com",
  youtube: null,
};

/** A promise the test settles, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderForm(handlers: { photographer?: TrpcHandlers["photographer"]; user?: TrpcHandlers["user"] } = {}, handle: string | null = "annlee") {
  testSession.signIn("user-1");
  return renderWithProviders(<EditProfile photographer={PHOTOGRAPHER} handle={handle} />, {
    trpc: {
      google: { getAutocompleteLocations: () => [] },
      photographer: { update: () => ({}) as never, ...handlers.photographer },
      user: { updateProfile: () => ({}) as never, ...handlers.user },
    },
  });
}

const field = (name: string | RegExp) => screen.getByRole<HTMLInputElement>("textbox", { name });
const save = () => userEvent.click(screen.getByRole("button", { name: "Save changes" }));

async function replace(name: string | RegExp, value: string) {
  await userEvent.clear(field(name));
  if (value) await userEvent.type(field(name), value);
}

const SAVED_PROFILE = {
  bio: "Weddings in Texas",
  companyName: "Ann Lee Photo",
  facebook: "annlee",
  firstName: "Ann",
  id: "ph-1",
  instagram: "annlee.photo",
  lastName: "Marie Lee",
  location: "Austin, TX",
  tiktok: null,
  twitter: null,
  vimeo: null,
  // Saved as the parsed URL.
  website: "https://annlee.com/",
  youtube: null,
};

describe("EditProfile", () => {
  it("starts from the saved profile, with social links as bare handles", () => {
    renderForm();

    expect(field("First name").value).toBe("Ann");
    expect(field("Last name").value).toBe("Marie Lee");
    expect(field("Business name").value).toBe("Ann Lee Photo");
    expect(field("Username").value).toBe("annlee");
    expect(screen.getByText("Your public profile: http://localhost:3000/photographer/annlee")).toBeTruthy();
    expect(field(/^Bio/).value).toBe("Weddings in Texas");
    expect(field("Instagram").value).toBe("annlee.photo");
    expect(field("Facebook").value).toBe("annlee");
    expect(field("TikTok").value).toBe("");
  });

  it("saves the profile without touching an unchanged username, then returns to the profile", async () => {
    const view = renderForm();

    await save();

    await waitFor(() => expect(testRouter.push).toHaveBeenCalledWith("/app/profile"));
    expect(view.callsTo("user.updateProfile")).toEqual([]);
    expect(view.callsTo("photographer.update")).toEqual([SAVED_PROFILE]);
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    expect(testSession.updates).toBe(1);
    expect(screen.getByText("Profile updated")).toBeTruthy();
  });

  it("sends trimmed, normalised values: empty optionals as null, handles without the @", async () => {
    const view = renderForm();

    await replace(/^Bio/, "   ");
    await replace("Website", "");
    await replace("Business name", "  New Name Co  ");
    await replace("Instagram", "");
    await userEvent.type(field("TikTok"), "@annshoots");
    await userEvent.type(field("YouTube"), "annlee");
    await save();

    await waitFor(() => expect(view.callsTo("photographer.update")).toHaveLength(1));
    expect(view.callsTo("photographer.update")[0]).toEqual({
      ...SAVED_PROFILE,
      bio: null,
      companyName: "New Name Co",
      instagram: null,
      tiktok: "annshoots",
      website: null,
      youtube: "annlee",
    });
  });

  it("changes the username first, then the profile", async () => {
    const view = renderForm();

    await replace("Username", "@Ann_Lee");
    expect(screen.getByText("Your public profile: http://localhost:3000/photographer/ann_lee")).toBeTruthy();
    await save();

    await waitFor(() => expect(view.callsTo("photographer.update")).toHaveLength(1));
    expect(view.calls.map((call) => call.path)).toEqual(["user.updateProfile", "photographer.update"]);
    expect(view.callsTo("user.updateProfile")).toEqual([{ handle: "ann_lee" }]);
  });

  it("stops at a taken username: says so on the field and above the form, saving nothing", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Username update failed/);
    const view = renderForm({
      user: {
        updateProfile: () => {
          throw trpcError("CONFLICT", "Handle taken");
        },
      },
    });

    await replace("Username", "taken_one");
    await save();

    expect(await screen.findByText("That username is taken. Try another one.")).toBeTruthy();
    expect(screen.getByTestId("edit-profile-error").textContent).toBe(
      "That username can't be used. Nothing was saved — choose a different one.",
    );
    expect(view.callsTo("photographer.update")).toEqual([]);
    expect(testRouter.push).not.toHaveBeenCalled();
    expect(field("Username").value).toBe("taken_one");
  });

  it("says why when the username change fails for another reason", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Username update failed/);
    const view = renderForm({
      user: {
        updateProfile: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });

    await replace("Username", "fresh_name");
    await save();

    expect((await screen.findByTestId("edit-profile-error")).textContent).toBe(
      "We couldn't save your profile. Your changes are still here — please try again.",
    );
    expect(view.callsTo("photographer.update")).toEqual([]);
  });

  it("checks the fields before sending anything", async () => {
    const view = renderForm();

    await replace("First name", "");
    await replace("Business name", "");
    await replace("Username", "");
    await replace("Website", "not a site");
    await replace("Instagram", "bad handle!");
    await save();

    expect(await screen.findByText("Enter your first name")).toBeTruthy();
    expect(screen.getByText("Enter your business name")).toBeTruthy();
    expect(screen.getByText("Enter a username, or keep your current one")).toBeTruthy();
    expect(screen.getByText("Enter a web address, like yoursite.com")).toBeTruthy();
    expect(screen.getByText("Enter just the handle, like yourhandle")).toBeTruthy();
    expect(view.calls).toEqual([]);
  });

  it("says what is wrong with a username as soon as the field is left", async () => {
    renderForm();

    await replace("Username", "ab");
    await userEvent.tab();

    expect(await screen.findByText("Use at least 3 characters")).toBeTruthy();
  });

  it("lets a member without a username leave it empty", async () => {
    const view = renderForm({}, null);

    expect(field("Username").value).toBe("");
    await save();

    await waitFor(() => expect(view.callsTo("photographer.update")).toHaveLength(1));
    expect(view.callsTo("user.updateProfile")).toEqual([]);
  });

  it("puts the server's field messages on the fields", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Profile update failed/);
    renderForm({
      photographer: {
        update: () => {
          throw trpcError("BAD_REQUEST", "Invalid input", {
            zodError: { fieldErrors: { companyName: ["Business names can't contain links."] }, formErrors: [] },
          });
        },
      },
    });

    await save();

    expect(await screen.findByText("Business names can't contain links.")).toBeTruthy();
    expect(screen.getByTestId("edit-profile-error").textContent).toBe(
      "Some details need another look. Check the highlighted fields.",
    );
    expect(testRouter.push).not.toHaveBeenCalled();
  });

  it("keeps what was typed and says so when saving fails", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Profile update failed/);
    renderForm({
      photographer: {
        update: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });

    await replace("Business name", "Kept Co");
    await save();

    expect((await screen.findByTestId("edit-profile-error")).textContent).toBe(
      "We couldn't save your profile. Your changes are still here — please try again.",
    );
    expect(field("Business name").value).toBe("Kept Co");
    expect(testRouter.push).not.toHaveBeenCalled();
  });

  it("turns Save and Cancel off while saving", async () => {
    const pending = deferred<never>();
    renderForm({ photographer: { update: () => pending.promise } });

    await save();

    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(true));
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel.getAttribute("href")).toBe("/app/profile");
    expect(cancel.getAttribute("data-disabled") ?? cancel.getAttribute("aria-disabled")).toBeTruthy();
  });
});
