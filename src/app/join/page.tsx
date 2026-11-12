"use client";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconCheck,
  IconMail,
  IconTicket,
} from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { type FormEvent, Suspense, useState } from "react";

import { DEFAULT_SIGNED_IN_PATH } from "~/_utils/callbackUrl";
import { NETWORK_ERROR_MESSAGE, trpcErrorCode, userFacingError } from "~/_utils/userError";
import { OtpCodeStep } from "~/app/_components/auth/OtpCodeStep";
import LegalConsentNote from "~/app/_components/legal/LegalConsentNote";
import { api } from "~/trpc/react";

import logo from "../../../public/img/logo.webp";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGN_UP_FALLBACK = "We couldn't start your sign-up. Please try again.";
// The server answers the same for a code that does not exist and one whose
// invites are all used (so codes cannot be probed); the copy covers both.
const CODE_NOT_USABLE =
  "That code isn't valid, or all of its invites have been used. Check it for typos, or ask the person who invited you for a new code.";
const INVITE_GONE =
  "This invite is no longer available: its last spot was taken, or the code was replaced, while you were signing up. Ask the person who invited you for a new code, or request an invite below.";

function JoinContent() {
  const searchParams = useSearchParams();
  const codeParam = searchParams.get("code") ?? "";
  const errorParam = searchParams.get("error");
  const waitlistApproved = searchParams.get("waitlist") === "approved";
  const waitlistEmail = searchParams.get("email") ?? "";

  const [code, setCode] = useState(codeParam);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<"google" | "email" | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState(false);

  const {
    data: validation,
    isFetching: isValidating,
    refetch: validateCode,
  } = api.invite.validate.useQuery(
    { code },
    { enabled: false, retry: false },
  );

  const { mutateAsync: prepareRegistration } = api.invite.prepareRegistration.useMutation();
  const { mutateAsync: requestOtp } = api.auth.requestMobileOtp.useMutation();

  const trimmedCode = code.trim();
  const trimmedEmail = email.trim();
  const isCodeValid = validation?.valid === true;

  const handleValidate = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedCode) {
      setCodeError("Enter your invite code");
      return;
    }
    setCodeError(null);
    const result = await validateCode();
    if (result.error) {
      setCodeError(userFacingError(result.error, "We couldn't check that code. Please try again."));
    } else if (!result.data?.valid) {
      setCodeError(CODE_NOT_USABLE);
    }
  };

  /** True when the code that was valid a moment ago no longer is. */
  const isInviteGone = async (): Promise<boolean> => {
    const result = await validateCode();
    return !result.error && result.data?.valid === false;
  };

  /** Message for a failed sign-up step: the invite ran out, or whatever the server said. */
  const describeSignUpFailure = async (error: unknown): Promise<string> => {
    if (trpcErrorCode(error) === "BAD_REQUEST" && (await isInviteGone())) {
      setOtpStep(false);
      setCodeError(INVITE_GONE);
      return INVITE_GONE;
    }
    return userFacingError(error, SIGN_UP_FALLBACK);
  };

  const validateEmail = () => {
    if (!trimmedEmail) {
      setEmailError("Enter your email address");
      return false;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError("Enter a valid email address, like you@example.com");
      return false;
    }
    setEmailError(null);
    return true;
  };

  const handleGoogleSignUp = async () => {
    if (!validateEmail()) return;
    setSignInError(null);
    setIsSigningIn("google");
    try {
      await prepareRegistration({ code: trimmedCode, email: trimmedEmail });
    } catch (error) {
      setSignInError(await describeSignUpFailure(error));
      setIsSigningIn(null);
      return;
    }
    try {
      // On success the browser leaves for Google, so loading stays on.
      await signIn("google", { callbackUrl: DEFAULT_SIGNED_IN_PATH });
    } catch {
      setSignInError(NETWORK_ERROR_MESSAGE);
      setIsSigningIn(null);
    }
  };

  /** Registers the invite for this email and emails a code. Resolves to an error message or null. */
  const sendCode = async (): Promise<string | null> => {
    try {
      await prepareRegistration({ code: trimmedCode, email: trimmedEmail });
      await requestOtp({ email: trimmedEmail });
      return null;
    } catch (error) {
      return describeSignUpFailure(error);
    }
  };

  const handleEmailSignUp = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateEmail()) return;
    setSignInError(null);
    setIsSigningIn("email");
    const failure = await sendCode();
    setIsSigningIn(null);
    if (failure) {
      setSignInError(failure);
      return;
    }
    setOtpStep(true);
  };

  // Waitlist-approved users: simplified flow — just sign in with Google
  const handleWaitlistGoogleSignIn = async () => {
    setSignInError(null);
    setIsSigningIn("google");
    try {
      await signIn("google", { callbackUrl: DEFAULT_SIGNED_IN_PATH });
    } catch {
      setSignInError(NETWORK_ERROR_MESSAGE);
      setIsSigningIn(null);
    }
  };

  const signInAlert = (
    // Always rendered so screen readers announce errors as they appear.
    <div role="alert">
      {signInError && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="join-error">
          {signInError}
        </Alert>
      )}
    </div>
  );

  return (
    <Box maw={420} w="100%" mx="auto">
      <Stack align="center" mb="xl">
        <Image
          priority
          src={logo}
          alt=""
          style={{ height: "4rem", width: "auto" }}
          width={100}
          height={100}
        />
        <Title order={1} size="h2" ta="center">
          Join ISO
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          The invite-only photographer network
        </Text>
      </Stack>

      {errorParam === "invite_required" && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          mb="md"
          title="Invite required"
        >
          You need a valid invite code to create an account. Enter your code
          below, or request an invite.
        </Alert>
      )}

      {waitlistApproved ? (
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="md">
            <Alert color="teal" icon={<IconCheck size={16} />} w="100%">
              Your waitlist application has been approved!
            </Alert>
            <Text size="sm" c="dimmed" ta="center">
              {waitlistEmail
                ? `Sign in with the Google account that matches ${waitlistEmail}`
                : "Sign in with the Google account that matches the email you applied with."}
            </Text>
            {signInAlert}
            <Button
              leftSection={<IconBrandGoogle size={20} />}
              onClick={() => void handleWaitlistGoogleSignIn()}
              loading={isSigningIn === "google"}
              size="md"
              fullWidth
            >
              Sign up with Google
            </Button>
          </Stack>
        </Paper>
      ) : (
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack>
            <Group gap="xs">
              <IconTicket size={20} color="var(--mantine-color-orange-6)" aria-hidden />
              <Title order={2} size="h5">I have an invite code</Title>
            </Group>

            <form onSubmit={(event) => void handleValidate(event)} noValidate>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <TextInput
                  label="Invite code"
                  placeholder="ISO-PENNY-7X2KQ9AB"
                  name="invite-code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => {
                    setCode(e.currentTarget.value);
                    setCodeError(null);
                  }}
                  error={codeError}
                  readOnly={otpStep}
                  required
                  style={{ flex: 1 }}
                />
                {/* Offset by the label height so the button lines up with the input. */}
                <Button type="submit" loading={isValidating} variant="light" mt={25} disabled={otpStep}>
                  Validate
                </Button>
              </Group>
            </form>

            {isCodeValid && !codeError && (
              <>
                <Alert color="teal" icon={<IconCheck size={16} />} role="status">
                  Invited by {validation.inviterName}
                </Alert>

                {otpStep ? (
                  <OtpCodeStep
                    email={trimmedEmail}
                    destination={DEFAULT_SIGNED_IN_PATH}
                    onResend={sendCode}
                    onChangeEmail={() => {
                      setOtpStep(false);
                      setSignInError(null);
                    }}
                    // A correct code is also refused when the invite filled
                    // up after it was validated: say that, not "wrong code".
                    explainRejection={async () => {
                      if (!(await isInviteGone())) return null;
                      setOtpStep(false);
                      setCodeError(INVITE_GONE);
                      return INVITE_GONE;
                    }}
                  />
                ) : (
                  <form onSubmit={(event) => void handleEmailSignUp(event)} noValidate>
                    <Stack>
                      <TextInput
                        label="Your email"
                        placeholder="you@example.com"
                        type="email"
                        name="email"
                        autoComplete="email"
                        inputMode="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        value={email}
                        onChange={(e) => {
                          setEmail(e.currentTarget.value);
                          setEmailError(null);
                        }}
                        error={emailError}
                      />

                      {signInAlert}

                      <Stack gap="xs">
                        <Button
                          type="submit"
                          leftSection={<IconMail size={20} />}
                          loading={isSigningIn === "email"}
                          disabled={isSigningIn === "google"}
                          size="md"
                          fullWidth
                        >
                          Email me a sign-in code
                        </Button>
                        <Divider label="or" labelPosition="center" />
                        <Button
                          variant="default"
                          leftSection={<IconBrandGoogle size={20} />}
                          onClick={() => void handleGoogleSignUp()}
                          loading={isSigningIn === "google"}
                          disabled={isSigningIn === "email"}
                          size="md"
                          fullWidth
                        >
                          Sign up with Google
                        </Button>
                      </Stack>
                    </Stack>
                  </form>
                )}
              </>
            )}

            <Divider label="or" labelPosition="center" />

            <Anchor component={Link} href="/waitlist" ta="center" fw={600}>
              Request an invite
            </Anchor>
          </Stack>
        </Paper>
      )}
      <LegalConsentNote />

      <Text ta="center" mt="md" size="sm">
        Already have an account?{" "}
        <Anchor component={Link} href="/login" fw={600} underline="always">
          Sign in
        </Anchor>
      </Text>
    </Box>
  );
}

export default function Page() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  );
}
