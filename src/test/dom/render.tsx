import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import type { ReactElement, ReactNode } from "react";

import type { AppRouter } from "~/server/api/root";
import { api, type RouterOutputs } from "~/trpc/react";
import type { RouterInputs } from "~/trpc/shared";

/**
 * Server answers for the procedures a component calls, by router and
 * procedure, typed from the app router. Return the output, or throw (for
 * instance `trpcError("FORBIDDEN", "...")`) to make the call fail. A call to
 * a procedure without a handler fails the test.
 */
export type TrpcHandlers = {
  [R in keyof RouterInputs]?: {
    [P in keyof RouterInputs[R]]?: (
      input: RouterInputs[R][P],
    ) => RouterOutputs[R][P] | Promise<RouterOutputs[R][P]>;
  };
};

/** An error as the server would send it, with its tRPC code. */
export function trpcError(
  code: TRPC_ERROR_CODE_KEY,
  message: string = code,
  /** More of the error's `data`, e.g. `{ reason: ErrorReason.PORTFOLIO_FULL }` or a `zodError`. */
  data: Record<string, unknown> = {},
) {
  return TRPCClientError.from({
    error: { code: -32000, data: { code, httpStatus: 0, ...data }, message },
  });
}

/** One recorded call through the mocked client. */
export type TrpcCall = { input: unknown; path: string; type: string };

/**
 * A tRPC client whose only link answers from `handlers`, in process: the
 * real @trpc/react-query hooks run on top of it (caching, mutations,
 * onError/onSuccess, invalidation), only the network is replaced.
 */
function mockLink(handlers: TrpcHandlers, calls: TrpcCall[]): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        calls.push({ input: op.input, path: op.path, type: op.type });
        const [router = "", procedure = ""] = op.path.split(".");
        const handler = (handlers as Record<string, Record<string, ((input: unknown) => unknown) | undefined> | undefined>)[
          router
        ]?.[procedure];

        let cancelled = false;
        void (async () => {
          try {
            if (!handler) throw new Error(`No test handler for tRPC ${op.type} "${op.path}"`);
            const data = await handler(op.input);
            if (cancelled) return;
            observer.next({ result: { data, type: "data" } });
            observer.complete();
          } catch (error) {
            if (!cancelled) observer.error(TRPCClientError.from(error as Error));
          }
        })();
        return () => {
          cancelled = true;
        };
      });
}

type ProviderOptions = {
  /** Answers for the procedures the component calls. */
  trpc?: TrpcHandlers;
};

/**
 * Renders `ui` inside MantineProvider (with the toast container) and a
 * tRPC + React Query provider backed by `options.trpc`. Returns Testing Library's result plus `calls`,
 * every tRPC call made so far (path, input), and `callsTo(path)`.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { trpc: handlers = {}, ...renderOptions } = options;
  const calls: TrpcCall[] = [];
  const queryClient = new QueryClient({
    defaultOptions: {
      // A failed call fails at once; components that retry do it themselves.
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const trpcClient = api.createClient({ links: [mockLink(handlers, calls)] });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      // env="test": no transitions and no portals (Mantine's test mode), and
      // popovers are not hidden for want of a layout (happy-dom has none).
      <MantineProvider env="test">
        {/* Toasts (~/app/_lib/notify) appear in the document, as in the app. */}
        <Notifications />
        <QueryClientProvider client={queryClient}>
          <api.Provider client={trpcClient} queryClient={queryClient}>
            {children}
          </api.Provider>
        </QueryClientProvider>
      </MantineProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });
  return {
    ...result,
    calls,
    callsTo: (path: string) => calls.filter((call) => call.path === path).map((call) => call.input),
    queryClient,
  };
}
