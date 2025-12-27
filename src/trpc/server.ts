import "server-only";

import { cookies } from "next/headers";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

const createCaller = async () => {
  const cookieStore = await cookies();
  const context = await createTRPCContext({
    headers: new Headers({
      cookie: cookieStore.toString(),
      "x-trpc-source": "rsc",
    }),
  });

  return appRouter.createCaller(context);
};

export const api = createCaller;
