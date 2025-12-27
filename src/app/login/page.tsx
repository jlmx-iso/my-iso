"use client";
import { Box, Button, Group, PasswordInput, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import Link from "next/link";
import { signIn } from "next-auth/react";

import { logger } from "~/_utils";

export default function Page() {
  const form = useForm({
    initialValues: {
      password: "",
      username: "",
    },
    validate: {
      username: (value: string) => value.length > 0 ? null : "Email is required",
    }
  });

  const handleSignIn = async () => {
    logger.info("logging in user", form.values);
    const result = await signIn("credentials", {
      password: form.values.password,
      redirect: false,
      username: form.values.username
    });
    return result;
  }

  return (
    <Box p="xl">
      <button onClick={() => signIn()}>Instant Login</button>
      <form onSubmit={handleSignIn}>
        <TextInput
          label="Email"
          placeholder="Your email"
          {...form.getInputProps("username")}
        />
        <PasswordInput
          type="password"
          label="Password"
          placeholder="Your password"
          {...form.getInputProps("password")}
        />
        <Group justify="flex-end" mt="md">
          <Button type="submit" variant="outline">Login</Button>
          <Link href="/register">Register</Link>
        </Group>
      </form>
    </Box>
  );
}