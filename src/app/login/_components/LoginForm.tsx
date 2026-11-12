"use client";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle, IconBrandGoogle, IconLock, IconMail } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { NETWORK_ERROR_MESSAGE, userFacingError } from "~/_utils/userError";
import { OtpCodeStep } from "~/app/_components/auth/OtpCodeStep";
import { api } from "~/trpc/react";

import logo from "../../../../public/img/logo.webp";

type LoginFormProps = {
  /** Same-origin relative URL to land on after signing in. */
  callbackUrl: string;
  /** True when the visitor was sent here from a page that needs a session. */
  signInRequired: boolean;
  /** Auth.js error code from a failed provider round-trip, if any. */
  authError?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function describeAuthError(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "That account doesn't have access to ISO yet. Join with an invite code first.";
    case "OAuthAccountNotLinked":
      return "That email is already registered with a different sign-in method. Use the method you signed up with.";
    default:
      return "We couldn't sign you in. Please try again.";
  }
}

export default function LoginForm({ callbackUrl, signInRequired, authError }: LoginFormProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    authError ? describeAuthError(authError) : null,
  );

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: (value: string) => {
        if (!value.trim()) return "Enter your email address";
        if (!EMAIL_PATTERN.test(value.trim())) return "Enter a valid email address, like you@example.com";
        return null;
      },
    },
  });
  const email = form.values.email.trim();

  const requestOtp = api.auth.requestMobileOtp.useMutation();

  const handleGoogleSignIn = async () => {
    setFormError(null);
    setIsGoogleLoading(true);
    try {
      // On success the browser leaves for Google, so loading stays on.
      await signIn("google", { callbackUrl });
    } catch {
      setFormError(NETWORK_ERROR_MESSAGE);
      setIsGoogleLoading(false);
    }
  };

  const sendCode = async (): Promise<string | null> => {
    try {
      await requestOtp.mutateAsync({ email });
      return null;
    } catch (error) {
      return userFacingError(error, "We couldn't send your code. Please try again.");
    }
  };

  const handleRequestOtp = form.onSubmit(async () => {
    setFormError(null);
    const failure = await sendCode();
    if (failure) {
      setFormError(failure);
      return;
    }
    setStep("code");
  });

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
          Welcome back
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Sign in to your ISO account
        </Text>
      </Stack>

      {signInRequired && (
        <Alert icon={<IconLock size={16} />} color="blue" mb="md" title="Sign in to continue">
          You need to be signed in to see that page. We&apos;ll take you straight
          there afterwards.
        </Alert>
      )}

      <Paper withBorder shadow="md" p="xl" radius="md">
        <Stack>
          {/* Always rendered so screen readers announce errors as they appear. */}
          <div role="alert" aria-live="assertive">
            {formError && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" data-testid="login-error">
                {formError}
              </Alert>
            )}
          </div>

          {step === "code" ? (
            <OtpCodeStep
              email={email}
              destination={callbackUrl}
              onResend={sendCode}
              onChangeEmail={() => {
                setStep("email");
                setFormError(null);
              }}
            />
          ) : (
            <>
              <Button
                size="md"
                variant="default"
                leftSection={<IconBrandGoogle size={20} />}
                onClick={() => void handleGoogleSignIn()}
                loading={isGoogleLoading}
                disabled={requestOtp.isPending}
                fullWidth
              >
                Sign in with Google
              </Button>

              <Divider label="or continue with email" labelPosition="center" />

              <form onSubmit={handleRequestOtp} noValidate>
                <Stack>
                  <TextInput
                    label="Email"
                    placeholder="you@example.com"
                    size="md"
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    {...form.getInputProps("email")}
                  />
                  <Button
                    type="submit"
                    size="md"
                    leftSection={<IconMail size={20} />}
                    loading={requestOtp.isPending}
                    disabled={isGoogleLoading}
                    fullWidth
                  >
                    Send sign-in code
                  </Button>
                </Stack>
              </form>
            </>
          )}
        </Stack>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Don&apos;t have an account?{" "}
        <Anchor component={Link} href="/join" fw={600} underline="always">
          Join
        </Anchor>
      </Text>
    </Box>
  );
}
