import LegalPage from "~/app/_components/legal/LegalPage";
import {
  SUBPROCESSORS_INTRO,
  SUBPROCESSORS_UPDATED,
  subprocessorSections,
} from "~/app/_components/legal/subprocessors";
import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description: "The service providers that process personal data to run ISO, and what each receives.",
  path: "/subprocessors",
  title: "Service providers",
});

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Service providers"
      updated={SUBPROCESSORS_UPDATED}
      intro={SUBPROCESSORS_INTRO}
      sections={subprocessorSections()}
    />
  );
}
