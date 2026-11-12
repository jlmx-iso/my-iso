"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink, loggerLink, splitLink, unstable_httpBatchStreamLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterOutputs } from "@trpc/server";
import { useState } from "react";

import { MAX_TRPC_BATCH_SIZE } from "~/server/api/requestGuards";
import { type AppRouter } from "~/server/api/root";

import { getUrl, transformer } from "./shared";



export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for outputs from the tRPC router
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

const headers = () => ({ "x-trpc-source": "react" });

/**
 * No cookie handling here on purpose. This is a client component, so its
 * props are serialised into the HTML of every page: passing the request's
 * Cookie header in (as this provider once did) hands the HttpOnly session
 * token to any script on the page. The browser attaches cookies to these
 * same-origin requests by itself.
 */
export function TRPCReactProvider(props: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        splitLink({
          // The server refuses batched mutations (see requestGuards.ts), so
          // each mutation travels alone; queries are batched up to the cap.
          condition: (op) => op.type === "mutation",
          false: unstable_httpBatchStreamLink({
            headers,
            maxItems: MAX_TRPC_BATCH_SIZE,
            transformer,
            url: getUrl(),
          }),
          true: httpLink({
            headers,
            transformer,
            url: getUrl(),
          }),
        }),
      ],
    })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}
