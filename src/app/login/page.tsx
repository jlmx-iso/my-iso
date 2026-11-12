import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { sanitizeCallbackUrl } from "~/_utils/callbackUrl";
import { auth } from "~/auth";

import LoginForm from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "Log in",
};

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { callbackUrl: requested } = await searchParams;
  // The middleware sends anonymous /app visitors here with the page they
  // asked for. Never trust it as-is: it is attacker-controllable.
  const callbackUrl = sanitizeCallbackUrl(
    Array.isArray(requested) ? requested[0] : requested,
  );

  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return <LoginForm callbackUrl={callbackUrl} />;
}
