// @vitest-environment happy-dom
//
// The profile photo: everyone sees it (or the initials); only the owner gets
// a button to change it. A new photo goes to the server as base64, then the
// session and the page are refreshed so every avatar updates, and a refused
// upload is explained in the dialog, next to the photo.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IMAGE_TOO_LARGE_MESSAGE } from "~/_utils/imageFile";
import { testRouter } from "~/test/dom/navigation";
import { allowConsoleError, renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

import ProfileAvatar from "./ProfileAvatar";

const png = () => new File(["hello"], "me.png", { type: "image/png" });
// "hello", base64: what the server receives.
const PNG_BASE64 = "aGVsbG8=";

type Upload = NonNullable<NonNullable<TrpcHandlers["photographer"]>["uploadProfileImage"]>;

function renderAvatar(isSelf: boolean, uploadProfileImage: Upload = () => ({}) as never) {
  testSession.signIn("ann");
  return renderWithProviders(
    <ProfileAvatar isSelf={isSelf} avatar="https://res.cloudinary.com/demo/ann.jpg" name="Ann Lee" size={96} />,
    { trpc: { photographer: { uploadProfileImage } } },
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Change profile photo" }));
  return screen.findByRole("dialog", { name: "Change profile photo" });
}

describe("ProfileAvatar", () => {
  it("shows the photo to a visitor, with nothing to change", () => {
    renderAvatar(false);
    expect(screen.getByRole("img", { name: "Ann Lee's profile photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change profile photo" })).toBeNull();
  });

  it("shows the initials when there is no photo", () => {
    renderWithProviders(<ProfileAvatar isSelf={false} avatar={null} name="Ann Lee" size={96} />);
    expect(screen.getByRole("img", { name: "Ann Lee's profile photo" }).textContent).toBe("AL");
  });

  it("uploads the owner's new photo, refreshes the session and the page, and confirms", async () => {
    const view = renderAvatar(true);
    const dialog = await openDialog();
    const save = within(dialog).getByRole("button", { name: "Save photo" });
    expect(save.hasAttribute("disabled")).toBe(true);

    await userEvent.upload(within(dialog).getByLabelText("Profile photo"), png());
    await userEvent.click(save);

    expect(await screen.findByText("Your new photo is live across ISO.")).toBeTruthy();
    expect(view.callsTo("photographer.uploadProfileImage")).toEqual([{ image: PNG_BASE64 }]);
    expect(testSession.updates).toBe(1);
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("explains a refused upload in the dialog and keeps it open", async () => {
    allowConsoleError(/Error uploading profile avatar/);
    renderAvatar(true, () => {
      throw trpcError("PAYLOAD_TOO_LARGE", "Too large");
    });
    const dialog = await openDialog();
    await userEvent.upload(within(dialog).getByLabelText("Profile photo"), png());
    await userEvent.click(within(dialog).getByRole("button", { name: "Save photo" }));

    expect(await within(dialog).findByText(IMAGE_TOO_LARGE_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Change profile photo" })).toBeTruthy();
    expect(testSession.updates).toBe(0);
    expect(testRouter.refresh).not.toHaveBeenCalled();
  });

  it("sends nothing when cancelled, and starts empty next time", async () => {
    const view = renderAvatar(true);
    let dialog = await openDialog();
    await userEvent.upload(within(dialog).getByLabelText("Profile photo"), png());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openDialog();
    expect(within(dialog).getByRole("button", { name: "Save photo" }).hasAttribute("disabled")).toBe(true);
    expect(view.callsTo("photographer.uploadProfileImage")).toEqual([]);
  });
});
