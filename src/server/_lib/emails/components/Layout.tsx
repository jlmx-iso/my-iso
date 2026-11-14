import type * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Hr,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

import { layout } from "./styles";

type LayoutProps = {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl?: string;
};

export function Layout({ preview, children, unsubscribeUrl }: LayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={layout.body}>
        <Container style={layout.container}>
          {/* Header */}
          <Section style={layout.header}>
            <Text style={layout.logo}>ISO</Text>
          </Section>

          {/* Content */}
          <Section style={layout.content}>{children}</Section>

          {/* Footer */}
          <Section style={layout.footer}>
            <Hr style={layout.footerDivider} />
            <Text style={layout.footerBrand}>ISO — The Photographer Network</Text>
            <Text style={layout.footerText}>
              Built with care by Penny & Jordan Lamoreaux
            </Text>
            {unsubscribeUrl && (
              <Text style={layout.footerText}>
                <Link href={unsubscribeUrl} style={layout.unsubscribeLink}>
                  Unsubscribe
                </Link>{" "}
                or{" "}
                <Link href={unsubscribeUrl} style={layout.unsubscribeLink}>
                  manage email preferences
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
