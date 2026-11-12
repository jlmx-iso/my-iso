import type { Metadata } from "next";

import NotFoundState from "./_components/NotFoundState";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <NotFoundState
      title="Page not found"
      description="Looks like this page went out of focus. It doesn't exist or may have been moved."
      action={{ href: "/", label: "Back to home" }}
    />
  );
}
