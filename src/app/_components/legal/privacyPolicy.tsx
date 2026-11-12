import { Anchor } from "@mantine/core";

import { COMPANY, SITE_HOST, SUPPORT_EMAIL } from "~/_lib/site";
import { NextLink } from "~/app/_components/NextLink";

import { type LegalSection, OwnerTodo } from "./LegalPage";

// Every statement here is checked against the code it describes; the file
// it comes from is noted where that is not obvious. A fact the code cannot
// tell (an address, a retention period set in a dashboard) is an OwnerTodo.

const mail = <Anchor href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Anchor>;
const providers = (
  <Anchor component={NextLink} href="/subprocessors">
    list of service providers
  </Anchor>
);

export const PRIVACY_UPDATED = "November 2026";

export const PRIVACY_INTRO = (
  <>
    ISO ({SITE_HOST}) is an invite-only network where photographers find second shooters. It is run
    by {COMPANY.name}, a United States company (&ldquo;we&rdquo;). This policy says what we collect,
    why, who helps us process it, how long we keep it and what you can do about it.
  </>
);

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "Who is responsible",
    body: [
      <>
        {COMPANY.name} is responsible for your personal data on ISO (the &ldquo;controller&rdquo;).
        Write to us at {mail}. Our postal address is{" "}
        <OwnerTodo fallback={<>available on request from {SUPPORT_EMAIL}</>}>registered business address</OwnerTodo>.
      </>,
    ],
  },
  {
    title: "What we collect, and where it comes from",
    body: ["From you:"],
    list: [
      "Account: your name, email address, and how you sign in (Google, or a code we email you). Optionally a username, phone number, city, state and country.",
      "Profile: business name, location, bio, profile photo, website and social links, and the portfolio photos you upload with their titles, descriptions and tags.",
      "What you do on ISO: events you post, comments, likes and saved photographers, applications and bookings (with any rate or note), reviews, messages, and your Discover choices (who you liked or passed, your matches and preferences).",
      "The waitlist, if you joined it: name, email, Instagram, website and how you heard of us.",
      "Billing, if you subscribe to Pro: your plan and its status. You enter card details on Stripe's own pages; they never reach us.",
      "Automatically: your IP address and country, used for security, rate limits and the analytics rules in section 6 (they are not passed on to our analytics provider), and, only as section 6 allows, how you use the app.",
      "From Google, if you sign in with Google: your name and email address, and whether Google has verified the address. We do not keep Google's access tokens.",
      "From other members: reviews they write about you, messages they send you, their applications to your events and their answers to yours.",
      "From the member who invited you: the record that their invite code brought you in.",
    ],
  },
  {
    title: "How we use it, and on what legal basis",
    body: ["We use personal data only for these purposes:"],
    table: {
      head: ["Purpose", "Legal basis"],
      rows: [
        ["Your account, profile, events, bookings, messages, reviews, Discover and notifications, and the emails that go with them", "Contract: providing the service you signed up for"],
        ["Pro subscription and billing", "Contract; keeping billing records is a legal obligation"],
        ["Security: sign-in codes, rate limits, preventing abuse", "Legitimate interest in keeping ISO and its members safe"],
        ["Reports of errors in our servers", "Legitimate interest in keeping the service working"],
        ["Product analytics", "Your consent where the law requires it (section 6); elsewhere our legitimate interest in improving ISO, pseudonymously"],
        ["Session replay", "Your consent, everywhere"],
        ["Match summaries and conversation starters (section 5)", "Legitimate interest in helping matched members start talking"],
        ["Pro insights: daily view counts of profiles and events", "Legitimate interest in showing Pro members how their pages are found"],
      ],
    },
  },
  {
    title: "Who can see what",
    body: [
      "Other members see your profile, portfolio, events, comments and reviews. Messages are seen only by the people in the conversation. Booking notes are seen by the other side of the booking.",
      "If you set a username, your profile (name, business, location, bio, photos and reviews) is public at its own web address, can be found through search engines, and may be read by AI crawlers.",
      "Pro insights. When you open a member's profile or event and it is on screen, we add one to that day's view count; Pro members see daily totals and, for profiles, the kind of page the visit came from (search, an event, Discover, Messages, bookings, a profile, elsewhere on ISO, another site, or direct). The kind of page is approximate: it comes from the page your browser says you came from, and a visit counts as from Messages only when you share a conversation with that member. Small counts from one kind of page are shown as Other, so nobody can guess who looked. We never record who viewed. Your own visits and automated visitors are not counted. To count each viewer once a day we keep a one-way keyed hash of your account id or, if you are signed out, your IP address (IPv6 by its first half), and delete it daily; unless you have refused analytics (or not yet accepted where that is needed), your browser also keeps a cookie, iso_views, that expires at the end of the day.",
      <>
        Service providers process data for us to run ISO: see the {providers}. We may also disclose
        data when the law requires it. We do not sell your personal data and do not use it for
        advertising.
      </>,
    ],
  },
  {
    title: "Match summaries and conversation starters",
    body: [
      "When two members match, we send Anthropic's Claude model, for each of the two: first name, city and state (or the profile's location), business name, the first 600 characters of the bio, up to 12 portfolio tags, and the average review rating with the number of reviews. It writes a short summary of why you might work well together and a few conversation starters. They are generated once, stored with the match, and shown only to the two of you. We do not let the text include links, email addresses or phone numbers.",
      "These are suggestions; no decision about you is made by automated means.",
      "Location fields: what you type into a location field (a city name) is sent to Google Places to suggest matching places.",
    ],
  },
  {
    title: "Analytics, session replay and cookies",
    body: [
      "Analytics (PostHog) tell us which pages and features are used and report errors. They go through our own domain; your browser never contacts PostHog directly. Before anything leaves, URL query strings, email addresses and codes are removed, and no name or email address is ever sent. Analytics are linked to your account id, never to your name or email. We do not pass on your IP address and PostHog does not look up a location, so analytics hold no IP address or location.",
      "In the EU, the EEA, the UK, Switzerland, Canada and Brazil, or when we can't tell where you are, nothing is measured until you accept. Reports of errors in our servers are still sent without anything that identifies you.",
      "Elsewhere, until you choose, we count usage linked to your account id, with nothing stored in your browser.",
      "Session replay records clicks and page changes so we can see where the app gets in the way. It is only ever on if you switch it on. Every piece of text, everything typed and every photo is hidden in a recording.",
      "If your browser sends a Global Privacy Control signal, we treat it as a refusal, everywhere. You can change your choice at any time with \"Privacy choices\" in the footer or in Settings. Withdrawing consent does not affect what was processed before.",
      "What we store in your browser (on the live site the sign-in cookies carry the __Secure- or __Host- prefix):",
    ],
    table: {
      head: ["Name", "What it is for", "When", "How long"],
      rows: [
        ["authjs.session-token", "Keeps you signed in", "Always (needed)", "Until 24 hours without use"],
        ["authjs.csrf-token, authjs.callback-url", "Protect and complete sign-in", "Always (needed)", "Until the browser closes"],
        ["authjs.state, authjs.pkce.code_verifier", "Complete sign-in with Google", "Only during a Google sign-in", "15 minutes"],
        ["iso_consent", "Remembers your privacy choice", "Once you choose", "6 months"],
        ["iso_views", "Counts your view of a profile or event once a day (Pro insights); holds no identity", "When you view one, unless you refused analytics (or have not yet accepted, where acceptance is needed)", "Until the end of the day (UTC)"],
        ["ph_<project>_posthog (cookie and localStorage)", "Analytics state", "Only after you accept analytics", "Up to 1 year, or until you withdraw consent"],
        ["iso_analytics_user (localStorage)", "Ends the analytics identity when you sign out", "Only after you accept analytics", "Until sign-out or withdrawal"],
      ],
    },
  },
  {
    title: "How long we keep it",
    body: ["We keep your data while you have an account. Some things go sooner:"],
    list: [
      "Sign-in codes: 10 minutes. Sign-in sessions end after 24 hours without use.",
      "Invite checks made during sign-up (5 minutes for a typed code, 7 days after a waitlist approval) and rate-limit counters, which hold only a one-way keyed hash of your IP address or account (at most a day): deleted by a daily clean-up once they expire.",
      "Discover matches expire after 72 hours if nobody writes; the record of the match stays until one of you deletes their account.",
      <>
        Waitlist entries:{" "}
        <OwnerTodo fallback="until the application is decided and, after that, for as long as we need it to answer questions about it">
          retention period for waitlist entries
        </OwnerTodo>
        .
      </>,
      <>
        Server logs at our hosting provider (Cloudflare Workers Logs), which may hold your IP address:{" "}
        <OwnerTodo fallback="for the period our hosting plan keeps them, after which they are deleted automatically">
          number of days Workers Logs are kept on the current plan
        </OwnerTodo>
        .
      </>,
      <>
        Database backups (Cloudflare D1 Time Travel):{" "}
        <OwnerTodo fallback="for the period our hosting plan keeps them, after which they are deleted automatically">
          number of days of D1 Time Travel on the current plan
        </OwnerTodo>
        .
      </>,
      "When you delete your account, section 9 says what goes and what stays.",
    ],
  },
  {
    title: "Download your data",
    body: [
      "In Settings, \"Download your data\" gives you a JSON file with everything ISO stores about you: your account and profile, portfolio, events, comments, likes and saved photographers, bookings on both sides, reviews you wrote and received, the messages you sent and the conversations you are in, your Discover history and matches, notifications, your plan, your invites, your waitlist entry, the privacy choice in effect, and the web address of every photo you uploaded. Messages others sent you stay readable in the app. Very long histories are cut to the latest 5,000 messages you sent and 2,000 notifications; the file says when it was cut, and you can ask us for the rest.",
    ],
  },
  {
    title: "Deleting your account",
    body: [
      "In Settings, \"Delete account\". It takes effect at once: you are signed out on every device, and your profile and events are hidden from everyone. The rest below normally happens straight away; if one of our providers is unavailable at that moment, we finish it automatically, usually within the hour.",
      "Any Pro subscription is cancelled and its open invoices voided, so nothing more is charged. The unused part of the period you paid for is not refunded automatically; write to us if you think it should be.",
      "We delete: your profile details, portfolio and every photo you uploaded (also from our image host), your comments, likes and saved photographers, your Discover swipes and matches (with their summaries), your notifications, your waitlist entry, pending sign-up checks and codes for your address, your Google sign-in link, the reviews others wrote about you, and the view counts of your profile and events.",
      <>
        Your analytics and any session recordings are deleted from our analytics provider automatically
        where we have set that up, and otherwise by hand within{" "}
        <OwnerTodo fallback="one month">period for deleting analytics by hand</OwnerTodo>.
      </>,
      "We hide your events: they disappear from ISO and their description and cover photo are deleted, but their title, date and place stay in the booking history of members who applied.",
      "What stays, without your name (shown as \"Deleted member\"): messages you sent stay in the conversations of the people who received them; reviews you wrote about others stay; bookings keep their status, date and event title, without your notes; other members' notifications that named you now name \"Deleted member\". Your invite code stops working; members you invited keep their accounts.",
      <>
        We keep a minimal record of your subscription and your Stripe customer id, and Stripe keeps its
        billing records, for{" "}
        <OwnerTodo fallback="as long as tax and accounting law requires">billing record retention period</OwnerTodo>.
        Copies in backups and providers&apos; logs expire on their own schedules (section 7).
      </>,
    ],
  },
  {
    title: "Your rights",
    body: [
      "Depending on where you live, you can ask us to give you a copy of your data (most of it is in \"Download your data\"), correct it, delete it (\"Delete account\"), restrict how we use it, or move it to another service. You can withdraw consent at any time; that does not affect what we did before.",
      "You have a separate right to object to what we do on the basis of legitimate interest (section 3), including analytics, and we will stop unless we have compelling grounds.",
      <>
        To make a request, write to {mail} from the address on your account. We may need to check it is
        you before we act. We answer within one month (EU, EEA and UK), or 45 days where US state law
        applies; we tell you if we need longer. You may ask someone to act for you as your authorised
        agent; we will ask for proof that they may. We will not treat you differently for using these
        rights.
      </>,
      "If you are not satisfied, you can complain to your data protection authority: in the UK, the Information Commissioner's Office (ICO); in the EU, the authority of the country where you live.",
    ],
  },
  {
    title: "If you live in the United States",
    body: [
      "In the past 12 months we have collected these categories of personal information, for the purposes in section 3: identifiers (name, email address, account id, IP address); customer records (phone number and address fields you choose to add); commercial information (your Pro plan); internet activity (how you use ISO, as section 6 allows); approximate location (country); photos you upload; professional information (business, portfolio, events and bookings); and inferences (match summaries).",
      "Sensitive personal information: the contents of your messages, and your sign-in codes. We use them only to provide the service.",
      "We have not sold or shared personal information in the past 12 months.",
    ],
  },
  {
    title: "Where your data is processed",
    body: [
      <>
        {COMPANY.name} is in the United States, and so are several of our providers. Where the law
        requires safeguards for transfers out of your country, we rely on{" "}
        <OwnerTodo fallback="the safeguards the law provides for (such as Standard Contractual Clauses), which you can ask us about">
          the transfer mechanism, e.g. the Data Privacy Framework or Standard Contractual Clauses, per provider
        </OwnerTodo>
        .
      </>,
    ],
  },
  {
    title: "Security",
    body: [
      "Data travels encrypted (HTTPS), sign-in codes are single-use and expire, and requests are rate limited. No system is perfectly secure; if a breach affects you, we will tell you as the law requires.",
    ],
  },
  {
    title: "Children",
    body: [
      <>
        ISO is for professional photographers.{" "}
        <OwnerTodo fallback="It is not meant for children, and we do not knowingly collect their data.">
          minimum age to hold an account
        </OwnerTodo>
      </>,
    ],
  },
  {
    title: "Changes",
    body: [
      "If we change this policy in a way that matters, we will tell you by email or in the app before the change takes effect. The date at the top says when it last changed.",
    ],
  },
  {
    title: "Contact",
    body: [<>Questions or requests: {mail}.</>],
  },
];
