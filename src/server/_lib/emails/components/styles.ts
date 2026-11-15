import type * as React from "react";

/**
 * The email palette: the app's brand colours (src/app/theme/colors.ts).
 * Emails are light only. The salmon is a fill with near-black text on it,
 * as on the app's primary buttons; coloured text on white uses the darker
 * ink of the same hue. Every text colour is checked against the background
 * it sits on in styles.test.ts (WCAG AA, 4.5:1).
 */
export const colors = {
  /** Brand salmon: the main action's fill, and decoration. Never text on white. */
  brand: "#e98f7b",
  /** Salmon ink: links and accents on white and on `brandTint`. */
  brandInk: "#8f3016",
  /** Callout background. */
  brandTint: "#ffede9",
  /** Sand, for Pro: decoration only. */
  pro: "#e9bd7b",
  /** Sand ink: Pro accents as text. */
  proInk: "#7a4e05",
  /** Pro callout background. */
  proTint: "#fff5e4",
  /** Body text and headings, and the text on a salmon fill. */
  ink: "#1b1c1f",
  /** Secondary text: signatures, small print, the footer. */
  muted: "#5f6268",
  /** Dividers. */
  border: "#e1e3e6",
  /** Around the white card. */
  page: "#eef0f2",
  white: "#ffffff",
} as const;

export const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: "700",
  color: colors.ink,
  lineHeight: "32px",
  margin: "0 0 16px",
};

export const paragraph: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "26px",
  color: colors.ink,
  margin: "0 0 16px",
};

export const ctaButton: React.CSSProperties = {
  backgroundColor: colors.brand,
  borderRadius: "8px",
  color: colors.ink,
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "600",
  lineHeight: "100%",
  padding: "14px 28px",
  textDecoration: "none",
  textAlign: "center" as const,
};

export const secondaryButton: React.CSSProperties = {
  backgroundColor: colors.white,
  border: `2px solid ${colors.brandInk}`,
  borderRadius: "8px",
  color: colors.brandInk,
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "600",
  lineHeight: "100%",
  padding: "12px 26px",
  textDecoration: "none",
  textAlign: "center" as const,
};

export const signature: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "26px",
  color: colors.muted,
  fontStyle: "italic",
  margin: "24px 0 0",
};

export const calloutBox: React.CSSProperties = {
  backgroundColor: colors.brandTint,
  borderRadius: "8px",
  padding: "20px 24px",
  margin: "24px 0",
};

/** A callout about ISO Pro: sand instead of salmon. */
export const proCalloutBox: React.CSSProperties = {
  ...calloutBox,
  backgroundColor: colors.proTint,
  borderLeft: `4px solid ${colors.pro}`,
};

export const calloutText: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: colors.ink,
  margin: "0",
};

export const smallText: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "20px",
  color: colors.muted,
  margin: "0 0 8px",
};

export const linkStyle: React.CSSProperties = {
  color: colors.brandInk,
  textDecoration: "underline",
};

export const ctaSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

/** A divider in the body of an email. */
export const divider: React.CSSProperties = {
  borderTop: `1px solid ${colors.border}`,
  margin: "24px 0",
};

/** The frame every email shares (Layout.tsx). */
export const layout = {
  body: {
    backgroundColor: colors.page,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    margin: "0",
    padding: "0",
  },
  container: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "20px 0",
  },
  header: {
    backgroundColor: colors.white,
    // A salmon band across the top of the card: the brand, as decoration.
    borderTop: `6px solid ${colors.brand}`,
    borderRadius: "8px 8px 0 0",
    padding: "28px 40px 24px",
    textAlign: "center" as const,
  },
  logo: {
    fontSize: "36px",
    fontWeight: "800",
    color: colors.brandInk,
    letterSpacing: "-1px",
    margin: "0",
    padding: "0",
  },
  content: {
    backgroundColor: colors.white,
    padding: "0 40px 32px",
  },
  footer: {
    backgroundColor: colors.white,
    borderRadius: "0 0 8px 8px",
    padding: "0 40px 32px",
  },
  // `borderTop`, not `borderColor`: Hr draws its line with its own borderTop
  // (#eaeaea), which a separate colour would not reliably replace.
  footerDivider: {
    borderTop: `1px solid ${colors.border}`,
    margin: "0 0 24px",
  },
  footerBrand: {
    fontSize: "14px",
    fontWeight: "600",
    color: colors.muted,
    textAlign: "center" as const,
    margin: "0 0 4px",
  },
  footerText: {
    fontSize: "12px",
    color: colors.muted,
    textAlign: "center" as const,
    margin: "0 0 4px",
    lineHeight: "20px",
  },
  unsubscribeLink: {
    color: colors.muted,
    textDecoration: "underline",
  },
} satisfies Record<string, React.CSSProperties>;
