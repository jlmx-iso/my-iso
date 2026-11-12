import LegalPage from "~/app/_components/legal/LegalPage";
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_UPDATED } from "~/app/_components/legal/termsOfService";
import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description: "The terms for using ISO, the photographer second shooter network.",
  path: "/terms",
  title: "Terms of Service",
});

export default function TermsPage() {
  return <LegalPage title="Terms of Service" updated={TERMS_UPDATED} intro={TERMS_INTRO} sections={TERMS_SECTIONS} />;
}
