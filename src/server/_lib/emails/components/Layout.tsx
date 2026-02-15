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
} from "@react-email/components";
import type * as React from "react";

type LayoutProps = {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl?: string;
};

const colors = {
  orange: "#F97316",
  orangeLight: "#FFF7ED",
  gray100: "#F3F4F6",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray700: "#374151",
  gray900: "#111827",
  white: "#FFFFFF",
};

export function Layout({ preview, children, unsubscribeUrl }: LayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logo}>ISO</Text>
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            <Hr style={divider} />
            <Text style={footerBrand}>ISO — The Photographer Network</Text>
            <Text style={footerText}>
              Built with care by Penny & Jordan Lamoreaux
            </Text>
            {unsubscribeUrl && (
              <Text style={footerText}>
                <Link href={unsubscribeUrl} style={unsubscribeLink}>
                  Unsubscribe
                </Link>{" "}
                or{" "}
                <Link href={unsubscribeUrl} style={unsubscribeLink}>
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

const body: React.CSSProperties = {
  backgroundColor: colors.gray100,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: "0",
  padding: "0",
};

const container: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "20px 0",
};

const header: React.CSSProperties = {
  backgroundColor: colors.white,
  borderRadius: "8px 8px 0 0",
  padding: "32px 40px 24px",
  textAlign: "center" as const,
};

const logo: React.CSSProperties = {
  fontSize: "36px",
  fontWeight: "800",
  color: colors.orange,
  letterSpacing: "-1px",
  margin: "0",
  padding: "0",
};

const content: React.CSSProperties = {
  backgroundColor: colors.white,
  padding: "0 40px 32px",
};

const footer: React.CSSProperties = {
  backgroundColor: colors.white,
  borderRadius: "0 0 8px 8px",
  padding: "0 40px 32px",
};

const divider: React.CSSProperties = {
  borderColor: colors.gray100,
  borderWidth: "1px",
  margin: "0 0 24px",
};

const footerBrand: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: "600",
  color: colors.gray500,
  textAlign: "center" as const,
  margin: "0 0 4px",
};

const footerText: React.CSSProperties = {
  fontSize: "12px",
  color: colors.gray400,
  textAlign: "center" as const,
  margin: "0 0 4px",
  lineHeight: "20px",
};

const unsubscribeLink: React.CSSProperties = {
  color: colors.gray400,
  textDecoration: "underline",
};
