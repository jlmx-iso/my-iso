"use client";
import {
  Anchor,
  Box,
  Button,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCheck, IconClock } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import logo from "../../../public/img/logo.webp";
import { api } from "~/trpc/react";

export default function Page() {
  const [position, setPosition] = useState<number | null>(null);

  const { mutate: apply, isPending, isError, error } =
    api.waitlist.submit.useMutation({
      onSuccess: (data) => {
        setPosition(data.position);
      },
    });

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      instagram: "",
      website: "",
      userType: "both",
      referralSource: "",
    },
    validate: {
      email: (v: string) => {
        if (!v.trim()) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Invalid email";
        return null;
      },
      name: (v: string) => (v.trim().length > 0 ? null : "Name is required"),
    },
  });

  const handleSubmit = () => {
    if (form.validate().hasErrors) return;
    apply({
      name: form.values.name,
      email: form.values.email,
      instagram: form.values.instagram || undefined,
      website: form.values.website || undefined,
      userType: form.values.userType as "lead" | "second" | "both",
      referralSource: form.values.referralSource || undefined,
    });
  };

  if (position !== null) {
    return (
      <Box maw={420} w="100%" mx="auto">
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="md">
            <ThemeIcon size={56} radius="xl" variant="light" color="teal">
              <IconCheck size={28} />
            </ThemeIcon>
            <Title order={3} ta="center">
              You&apos;re on the list!
            </Title>
            <Text c="dimmed" ta="center">
              You&apos;re #{position} on the waitlist. We&apos;ll send you an
              invite when a spot opens up.
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
          alt="ISO logo"
          style={{ height: "4rem", width: "auto" }}
          width={100}
          height={100}
        />
        <Title order={2} ta="center">
          Request an Invite
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          <IconClock size={14} style={{ verticalAlign: "middle" }} /> We&apos;re
          currently invite-only. Tell us about yourself.
        </Text>
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <Stack>
          {isError && (
            <Text c="red" size="sm">
              {error.message}
            </Text>
          )}

          <TextInput
            label="Full name"
            placeholder="Jane Doe"
            required
            {...form.getInputProps("name")}
          />
          <TextInput
            label="Email"
            placeholder="you@example.com"
            required
            {...form.getInputProps("email")}
          />
          <TextInput
            label="Instagram"
            placeholder="@yourhandle"
            {...form.getInputProps("instagram")}
          />
          <TextInput
            label="Website"
            placeholder="https://yoursite.com"
            {...form.getInputProps("website")}
          />
          <Select
            label="I'm looking to..."
            data={[
              { value: "lead", label: "Find second shooters (Lead)" },
              { value: "second", label: "Find gigs (Second shooter)" },
              { value: "both", label: "Both" },
            ]}
            {...form.getInputProps("userType")}
          />
          <TextInput
            label="How did you hear about ISO?"
            placeholder="A friend, Instagram, etc."
            {...form.getInputProps("referralSource")}
          />

          <Button onClick={handleSubmit} loading={isPending} fullWidth>
            Join the waitlist
          </Button>
        </Stack>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Have an invite code?{" "}
        <Anchor component={Link} href="/join" fw={500}>
          Enter it here
        </Anchor>
      </Text>
    </Box>
  );
}
