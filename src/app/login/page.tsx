import { redirect } from "next/navigation";

import { sanitizeCallbackUrl } from "~/_utils/callbackUrl";
import { isAppPath } from "~/app/_components/nav/appPath";
import { pageMetadata } from "~/app/_lib/siteMetadata";
import { auth } from "~/auth";

import LoginForm from "./_components/LoginForm";

export const metadata = pageMetadata({
  description: "Sign in to ISO, the network where lead photographers find second shooters.",
  path: "/login",
  title: "Log in",
});

type PageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function Page({ searchParams }: PageProps) {
  const { callbackUrl: requested, error } = await searchParams;
  // The middleware sends anonymous /app visitors here with the page they
  // asked for. Never trust it as-is: it is attacker-controllable.
  const callbackUrl = sanitizeCallbackUrl(first(requested));

  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return (
    <LoginForm
      callbackUrl={callbackUrl}
      // Only when the middleware bounced the visitor off an app page: a bare
      // /login link (or a rejected callbackUrl) needs no explanation.
      signInRequired={
        callbackUrl === first(requested) && isAppPath(callbackUrl.split(/[?#]/)[0] ?? "")
      }
      authError={first(error)}
    />
  );
}
