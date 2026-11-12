"use client";

import { Anchor, Button } from "@mantine/core";

import { openPrivacyChoices } from "./privacyChoices";

/**
 * "Privacy choices": reopens the consent preferences. A button (it opens a
 * dialog, it goes nowhere), styled as a footer link or a Settings button.
 */
export default function PrivacyChoicesLink({ variant = "link", size = "sm" }: {
  size?: "xs" | "sm";
  variant?: "link" | "button";
}) {
  if (variant === "button") {
    return (
      <Button variant="default" onClick={openPrivacyChoices}>
        Privacy choices
      </Button>
    );
  }
  return (
    <Anchor component="button" type="button" size={size} c="dimmed" underline="hover" w="fit-content" ta="left" onClick={openPrivacyChoices}>
      Privacy choices
    </Anchor>
  );
}
