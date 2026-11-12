"use client";

import { Button, Group, PinInput, Stack, Text } from "@mantine/core";
import { IconMail, IconRefresh } from "@tabler/icons-react";
import { signIn } from "next-auth/react";
import { useEffect, useId, useState } from "react";

import { OTP_TTL_MINUTES } from "~/_utils/limits";
import { type OtpOutcome, interpretOtpSignIn, otpOutcomeMessage } from "~/_utils/otp";
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
  /**
   * Called when a code is refused, for a reason only the caller can find out
   * (on /join: the invite ran out meanwhile). Resolves to a message that
   * replaces the usual "wrong code" one, or null.
   */
  explainRejection?: () => Promise<string | null>;
};

/**
 * Exchanges an emailed one-time code for a session. Resolves to what
 * happened, or to "network" when the request itself failed.
 */
async function verifyCode(email: string, code: string, wrongAttempts: number): Promise<OtpOutcome | "network"> {
  try {
    return interpretOtpSignIn(await signIn("otp", { code, email, redirect: false }), wrongAttempts);
  } catch {
    // signIn() only throws when the request itself fails.
    return "network";
  }
}

/** Second step of email sign-in: enter the emailed code, or ask for another. */
export function OtpCodeStep({ email, destination, onResend, onChangeEmail, explainRejection }: OtpCodeStepProps) {
  const labelId = useId();
  const statusId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  // Wrong codes entered since the last code was sent: a code stops working
  // after OTP_MAX_ATTEMPTS of them, and only a new code helps then.
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const { remaining, start } = useCooldown(OTP_RESEND_COOLDOWN_SECONDS);

  // The first code was sent just before this step rendered.
  useEffect(() => {
    start();
  }, [start]);

  const verify = async (value: string) => {
    if (value.length !== OTP_LENGTH || isVerifying || isLocked) return;
    setError(null);
    setNotice(null);
    setIsVerifying(true);
    const outcome = await verifyCode(email, value, wrongAttempts);
    if (outcome !== "network" && outcome.kind === "signed_in") {
      // Full page load (not router.push) so the server-rendered layout picks
      // up the session cookie that signIn() just set.
      window.location.assign(destination);
      return;
    }
    const explanation =
      outcome !== "network" && (outcome.kind === "wrong_code" || outcome.kind === "locked")
        ? await explainRejection?.().catch(() => null)
        : null;
    setIsVerifying(false);
    setCode("");
    if (explanation) {
      setError(explanation);
      return;
    }
    if (outcome === "network") {
      setError(NETWORK_ERROR_MESSAGE);
      return;
    }
    if (outcome.kind === "wrong_code") setWrongAttempts((count) => count + 1);
    if (outcome.kind === "locked") setIsLocked(true);
    setError(otpOutcomeMessage(outcome));
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
    setWrongAttempts(0);
    setIsLocked(false);
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
          . It expires in {OTP_TTL_MINUTES} minutes.
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
            disabled={isVerifying || isLocked}
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
        {isLocked ? (
          // The code is dead: sending a new one is the only way forward.
          <Button
            fullWidth
            leftSection={<IconRefresh size={18} />}
            onClick={() => void resend()}
            loading={isResending}
            disabled={remaining > 0}
            data-testid="otp-send-new"
          >
            {remaining > 0 ? `Send a new code in ${remaining}s` : "Send a new code"}
          </Button>
        ) : (
          <Button type="submit" fullWidth loading={isVerifying} disabled={code.length !== OTP_LENGTH}>
            Verify and sign in
          </Button>
        )}
        <Group gap="xs" justify="center">
          {!isLocked && (
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void resend()}
              loading={isResending}
              disabled={remaining > 0 || isVerifying}
              data-testid="otp-send-new"
            >
              {remaining > 0 ? `Send a new code in ${remaining}s` : "Send a new code"}
            </Button>
          )}
          <Button variant="subtle" color="gray" size="sm" onClick={onChangeEmail} disabled={isVerifying}>
            Use a different email
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
