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
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

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
    setIsSigningIn(true);
    try {
      await prepareRegistration({ code: code.trim(), email: email.trim() });
      await signIn("google", { callbackUrl: "/app/events" });
    } catch (err) {
      setIsSigningIn(false);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setSignInError(message);
    }
  };

  // Waitlist-approved users: simplified flow — just sign in with Google
  const handleWaitlistGoogleSignIn = async () => {
    setIsSigningIn(true);
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
              loading={isSigningIn}
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
                  description="Use the same email as your Google account"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />

                {signInError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />}>
                    {signInError}
                  </Alert>
                )}

                <Button
                  leftSection={<IconBrandGoogle size={20} />}
                  onClick={handleGoogleSignIn}
                  loading={isSigningIn || isPreparing}
                  disabled={!email.trim()}
                  size="md"
                  fullWidth
                >
                  Sign up with Google
                </Button>
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
