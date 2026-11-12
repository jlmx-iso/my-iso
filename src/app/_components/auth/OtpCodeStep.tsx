"use client";

import { Button, Group, PinInput, Stack, Text } from "@mantine/core";
import { IconMail } from "@tabler/icons-react";
import { signIn } from "next-auth/react";
import { useEffect, useId, useState } from "react";

import { NETWORK_ERROR_MESSAGE } from "~/_utils/userError";
import { useCooldown } from "~/app/_hooks/useCooldown";

export const OTP_LENGTH = 6;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

type OtpCodeStepProps = {
  email: string;
  /** Where to go once signed in (same-origin path). */
  destination: string;
  /** Requests a fresh code; resolves to an error message, or null on success. */
  onResend: () => Promise<string | null>;
  onChangeEmail: () => void;
};

/**
 * Exchanges an emailed one-time code for a session.
 * Resolves to an error message for the user, or null when signed in.
 */
async function verifyCode(email: string, code: string): Promise<string | null> {
  try {
    const result = await signIn("otp", { code, email, redirect: false });
    if (result?.ok && !result.error) return null;
    if (result?.error === "CredentialsSignin") {
      return "That code is incorrect or has expired. Check it and try again, or request a new one.";
    }
    return "We couldn't sign you in. Please try again.";
  } catch {
    // signIn() only throws when the request itself fails.
    return NETWORK_ERROR_MESSAGE;
  }
}

/** Second step of email sign-in: enter the emailed code, or ask for another. */
export function OtpCodeStep({ email, destination, onResend, onChangeEmail }: OtpCodeStepProps) {
  const labelId = useId();
  const statusId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { remaining, start } = useCooldown(OTP_RESEND_COOLDOWN_SECONDS);

  // The first code was sent just before this step rendered.
  useEffect(() => {
    start();
  }, [start]);

  const verify = async (value: string) => {
    if (value.length !== OTP_LENGTH || isVerifying) return;
    setError(null);
    setNotice(null);
    setIsVerifying(true);
    const failure = await verifyCode(email, value);
    if (failure === null) {
      // Full page load (not router.push) so the server-rendered layout picks
      // up the session cookie that signIn() just set.
      window.location.assign(destination);
      return;
    }
    setIsVerifying(false);
    setCode("");
    setError(failure);
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    setIsResending(true);
    const failure = await onResend();
    setIsResending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setCode("");
    setNotice("A new code is on its way. Earlier codes no longer work.");
    start();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
      noValidate
    >
      <Stack align="center" gap="sm">
        <IconMail size={40} color="var(--mantine-color-orange-6)" aria-hidden />
        <Text id={labelId} fw={600} ta="center">
          Enter your code
        </Text>
        <Text c="dimmed" size="sm" ta="center">
          We sent a 6-digit code to{" "}
          <Text span fw={600} c="var(--mantine-color-text)" style={{ wordBreak: "break-all" }}>
            {email}
          </Text>
          . It expires in 10 minutes.
        </Text>
        <Group role="group" aria-labelledby={labelId} aria-describedby={statusId} justify="center">
          <PinInput
            length={OTP_LENGTH}
            type="number"
            inputMode="numeric"
            oneTimeCode
            size="md"
            value={code}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            disabled={isVerifying}
            error={!!error}
            ariaLabel="Digit of your 6-digit sign-in code"
            autoFocus
          />
        </Group>
        {/* Always rendered so screen readers announce changes to it. */}
        <div id={statusId} role="status" aria-live="polite" style={{ minHeight: 20 }}>
          {error ? (
            <Text c="red" size="sm" ta="center" data-testid="otp-error">
              {error}
            </Text>
          ) : notice ? (
            <Text c="teal.8" size="sm" ta="center">
              {notice}
            </Text>
          ) : isVerifying ? (
            <Text c="dimmed" size="sm" ta="center">
              Checking your code…
            </Text>
          ) : null}
        </div>
        <Button type="submit" fullWidth loading={isVerifying} disabled={code.length !== OTP_LENGTH}>
          Verify and sign in
        </Button>
        <Group gap="xs" justify="center">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void resend()}
            loading={isResending}
            disabled={remaining > 0 || isVerifying}
          >
            {remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
          </Button>
          <Button variant="subtle" color="gray" size="sm" onClick={onChangeEmail} disabled={isVerifying}>
            Use a different email
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
