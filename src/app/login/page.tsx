"use client";
import {
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
import { IconBrandGoogle, IconMail } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import logo from "../../../public/img/logo.webp";

export default function Page() {
  const [emailSent, setEmailSent] = useState(false);
  const [isLoading, setIsLoading] = useState<"google" | "email" | null>(null);

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

  const handleGoogleSignIn = async () => {
    setIsLoading("google");
    await signIn("google", { callbackUrl: "/app/events" });
  };

  const handleEmailSignIn = async () => {
    if (form.validate().hasErrors) return;
    setIsLoading("email");
    const result = await signIn("resend", {
      email: form.values.email,
      redirect: false,
    });
    if (result?.ok) {
      setEmailSent(true);
    }
    setIsLoading(null);
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

          {emailSent ? (
            <Stack align="center" gap="xs">
              <IconMail size={40} color="var(--mantine-color-orange-5)" />
              <Text fw={500} ta="center">
                Check your email
              </Text>
              <Text c="dimmed" size="sm" ta="center">
                We sent a magic link to{" "}
                <Text span fw={500}>
                  {form.values.email}
                </Text>
              </Text>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setEmailSent(false)}
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
              <Button
                size="md"
                variant="light"
                leftSection={<IconMail size={20} />}
                onClick={handleEmailSignIn}
                loading={isLoading === "email"}
                fullWidth
              >
                Send magic link
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Don&apos;t have an account?{" "}
        <Anchor component={Link} href="/register" fw={500}>
          Register
        </Anchor>
      </Text>
    </Box>
  );
}
