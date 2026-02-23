import { redirect } from "next/navigation";

/**
 * Legacy /register route — redirects to /join.
 * A permanent redirect is also configured in next.config.js for better performance,
 * but this page exists as a fallback in case the config redirect is bypassed.
 */
export default function Page() {
  redirect("/join");
}
