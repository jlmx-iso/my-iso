"use client";
import {
  Anchor,
  Box,
  Button,
  Divider,
  Paper,
  PinInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconBrandGoogle, IconMail } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import logo from "../../../public/img/logo.webp";
import { api } from "~/trpc/react";

export default function Page() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [isLoading, setIsLoading] = useState<"google" | "email" | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const form = useForm({
    initialValues: { email: "" },
    validate: {
      email: (value: string) => {
        if (!value) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
        return null;
      },
    },
  });

  const requestOtp = api.auth.requestMobileOtp.useMutation({
    onSuccess: () => {
      setStep("code");
      setIsLoading(null);
    },
    onError: (err) => {
      setOtpError(err.message);
      setIsLoading(null);
    },
  });

  const handleGoogleSignIn = async () => {
    setIsLoading("google");
    await signIn("google", { callbackUrl: "/app/events" });
  };

  const handleRequestOtp = () => {
    if (form.validate().hasErrors) return;
    setOtpError(null);
    setIsLoading("email");
    requestOtp.mutate({ email: form.values.email });
  };

  const handleVerifyOtp = async (code: string) => {
    setOtpError(null);
    setIsVerifying(true);
    const result = await signIn("otp", {
      email: form.values.email,
      code,
      redirect: false,
    });
    setIsVerifying(false);
    if (result?.ok) {
      window.location.href = "/app/events";
    } else {
      setOtpError("Invalid or expired code.");
    }
  };

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
          Welcome back
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Sign in to your ISO account
        </Text>
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <Stack>
          <Button
            size="md"
            variant="default"
            leftSection={<IconBrandGoogle size={20} />}
            onClick={handleGoogleSignIn}
            loading={isLoading === "google"}
            fullWidth
          >
            Sign in with Google
          </Button>

          <Divider label="or continue with email" labelPosition="center" />

          {step === "code" ? (
            <Stack align="center" gap="sm">
              <IconMail size={40} color="var(--mantine-color-orange-5)" />
              <Text fw={500} ta="center">
                Enter your code
              </Text>
              <Text c="dimmed" size="sm" ta="center">
                We sent a 6-digit code to{" "}
                <Text span fw={500}>
                  {form.values.email}
                </Text>
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
                  setStep("email");
                  setOtpError(null);
                }}
              >
                Use a different email
              </Button>
            </Stack>
          ) : (
            <>
              <TextInput
                label="Email"
                placeholder="you@example.com"
                size="md"
                {...form.getInputProps("email")}
              />
              {otpError && (
                <Text c="red" size="sm">
                  {otpError}
                </Text>
              )}
              <Button
                size="md"
                variant="light"
                leftSection={<IconMail size={20} />}
                onClick={handleRequestOtp}
                loading={requestOtp.isPending}
                fullWidth
              >
                Send sign-in code
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Don&apos;t have an account?{" "}
        <Anchor component={Link} href="/join" fw={500}>
          Join
        </Anchor>
      </Text>
    </Box>
  );
}
