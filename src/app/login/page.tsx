"use client";
import { TextInput, PasswordInput, Button, Box, Group } from "@mantine/core";
import { useForm } from "@mantine/form";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function Page() {
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },
    validate: {
      username: (value) => value.length > 0 ? null : "Email is required",
    }
  });

  const handleSignIn = async () => {
    await signIn("credentials", {
      username: form.values.username,
      password: form.values.password,
      redirect: false
    });
  }

  return (
    <Box p="xl">
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