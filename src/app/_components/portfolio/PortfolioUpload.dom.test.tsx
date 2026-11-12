// @vitest-environment happy-dom
//
// Uploading a portfolio image: the picker refuses files the server would,
// the form asks for what is missing, the image goes to the server as base64
// through tRPC (no other network), and a refused upload is explained in the
// dialog, next to the image, with the dialog held open while it is sent.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { IMAGE_TOO_LARGE_MESSAGE, IMAGE_WRONG_TYPE_MESSAGE } from "~/_utils/imageFile";
import { MAX_IMAGE_BYTES } from "~/_utils/limits";
import { PORTFOLIO_FULL_MESSAGE } from "~/_utils/userError";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import PortfolioUpload from "./PortfolioUpload";

/** A promise the test settles, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const png = (name = "sunset.png") => new File(["hello"], name, { type: "image/png" });
// "hello", base64: what the server receives.
const PNG_BASE64 = "aGVsbG8=";

function renderUpload(photographer: TrpcHandlers["photographer"] = {}) {
  const onUploaded = vi.fn();
  const view = renderWithProviders(<PortfolioUpload onUploaded={onUploaded} />, { trpc: { photographer } });
  return { ...view, onUploaded };
}

async function openDialog(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "Upload image" }));
  return screen.findByRole("dialog", { name: "Upload portfolio image" });
}

async function pick(dialog: HTMLElement, file: File, user = userEvent.setup()) {
  await user.upload(within(dialog).getByLabelText("Portfolio image"), file);
}

describe("PortfolioUpload", () => {
  it("uploads the picked image with the trimmed details, confirms, closes and tells the page", async () => {
    const view = renderUpload({ addPortfolioImage: () => ({}) as never });
    const dialog = await openDialog();

    await pick(dialog, png());
    expect(await within(dialog).findByRole("img", { name: "Preview of sunset.png" })).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "  Sunset vows ");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Description" }), "  Beach ceremony  ");
    await userEvent.type(within(dialog).getByPlaceholderText("Add a tag"), "Wedding{Enter}");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Feature this image/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await screen.findByText('"Sunset vows" is now in your portfolio.')).toBeTruthy();
    expect(view.callsTo("photographer.addPortfolioImage")).toEqual([
      { description: "Beach ceremony", image: PNG_BASE64, isFeatured: true, tags: ["Wedding"], title: "Sunset vows" },
    ]);
    expect(view.onUploaded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload portfolio image" })).toBeNull());
  });

  it("sends no description when none is given", async () => {
    const view = renderUpload({ addPortfolioImage: () => ({}) as never });
    const dialog = await openDialog();

    await pick(dialog, png());
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Vows");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(view.callsTo("photographer.addPortfolioImage")).toEqual([
        { description: undefined, image: PNG_BASE64, isFeatured: false, tags: [], title: "Vows" },
      ]),
    );
  });

  it("asks for a title, then for an image, before sending anything", async () => {
    const view = renderUpload();
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByText("Give the image a title")).toBeTruthy();

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Vows");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByText("Choose an image to upload")).toBeTruthy();
    expect(view.callsTo("photographer.addPortfolioImage")).toEqual([]);
  });

  it("refuses a file of the wrong type or too large when it is picked", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderUpload();
    const dialog = await openDialog(user);

    await pick(dialog, new File(["gif"], "anim.gif", { type: "image/gif" }), user);
    expect(await within(dialog).findByText(IMAGE_WRONG_TYPE_MESSAGE)).toBeTruthy();

    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: MAX_IMAGE_BYTES + 1 });
    await pick(dialog, huge, user);
    expect(await within(dialog).findByText(IMAGE_TOO_LARGE_MESSAGE)).toBeTruthy();
    expect(within(dialog).queryByRole("img", { name: /Preview of/ })).toBeNull();
  });

  it("lets the member choose a different image", async () => {
    renderUpload();
    const dialog = await openDialog();

    await pick(dialog, png());
    await userEvent.click(within(dialog).getByRole("button", { name: "Choose a different image" }));

    expect(within(dialog).queryByRole("img", { name: "Preview of sunset.png" })).toBeNull();
    expect(within(dialog).getByLabelText("Portfolio image")).toBeTruthy();
  });

  it("holds the dialog open while uploading, then explains a refused image next to it", async () => {
    const upload = deferred<never>();
    const view = renderUpload({ addPortfolioImage: () => upload.promise });
    const dialog = await openDialog();

    await pick(dialog, png());
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Vows");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Upload portfolio image" })).toBeTruthy();
    // The header's close button stays, but does nothing until the upload ends.
    const closeButton = dialog.querySelector<HTMLButtonElement>(".mantine-Modal-close");
    expect(closeButton).not.toBeNull();
    await userEvent.click(closeButton!);
    expect(screen.getByRole("dialog", { name: "Upload portfolio image" })).toBeTruthy();

    upload.reject(trpcError("PAYLOAD_TOO_LARGE", "Request entity too large"));

    expect(await within(dialog).findByText(IMAGE_TOO_LARGE_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Upload portfolio image" })).toBeTruthy();
    expect(view.onUploaded).not.toHaveBeenCalled();
    // The details typed are kept for another try.
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Title" }).value).toBe("Vows");
  });

  it("says when the portfolio is full", async () => {
    renderUpload({
      addPortfolioImage: () => {
        throw trpcError("BAD_REQUEST", "{}", { reason: ErrorReason.PORTFOLIO_FULL });
      },
    });
    const dialog = await openDialog();

    await pick(dialog, png());
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Vows");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await within(dialog).findByText(PORTFOLIO_FULL_MESSAGE)).toBeTruthy();
  });

  it("starts empty again after Cancel", async () => {
    renderUpload();
    let dialog = await openDialog();
    await pick(dialog, png());
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Draft");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Upload portfolio image" })).toBeNull());

    dialog = await openDialog();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Title" }).value).toBe("");
    expect(within(dialog).queryByRole("img", { name: /Preview of/ })).toBeNull();
  });
});
