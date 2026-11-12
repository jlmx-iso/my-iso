"use client";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconAlertCircle, IconCheck, IconClock } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { userFacingError, zodFieldErrors } from "~/_utils/userError";
import { api } from "~/trpc/react";

import logo from "../../../public/img/logo.webp";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/\S+\.\S+/i;

type UserType = "lead" | "second" | "both";

export default function Page() {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      instagram: "",
      website: "",
      userType: "both" as UserType,
      referralSource: "",
    },
    validate: {
      email: (v: string) => {
        if (!v.trim()) return "Enter your email address";
        if (!EMAIL_PATTERN.test(v.trim())) return "Enter a valid email address, like you@example.com";
        return null;
      },
      name: (v: string) => (v.trim().length > 0 ? null : "Enter your name"),
      website: (v: string) =>
        !v.trim() || URL_PATTERN.test(v.trim())
          ? null
          : "Enter the full address, starting with https://",
    },
  });

  const { mutate: apply, isPending } = api.waitlist.submit.useMutation({
    onError: (error) => {
      const fieldErrors = zodFieldErrors(error);
      if (Object.keys(fieldErrors).length > 0) {
        form.setErrors(fieldErrors);
        setSubmitError("Some details need another look. Check the highlighted fields.");
        return;
      }
      setSubmitError(userFacingError(error, "We couldn't add you to the waitlist. Please try again."));
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = form.onSubmit((values) => {
    setSubmitError(null);
    apply({
      name: values.name.trim(),
      email: values.email.trim(),
      instagram: values.instagram.trim() || undefined,
      website: values.website.trim() || undefined,
      userType: values.userType,
      referralSource: values.referralSource.trim() || undefined,
    });
  });

  if (submitted) {
    return (
      <Box maw={420} w="100%" mx="auto">
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="md" role="status">
            <ThemeIcon size={56} radius="xl" variant="light" color="teal">
              <IconCheck size={28} aria-hidden />
            </ThemeIcon>
            <Title order={1} size="h3" ta="center">
              You&apos;re on the list!
            </Title>
            <Text c="dimmed" ta="center">
              Check your inbox for a confirmation. We&apos;ll email your invite
              when a spot opens up.
            </Text>
            <Button component={Link} href="/" variant="subtle">
              Back to home
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

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
          Request an invite
        </Title>
        <Group gap={6} justify="center" wrap="nowrap" align="flex-start">
          <IconClock size={16} color="var(--mantine-color-gray-6)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <Text c="dimmed" size="sm">
            We&apos;re currently invite-only. Tell us about yourself.
          </Text>
        </Group>
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <form onSubmit={handleSubmit} noValidate>
          <Stack>
            {/* Always rendered so screen readers announce errors as they appear. */}
            <div role="alert">
              {submitError && (
                <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="waitlist-error">
                  {submitError}
                </Alert>
              )}
            </div>

            <TextInput
              label="Full name"
              placeholder="Jane Doe"
              name="name"
              autoComplete="name"
              required
              {...form.getInputProps("name")}
            />
            <TextInput
              label="Email"
              placeholder="you@example.com"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              {...form.getInputProps("email")}
            />
            <TextInput
              label="Instagram"
              description="Optional"
              placeholder="@yourhandle"
              name="instagram"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...form.getInputProps("instagram")}
            />
            <TextInput
              label="Website"
              description="Optional"
              placeholder="https://yoursite.com"
              type="url"
              name="website"
              autoComplete="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              {...form.getInputProps("website")}
            />
            <Select
              label="I'm looking to..."
              name="userType"
              allowDeselect={false}
              data={[
                { value: "lead", label: "Find second shooters (Lead)" },
                { value: "second", label: "Find gigs (Second shooter)" },
                { value: "both", label: "Both" },
              ]}
              {...form.getInputProps("userType")}
            />
            <TextInput
              label="How did you hear about ISO?"
              description="Optional"
              placeholder="A friend, Instagram, etc."
              name="referralSource"
              autoComplete="off"
              {...form.getInputProps("referralSource")}
            />

            <Button type="submit" loading={isPending} fullWidth>
              Join the waitlist
            </Button>
          </Stack>
        </form>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Have an invite code?{" "}
        <Anchor component={Link} href="/join" fw={600} underline="always">
          Enter it here
        </Anchor>
      </Text>
    </Box>
  );
}
