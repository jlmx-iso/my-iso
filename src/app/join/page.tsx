"use client";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  PinInput,
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
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import logo from "../../../public/img/logo.webp";
import { api } from "~/trpc/react";

function JoinContent() {
  const searchParams = useSearchParams();
  const codeParam = searchParams.get("code") ?? "";
  const errorParam = searchParams.get("error");
  const waitlistApproved = searchParams.get("waitlist") === "approved";
  const waitlistEmail = searchParams.get("email") ?? "";

  const [code, setCode] = useState(codeParam);
  const [email, setEmail] = useState("");
  const [isSigningIn, setIsSigningIn] = useState<"google" | "email" | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const {
    data: validation,
    isFetching: isValidating,
    refetch: validateCode,
  } = api.invite.validate.useQuery(
    { code },
    { enabled: false },
  );

  const { mutateAsync: prepareRegistration, isPending: isPreparing } =
    api.invite.prepareRegistration.useMutation();

  const handleValidate = async () => {
    if (!code.trim()) return;
    await validateCode();
  };

  const handleGoogleSignIn = async () => {
    if (!email.trim()) return;
    setSignInError(null);
    setIsSigningIn("google");
    try {
      await prepareRegistration({ code: code.trim(), email: email.trim() });
      await signIn("google", { callbackUrl: "/app/events" });
    } catch (err) {
      setIsSigningIn(null);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setSignInError(message);
    }
  };

  const requestOtp = api.auth.requestMobileOtp.useMutation({
    onSuccess: () => {
      setOtpStep(true);
      setIsSigningIn(null);
    },
    onError: (err) => {
      setSignInError(err.message);
      setIsSigningIn(null);
    },
  });

  const handleEmailSignIn = async () => {
    if (!email.trim()) return;
    setSignInError(null);
    setIsSigningIn("email");
    try {
      await prepareRegistration({ code: code.trim(), email: email.trim() });
      requestOtp.mutate({ email: email.trim() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setSignInError(message);
      setIsSigningIn(null);
    }
  };

  const handleVerifyOtp = async (otpCode: string) => {
    setOtpError(null);
    const result = await signIn("otp", {
      email: email.trim(),
      code: otpCode,
      redirect: false,
    });
    if (result?.ok) {
      window.location.href = "/app/events";
    } else {
      setOtpError("Invalid or expired code.");
    }
  };

  // Waitlist-approved users: simplified flow — just sign in with Google
  const handleWaitlistGoogleSignIn = async () => {
    setIsSigningIn("google");
    await signIn("google", { callbackUrl: "/app/events" });
  };

  const isCodeValid = validation?.valid === true;

  return (
    <Box maw={420} w="100%" mx="auto">
      <Stack align="center" mb="xl">
        <Image
          priority
          src={logo}
          alt="ISO logo"
          style={{ height: "4rem", width: "auto" }}
          width={100}
          height={100}
        />
        <Title order={2} ta="center">
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
            <Button
              leftSection={<IconBrandGoogle size={20} />}
              onClick={handleWaitlistGoogleSignIn}
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
              <IconTicket size={20} color="var(--mantine-color-orange-5)" />
              <Text fw={600}>I have an invite code</Text>
            </Group>

            <Group align="flex-end" gap="xs">
              <TextInput
                label="Invite code"
                placeholder="ISO-PENNY-7X2K"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                onClick={handleValidate}
                loading={isValidating}
                variant="light"
                disabled={!code.trim()}
              >
                Validate
              </Button>
            </Group>

            {validation && !isCodeValid && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                Invalid or expired invite code.
              </Alert>
            )}

            {isCodeValid && (
              <>
                <Alert color="teal" icon={<IconCheck size={16} />}>
                  Invited by {validation.inviterName}
                </Alert>

                <TextInput
                  label="Your email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.currentTarget.value);
                    setOtpStep(false);
                  }}
                />

                {signInError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />}>
                    {signInError}
                  </Alert>
                )}

                {otpStep ? (
                  <Stack align="center" gap="sm">
                    <IconMail size={40} color="var(--mantine-color-orange-5)" />
                    <Text fw={500} ta="center">Enter your code</Text>
                    <Text c="dimmed" size="sm" ta="center">
                      We sent a 6-digit code to{" "}
                      <Text span fw={500}>{email}</Text>
                    </Text>
                    <PinInput
                      length={6}
                      type="number"
                      size="md"
                      onComplete={handleVerifyOtp}
                    />
                    {otpError && (
                      <Text c="red" size="sm" ta="center">
                        {otpError}
                      </Text>
                    )}
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => {
                        setOtpStep(false);
                        setOtpError(null);
                      }}
                    >
                      Use a different email
                    </Button>
                  </Stack>
                ) : (
                  <Stack gap="xs">
                    <Button
                      leftSection={<IconBrandGoogle size={20} />}
                      onClick={handleGoogleSignIn}
                      loading={isSigningIn === "google" || isPreparing}
                      disabled={!email.trim() || !!isSigningIn}
                      size="md"
                      fullWidth
                    >
                      Sign up with Google
                    </Button>
                    <Divider label="or" labelPosition="center" />
                    <Button
                      variant="light"
                      leftSection={<IconMail size={20} />}
                      onClick={handleEmailSignIn}
                      loading={isSigningIn === "email" || requestOtp.isPending}
                      disabled={!email.trim() || !!isSigningIn}
                      size="md"
                      fullWidth
                    >
                      Send sign-in code
                    </Button>
                  </Stack>
                )}
              </>
            )}

            <Divider label="or" labelPosition="center" />

            <Anchor component={Link} href="/waitlist" ta="center" fw={500}>
              Request an invite
            </Anchor>
          </Stack>
        </Paper>
      )}

      <Text ta="center" mt="md" size="sm">
        Already have an account?{" "}
        <Anchor component={Link} href="/login" fw={500}>
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
