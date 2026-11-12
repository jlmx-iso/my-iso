// @vitest-environment happy-dom
//
// The onboarding photo step: pick an image, crop it (the crop view replaces
// the form's own buttons while it is open), use it or choose another, and
// say so when the image cannot be read or cropped.
//
// happy-dom has no layout, image decoding or 2D canvas. The cropper is
// replaced by a stand-in that reports a crop area as soon as it shows (what
// react-easy-crop does once the image has loaded), and image loading and
// the canvas are stubbed per test. Nothing here touches the network.

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowConsoleError, renderWithProviders } from "~/test/dom/render";

vi.mock("react-easy-crop", async () => {
  const { useEffect, useRef } = await import("react");
  function Cropper({ image, onCropComplete }: { image: string; onCropComplete: (area: unknown, pixels: unknown) => void }) {
    // Once per image, as the real one reports after loading it.
    const report = useRef(onCropComplete);
    useEffect(() => {
      const area = { height: 100, width: 100, x: 10, y: 20 };
      report.current(area, area);
    }, [image]);
    return <div data-testid="cropper" data-image={image} />;
  }
  return { default: Cropper };
});

import { AvatarStep } from "./AvatarStep";

const png = (name = "me.png") => new File(["hello"], name, { type: "image/png" });

/** Image elements "load" as soon as they get a src, like a decoded image. */
function stubImageLoading() {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, "src");
  vi.spyOn(window.HTMLImageElement.prototype, "src", "set").mockImplementation(function (this: HTMLImageElement, value: string) {
    descriptor?.set?.call(this, value);
    queueMicrotask(() => {
      this.dispatchEvent(new Event("load"));
    });
  });
}

/** A 2D canvas that draws nothing and exports a small JPEG blob. */
function stubCanvas() {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob(["jpeg"], { type: "image/jpeg" })),
  );
  return { drawImage };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** AvatarStep inside the state its parent keeps. */
function Harness({ onCroppingChange }: { onCroppingChange: (cropping: boolean) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <>
      <AvatarStep photo={photo} onChange={setPhoto} onCroppingChange={onCroppingChange} />
      <output aria-label="Chosen photo">{photo ? `${photo.name} ${photo.type}` : "none"}</output>
    </>
  );
}

function renderStep() {
  const onCroppingChange = vi.fn();
  const view = renderWithProviders(<Harness onCroppingChange={onCroppingChange} />);
  return { ...view, onCroppingChange };
}

const chosen = () => screen.getByLabelText("Chosen photo").textContent;

async function pick(file = png()) {
  await userEvent.upload(screen.getByLabelText("Profile photo"), file);
  return screen.findByTestId("cropper");
}

describe("AvatarStep", () => {
  it("crops the picked image to a square JPEG and previews it", async () => {
    stubImageLoading();
    const { drawImage } = stubCanvas();
    const view = renderStep();

    const cropper = await pick();
    expect(cropper.getAttribute("data-image")).toMatch(/^data:image\/png;base64,/);
    expect(view.onCroppingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Drag to reposition. Pinch, scroll or use the slider to zoom.")).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));

    await waitFor(() => expect(chosen()).toBe("me.jpg image/jpeg"));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 100, 100, 0, 0, 512, 512);
    expect(view.onCroppingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("img", { name: "Your profile photo preview" })).toBeTruthy();
  });

  it("goes back to the picker with Choose another, and from the preview with Choose a different photo", async () => {
    stubImageLoading();
    stubCanvas();
    const view = renderStep();

    await pick();
    await userEvent.click(screen.getByRole("button", { name: "Choose another" }));
    expect(screen.queryByTestId("cropper")).toBeNull();
    expect(view.onCroppingChange).toHaveBeenLastCalledWith(false);
    expect(chosen()).toBe("none");

    await pick();
    await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));
    await userEvent.click(await screen.findByRole("button", { name: "Choose a different photo" }));

    expect(chosen()).toBe("none");
    expect(screen.getByLabelText("Profile photo")).toBeTruthy();
  });

  it("zooms with the keyboard", async () => {
    renderStep();
    await pick();

    const slider = screen.getByRole("slider");
    act(() => slider.focus());
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");

    expect(slider.getAttribute("aria-valuenow")).toBe("1.1");
  });

  // KNOWN GAP (reported, not fixed here): the zoom slider has no accessible
  // name. AvatarStep passes aria-labelledby to Mantine's Slider, which puts
  // it on the wrapper; the element with role="slider" is the thumb, whose
  // aria-label comes from `thumbLabel` (empty by default), so a screen
  // reader announces an unnamed slider. Fix: thumbLabel="Zoom" (or
  // thumbProps={{ "aria-labelledby": zoomLabelId }}); then drop `.fails`.
  it.fails("names the zoom slider for assistive technology", async () => {
    renderStep();
    await pick();

    expect(screen.getByRole("slider", { name: "Zoom" })).toBeTruthy();
  });

  it("says so when the image cannot be cropped, and keeps the crop view", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Failed to crop image/);
    stubImageLoading();
    // No 2D canvas, as in a browser that has it disabled.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderStep();
    await pick();

    await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));

    expect(await screen.findByText("Photo not cropped")).toBeTruthy();
    expect(screen.getByText("We couldn't crop that image. Try a different one.")).toBeTruthy();
    expect(chosen()).toBe("none");
    expect(screen.getByTestId("cropper")).toBeTruthy();
  });

  it("says so when the picked file cannot be read", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Failed to read avatar file/);
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => {
        this.dispatchEvent(new ProgressEvent("error"));
      });
    });
    renderStep();

    await userEvent.upload(screen.getByLabelText("Profile photo"), png());

    expect(await screen.findByText("Photo not loaded")).toBeTruthy();
    expect(screen.getByText("We couldn't read that file. Try a different image.")).toBeTruthy();
    expect(screen.queryByTestId("cropper")).toBeNull();
  });
});
