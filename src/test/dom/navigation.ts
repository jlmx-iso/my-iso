/**
 * A stand-in for `next/navigation` that records where a component sends the
 * browser:
 *
 *   vi.mock("next/navigation", () => import("~/test/dom/navigation"));
 *   import { testRouter } from "~/test/dom/navigation";
 *   expect(testRouter.replace).toHaveBeenCalledWith("/app/messages/t1");
 *
 * `testRouter.reset()` (run before each test by src/test/dom/setup.ts)
 * clears the calls, the path and the search params.
 */
import { vi } from "vitest";

let pathname = "/";
let searchParams = new URLSearchParams();

const router = {
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
};

export const testRouter = {
  ...router,
  /** Sets what usePathname and useSearchParams answer. */
  setLocation(path: string, search = "") {
    pathname = path;
    searchParams = new URLSearchParams(search);
  },
  reset() {
    for (const fn of Object.values(router)) fn.mockReset();
    pathname = "/";
    searchParams = new URLSearchParams();
  },
};

export function useRouter() {
  return router;
}

export function usePathname() {
  return pathname;
}

export function useSearchParams() {
  return searchParams;
}

export function redirect(url: string): never {
  throw new Error(`redirect(${url}) called in a client component test`);
}

export function notFound(): never {
  throw new Error("notFound() called in a client component test");
}
