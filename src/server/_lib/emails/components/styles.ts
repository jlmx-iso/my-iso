import type * as React from "react";

export const colors = {
  orange: "#F97316",
  orangeLight: "#FFF7ED",
  orangeDark: "#EA580C",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray600: "#4B5563",
  gray700: "#374151",
  gray900: "#111827",
  white: "#FFFFFF",
  yellow400: "#FACC15",
};

export const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: "700",
  color: colors.gray900,
  lineHeight: "32px",
  margin: "0 0 16px",
};

export const paragraph: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "26px",
  color: colors.gray700,
  margin: "0 0 16px",
};

export const ctaButton: React.CSSProperties = {
  backgroundColor: colors.orange,
  borderRadius: "8px",
  color: colors.white,
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
  border: `2px solid ${colors.orange}`,
  borderRadius: "8px",
  color: colors.orange,
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
  color: colors.gray500,
  fontStyle: "italic",
  margin: "24px 0 0",
};

export const calloutBox: React.CSSProperties = {
  backgroundColor: colors.orangeLight,
  borderRadius: "8px",
  padding: "20px 24px",
  margin: "24px 0",
};

export const calloutText: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: colors.gray700,
  margin: "0",
};

export const smallText: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "20px",
  color: colors.gray500,
  margin: "0 0 8px",
};

export const linkStyle: React.CSSProperties = {
  color: colors.orange,
  textDecoration: "underline",
};

export const ctaSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};
