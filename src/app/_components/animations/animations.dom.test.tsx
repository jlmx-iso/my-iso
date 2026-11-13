// @vitest-environment happy-dom
//
// The landing page's scroll animations. Content is always there: a number
// shows its final value until it scrolls into view (and for screen readers
// throughout, and for anyone who prefers reduced motion), and revealed
// blocks are marked once they are seen, or at once when they cannot be
// observed. The reveal components tell the inline script React is running.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CountUp } from "./CountUp";
import { FadeInOnScroll, StaggerContainer } from "./Reveal";
import { REVEAL_READY_ATTRIBUTE } from "./revealScript";

/** An IntersectionObserver the test drives. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  disconnected = false;
  observed: Element[] = [];
  constructor(readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The observed element scrolls (or not) into view. */
  intersect(isIntersecting = true) {
    act(() => this.callback([{ isIntersecting }]));
  }
}

let reducedMotion = false;
let frames: Array<(now: number) => void> = [];
let clock = 0;

/** Runs animation frames up to `ms` from now. */
function runFrames(ms: number) {
  const end = clock + ms;
  while (frames.length > 0 && clock < end) {
    clock = Math.min(end, clock + 16);
    const due = frames;
    frames = [];
    act(() => {
      for (const frame of due) frame(clock);
    });
  }
}

const shown = (element: HTMLElement) => element.querySelector("[aria-hidden]")?.textContent;

beforeEach(() => {
  FakeObserver.instances = [];
  frames = [];
  clock = 0;
  reducedMotion = false;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion, media: query }) as MediaQueryList,
  );
  document.documentElement.removeAttribute(REVEAL_READY_ATTRIBUTE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CountUp", () => {
  it("shows the final number until seen, then counts up to it; screen readers get the final number", () => {
    const view = render(<CountUp target={1200} prefix="$" suffix="+" duration={1000} />);
    const counter = view.container.firstElementChild as HTMLElement;
    expect(shown(counter)).toBe("$1,200+");
    expect(screen.getByText("$1,200+", { selector: ".sr-only" })).toBeTruthy();

    FakeObserver.instances[0]!.intersect();
    expect(FakeObserver.instances[0]!.disconnected).toBe(true);
    runFrames(16);
    expect(Number(shown(counter)?.replace(/\D/g, ""))).toBeLessThan(1200);

    runFrames(2000);
    expect(shown(counter)).toBe("$1,200+");
    expect(frames).toHaveLength(0);
  });

  it("waits while out of view, and can show the number without separators", () => {
    const view = render(<CountUp target={5000} formatted={false} />);
    FakeObserver.instances[0]!.intersect(false);
    expect(frames).toHaveLength(0);
    expect(shown(view.container.firstElementChild as HTMLElement)).toBe("5000");
  });

  it("does not animate for a visitor who prefers reduced motion", () => {
    reducedMotion = true;
    render(<CountUp target={42} />);
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it("stops the animation when it goes away", () => {
    const view = render(<CountUp target={100} />);
    FakeObserver.instances[0]!.intersect();
    expect(frames).toHaveLength(1);
    view.unmount();
    expect(frames).toHaveLength(0);
  });
});

describe("FadeInOnScroll", () => {
  it("marks the content revealed once it scrolls into view, and tells the page React is running", () => {
    const view = render(
      <FadeInOnScroll delay={0.2} direction="left" y={30} className="hero">
        <p>Hello</p>
      </FadeInOnScroll>,
    );
    const block = view.container.firstElementChild as HTMLElement;
    expect(document.documentElement.hasAttribute(REVEAL_READY_ATTRIBUTE)).toBe(true);
    expect(block.className).toBe("reveal hero");
    expect(block.style.getPropertyValue("--reveal-x")).toBe("-30px");
    expect(block.style.getPropertyValue("--reveal-delay")).toBe("200ms");
    expect(block.hasAttribute("data-revealed")).toBe(false);

    FakeObserver.instances[0]!.intersect(false);
    expect(block.hasAttribute("data-revealed")).toBe(false);
    FakeObserver.instances[0]!.intersect();
    expect(block.hasAttribute("data-revealed")).toBe(true);
    expect(FakeObserver.instances[0]!.disconnected).toBe(true);
  });

  it("reveals at once where nothing can be observed", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const view = render(
      <FadeInOnScroll direction="right">
        <p>Hello</p>
      </FadeInOnScroll>,
    );
    const block = view.container.firstElementChild as HTMLElement;
    expect(block.hasAttribute("data-revealed")).toBe(true);
    expect(block.style.getPropertyValue("--reveal-x")).toBe("24px");
  });
});

describe("StaggerContainer", () => {
  it("reveals each child with a growing delay", () => {
    const view = render(
      <StaggerContainer stagger={0.1}>
        <p>One</p>
        <p>Two</p>
      </StaggerContainer>,
    );
    const items = [...view.container.querySelectorAll<HTMLElement>(".reveal")];
    expect(items.map((item) => item.style.getPropertyValue("--reveal-delay"))).toEqual(["0ms", "100ms"]);
    expect(items.every((item) => !item.hasAttribute("data-revealed"))).toBe(true);

    FakeObserver.instances[0]!.intersect();
    expect(items.every((item) => item.hasAttribute("data-revealed"))).toBe(true);
  });
});
