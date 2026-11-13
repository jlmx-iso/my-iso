// @vitest-environment happy-dom
//
// The toast container: on a phone one toast at a time (the rest wait),
// wider screens up to three; and on a phone, while a toast is up, it is
// moved below the title bar of an open dialog (`--toast-top` on <html>) so
// the dialog's title and close button stay usable. Nothing is left on
// <html> once the toasts are gone.

import { MantineProvider } from "@mantine/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify } from "~/app/_lib/notify";

import Toasts from "./Toasts";

const PHONE_QUERY = "(max-width: 47.99em)";

let phone = false;
type Listener = (event: { matches: boolean; media: string }) => void;
const phoneListeners = new Set<Listener>();

function setPhone(value: boolean) {
  phone = value;
  act(() => {
    for (const listener of phoneListeners) listener({ matches: value, media: PHONE_QUERY });
  });
}

function renderToasts() {
  return render(
    <MantineProvider env="test">
      <Toasts />
    </MantineProvider>,
  );
}

/** A dialog title bar on the page, drawn at `top`..`bottom`. */
function dialogHeader(top: number, bottom: number, className = "mantine-Modal-header") {
  const header = document.createElement("div");
  header.className = className;
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ bottom, height: bottom - top, top } as DOMRect);
  document.body.append(header);
  return header;
}

const toastTop = () => document.documentElement.style.getPropertyValue("--toast-top");

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  phone = false;
  phoneListeners.clear();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        addEventListener: (_type: string, listener: Listener) => phoneListeners.add(listener),
        addListener: (listener: Listener) => phoneListeners.add(listener),
        get matches() {
          return query === PHONE_QUERY && phone;
        },
        media: query,
        removeEventListener: (_type: string, listener: Listener) => phoneListeners.delete(listener),
        removeListener: (listener: Listener) => phoneListeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  for (const header of document.querySelectorAll(".mantine-Modal-header, .mantine-Drawer-header")) header.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Toasts", () => {
  it("stacks up to three toasts on a wide screen", async () => {
    renderToasts();
    act(() => {
      for (const n of [1, 2, 3, 4]) notify.success({ message: `Detail ${n}`, title: `Toast ${n}` });
    });
    await advance(0);
    expect(screen.getByText("Toast 1")).toBeTruthy();
    expect(screen.getByText("Toast 3")).toBeTruthy();
    expect(screen.queryByText("Toast 4")).toBeNull();
  });

  it("shows one toast at a time on a phone", async () => {
    phone = true;
    renderToasts();
    act(() => {
      notify.success({ message: "Detail 1", title: "Toast 1" });
      notify.error({ message: "Detail 2", title: "Toast 2" });
    });
    await advance(0);
    expect(screen.getByText("Toast 1")).toBeTruthy();
    expect(screen.queryByText("Toast 2")).toBeNull();
  });

  it("on a phone, moves a toast below an open dialog's title bar, and back when the toasts are gone", async () => {
    phone = true;
    renderToasts();
    dialogHeader(0, 56.4);
    // A header further down the screen is not in the way.
    dialogHeader(600, 650, "mantine-Drawer-header");
    expect(toastTop()).toBe("");

    act(() => notify.success({ message: "Saved", title: "Done" }));
    await advance(0);
    expect(toastTop()).toBe("64px");

    // A dialog opening on top later is followed.
    const higher = dialogHeader(0, 100);
    await advance(0);
    expect(toastTop()).toBe("108px");
    higher.remove();
    await advance(250);
    expect(toastTop()).toBe("64px");

    // Toasts close themselves: then nothing is left on <html>.
    await advance(10_000);
    expect(screen.queryByText("Done")).toBeNull();
    expect(toastTop()).toBe("");
  });

  it("does not move toasts on a wide screen, and lets go when the screen widens", async () => {
    renderToasts();
    dialogHeader(0, 56);
    act(() => notify.info({ message: "FYI", title: "Note" }));
    await advance(0);
    expect(toastTop()).toBe("");

    setPhone(true);
    await advance(250);
    expect(toastTop()).toBe("64px");

    setPhone(false);
    await advance(250);
    expect(toastTop()).toBe("");
  });

  it("leaves nothing behind when unmounted with a toast up", async () => {
    phone = true;
    const view = renderToasts();
    dialogHeader(0, 40);
    act(() => notify.warning({ message: "Careful", title: "Heads up" }));
    await advance(0);
    expect(toastTop()).toBe("48px");

    view.unmount();
    expect(toastTop()).toBe("");
  });
});
