import {
  Button,
  Heading,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import {
  heading,
  paragraph,
  ctaButton,
  calloutBox,
  calloutText,
  colors,
  ctaSection,
} from "./components/styles";

type ReviewReceivedEmailProps = {
  firstName: string;
  reviewerName: string;
  rating: number;
  reviewPreview: string;
  profileUrl: string;
  unsubscribeUrl?: string;
};

function StarRating({ rating }: { rating: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Text
        key={i}
        style={{
          display: "inline",
          fontSize: "24px",
          color: i <= rating ? colors.yellow400 : colors.gray200,
          margin: "0 2px",
          lineHeight: "1",
        }}
      >
        &#9733;
      </Text>
    );
  }
  return (
    <Section style={{ textAlign: "center", margin: "16px 0" }}>
      {stars}
    </Section>
  );
}

export function ReviewReceivedEmail({
  firstName,
  reviewerName,
  rating,
  reviewPreview,
  profileUrl,
  unsubscribeUrl,
}: ReviewReceivedEmailProps) {
  return (
    <Layout
      preview={`${reviewerName} left you a ${rating}-star review!`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You received a new review!</Heading>

      <Text style={paragraph}>
        Hey {firstName}, {reviewerName} just left you a review on ISO.
      </Text>

      <StarRating rating={rating} />

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontStyle: "italic" }}>
          "{reviewPreview}"
        </Text>
        <Text style={{ ...calloutText, marginTop: "8px", fontWeight: "600" }}>
          — {reviewerName}
        </Text>
      </Section>

      <Text style={paragraph}>
        Reviews build trust and help you stand out. This one will show up on
        your profile for potential clients and collaborators to see.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={profileUrl}>
          View Your Profile
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderReviewReceivedEmail(
  props: ReviewReceivedEmailProps
): Promise<string> {
  return render(<ReviewReceivedEmail {...props} />);
}
