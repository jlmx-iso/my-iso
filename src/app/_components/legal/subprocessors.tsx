import { COMPANY, SUPPORT_EMAIL } from "~/_lib/site";

import { type LegalSection, OwnerTodo } from "./LegalPage";

// Owner checklist, not shown on the page: confirm a data processing
// agreement (or the provider's standard terms that include one) is in place
// with each provider below, and confirm each provider's processing location
// against its terms before launch.

export const SUBPROCESSORS_UPDATED = "November 2026";

export type Subprocessor = {
  name: string;
  purpose: string;
  data: string;
  /** Where the data is processed, as far as this app's configuration says. */
  location: React.ReactNode;
};

const confirmLater = "as set out in the provider's terms";

/**
 * Every outside service that processes members' personal data for ISO.
 * Keep in step with the code: a new service that receives personal data
 * needs a row here and a mention in the privacy policy.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  {
    data: "Everything ISO stores (the database, uploaded files in transit), every request including IP addresses, server logs (Workers Logs) and rate-limiting counters at the edge.",
    location: (
      <>
        Global edge network; database:{" "}
        <OwnerTodo fallback={confirmLater}>D1 location of the production database</OwnerTodo>
      </>
    ),
    name: "Cloudflare, Inc.",
    purpose: "Hosting: the app (Workers), its database (D1), live chat (Durable Objects), logs (Workers Logs), Rate Limiting and network security.",
  },
  {
    data: "Product analytics events, error reports and, only with consent, session recordings with all text and photos hidden. Linked to an account id; never a name, email or IP address.",
    location: <OwnerTodo fallback={confirmLater}>region (US or EU cloud) of the production PostHog project</OwnerTodo>,
    name: "PostHog, Inc.",
    purpose: "Product analytics, error tracking, session replay (opt-in) and feature flags.",
  },
  {
    data: "For Pro subscribers: email address, ISO account id and plan, and the payment details entered on Stripe's own pages, which never reach ISO.",
    location: <OwnerTodo fallback={confirmLater}>Stripe processing locations</OwnerTodo>,
    name: "Stripe, Inc.",
    purpose: "Payments and subscription billing.",
  },
  {
    data: "Email address, name and the content of each email (sign-in codes, notifications, account emails).",
    location: <OwnerTodo fallback={confirmLater}>Resend processing locations</OwnerTodo>,
    name: "Resend",
    purpose: "Sending email.",
  },
  {
    data: "Photos members upload (profile, portfolio, event covers). Photos are delivered from Cloudinary, so it also receives the IP address and browser details of anyone who views them.",
    location: <OwnerTodo fallback={confirmLater}>Cloudinary data region of the account</OwnerTodo>,
    name: "Cloudinary Ltd.",
    purpose: "Storing, resizing and delivering images.",
  },
  {
    data: "For two matched members: first name, city and state or location, business name, the first 600 characters of the bio, up to 12 portfolio tags, and the average rating with the number of reviews.",
    location: <OwnerTodo fallback={confirmLater}>Anthropic processing locations</OwnerTodo>,
    name: "Anthropic, PBC",
    purpose: "Writing match summaries and conversation starters (Claude).",
  },
  {
    data: "For Google sign-in: the Google account's name and email address. For location suggestions: the text typed into a location field. A profile picture hosted by Google (lh3.googleusercontent.com), where an account has one, is loaded from Google, which then receives the viewer's IP address and browser details.",
    location: <OwnerTodo fallback={confirmLater}>Google processing locations</OwnerTodo>,
    name: "Google LLC",
    purpose: "Sign in with Google, and location suggestions (Places API).",
  },
  {
    data: "What you write to us, and your email address.",
    location: <OwnerTodo fallback={confirmLater}>support mailbox location</OwnerTodo>,
    name: "Support mailbox",
    purpose: `Receiving email sent to ${SUPPORT_EMAIL}. Provider: `,
  },
];

/** One section per provider, for the legal page layout. */
export function subprocessorSections(): LegalSection[] {
  return SUBPROCESSORS.map((processor) => ({
    body: [
      processor.name === "Support mailbox" ? (
        <>
          {processor.purpose}
          <OwnerTodo fallback="our email provider">host of the support mailbox</OwnerTodo>.
        </>
      ) : (
        processor.purpose
      ),
    ],
    list: [
      <>
        <strong>Data:</strong> {processor.data}
      </>,
      <>
        <strong>Where:</strong> {processor.location}
      </>,
    ],
    title: processor.name,
  }));
}

export const SUBPROCESSORS_INTRO = (
  <>
    The outside services that process personal data for {COMPANY.name} to run ISO, and what each
    receives. Google (for sign-in) and Stripe (for payments) also act partly as independent
    controllers under their own privacy policies.
  </>
);
