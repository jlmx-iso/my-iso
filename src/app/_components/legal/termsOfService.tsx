import { Anchor } from "@mantine/core";

import { COMPANY, SITE_HOST, SUPPORT_EMAIL } from "~/_lib/site";
import { NextLink } from "~/app/_components/NextLink";

import { type LegalSection, OwnerTodo } from "./LegalPage";

const mail = <Anchor href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Anchor>;

export const TERMS_UPDATED = "November 2026";

export const TERMS_INTRO = (
  <>
    These terms are the agreement between you and {COMPANY.name} (&ldquo;we&rdquo;), which runs ISO
    ({SITE_HOST}). By creating an account or using ISO you accept them. If you do not, please do not
    use ISO.
  </>
);

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "What ISO is",
    body: [
      "ISO is an invite-only network where photographers post events, find second shooters, apply, message each other and leave reviews. We provide the platform; we are not a party to any job, booking or payment arrangement between members, and we do not employ or vouch for any member.",
    ],
  },
  {
    title: "Who may use ISO",
    body: [
      <>
        ISO is for professional photographers acting in the course of their business, not for
        personal or household use.{" "}
        <OwnerTodo fallback="">confirm this business-only scope, and any minimum age or other eligibility rules</OwnerTodo>
      </>,
      "You need an invite (or an approved waitlist application) to join. Give accurate details, keep your sign-in method secure, and tell us if you think someone else is using your account. You are responsible for what happens under it.",
    ],
  },
  {
    title: "Your content",
    body: [
      "You keep ownership of what you post: photos, profile text, events, messages and reviews. You give us a non-exclusive, worldwide, royalty-free licence to host, store, copy, resize and display it to run ISO, including showing your public profile to anyone and letting search engines index it, and to have our service providers process it for us (including AI models that write match summaries, as the privacy policy describes). The licence lasts as long as the content is on ISO, and, for messages you sent and reviews you wrote, as the privacy policy describes after you delete your account.",
      "Only post content you have the right to share. Portfolio photos must be your own work or used with permission.",
    ],
  },
  {
    title: "Acceptable use",
    body: ["Do not use ISO to:"],
    list: [
      "harass, threaten, discriminate against or spam other members;",
      "post content that is unlawful, infringing, misleading or sexually explicit;",
      "impersonate someone, or misrepresent your experience or work;",
      "scrape, copy or bulk-download other members' data, or get around rate limits or security;",
      "use member contact details for anything but the work you connected about.",
    ],
  },
  {
    title: "Copyright complaints",
    body: [
      <>
        If you believe content on ISO infringes your copyright, send a notice to our designated agent:{" "}
        <OwnerTodo fallback={<>{SUPPORT_EMAIL}</>}>DMCA designated agent name, address and email (registered with the US Copyright Office)</OwnerTodo>
        . Include: your signature; the work you say is infringed; where the content is on ISO (its web
        address); your contact details; a statement that you believe in good faith the use is not
        authorised; and a statement, under penalty of perjury, that the notice is accurate and that you
        are the owner or authorised to act for them.
      </>,
      "We remove or disable content named in a valid notice and tell the member who posted it, who may send a counter-notice. We close the accounts of members who repeatedly infringe.",
    ],
  },
  {
    title: "Bookings between members",
    body: [
      "Applications, bookings and rates on ISO are arrangements between members. Agree the details (pay, usage rights, cancellation) between yourselves. We do not process payments between members and are not responsible for whether a job happens or is paid.",
    ],
  },
  {
    title: "ISO Pro",
    body: [
      "Pro is a paid subscription, billed in advance each month or year through Stripe. It renews automatically at the price shown when you subscribed until you cancel. You can cancel at any time in Settings → Current plan → Manage subscription; you keep Pro until the end of the period you paid for. Prices are shown before you subscribe.",
      "We may change Pro prices for future periods; we will tell you before a change applies to you, and you can cancel before it does. A founding member price is an exception: it stays the same for as long as that subscription stays active, and a price change does not apply to it.",
      "Deleting your account cancels Pro immediately, without a refund for the rest of the period unless the law requires one. Write to us if something went wrong with a payment.",
      <>
        If we close your account for breaking these terms:{" "}
        <OwnerTodo fallback="your subscription is cancelled; write to us about any refund">what happens to Pro and any refund when we close an account</OwnerTodo>
        .
      </>,
      <OwnerTodo fallback="" key="pro-todo">refund policy, taxes, and price-change notice period</OwnerTodo>,
    ],
  },
  {
    title: "Match summaries and icebreakers",
    body: [
      "When you match with someone, ISO may show a short summary and conversation starters written by an AI model from both profiles. They are suggestions, can be wrong, and are not statements by us or the other member.",
    ],
  },
  {
    title: "Ending your account",
    body: [
      <>
        You can delete your account at any time in Settings; the{" "}
        <Anchor component={NextLink} href="/privacy">
          privacy policy
        </Anchor>{" "}
        says what is deleted and what is kept. We may suspend or close accounts that break these terms
        or put other members at risk.
      </>,
    ],
  },
  {
    title: "Disclaimers and liability",
    body: [
      "ISO is provided as is and as available. To the extent the law allows, we disclaim implied warranties and are not liable for indirect or consequential losses, or for what members do or fail to do.",
      <OwnerTodo fallback="" key="liability-todo">liability cap and any consumer-law carve-outs</OwnerTodo>,
    ],
  },
  {
    title: "Governing law and disputes",
    body: [
      <>
        These terms are governed by the laws of{" "}
        <OwnerTodo fallback={`the state in which ${COMPANY.name} is organised`}>governing law state</OwnerTodo>
        . <OwnerTodo fallback="">venue or dispute-resolution clause</OwnerTodo>
      </>,
    ],
  },
  {
    title: "Changes to these terms",
    body: [
      "If we change these terms in a way that matters, we will tell you by email or in the app before the change takes effect. Using ISO after that means you accept the new terms.",
    ],
  },
  {
    title: "Contact",
    body: [
      <>
        {COMPANY.name},{" "}
        <OwnerTodo fallback={<>postal address available on request</>}>registered business address</OwnerTodo>.
        Email: {mail}.
      </>,
    ],
  },
];
