import LegalPage from "~/app/_components/legal/LegalPage";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, PRIVACY_UPDATED } from "~/app/_components/legal/privacyPolicy";
import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description: "What ISO collects, why, who processes it, how long it is kept, and how to download or delete your data.",
  path: "/privacy",
  title: "Privacy Policy",
});

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" updated={PRIVACY_UPDATED} intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />;
}
