"use client";
import { TextInput, PasswordInput, Button, Box, Group } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import Link from "next/link";
import { api } from "~/trpc/react";

export default function Page() {
  const submitRegistration = api.auth.register.useMutation();
  const [visible, { toggle }] = useDisclosure(false);
  const form = useForm({
    initialValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      phoneNumber: "",
    },

    validate: {
      firstName: (value) => value.length > 0 ? null : "First name is required",
      lastName: (value) => value.length > 0 ? null : "Last name is required",
      email: (value) => {
        if (value.length === 0) return "Email is required";
        // regex to confirm valid email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
        return null;
      },
      password: (value) => {
        // Password requirements:
        // - At least 6 characters
        // - At most 20 characters
        // - At least one uppercase letter
        // - At least one lowercase letter
        // - At least one number
        // - At least one special character
        if (value.length < 6 || value.length > 20) {
          return "Password must be between 6 and 20 characters";
        }
        // regex to ensure pasword requirements are met
        if (!/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z]).{6,20}$/.test(value)) {
          return "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character";
        }
      },
      confirmPassword: (value, values) => {
        if (value !== values.password) return "Passwords do not match";
      },
      phoneNumber: (value) => {
        // regex to confirm valid phone number
        if (!/^\d{10}$/.test(value)) return "Invalid phone number";
      },
    },
  });

  const handleSubmit = () => {
    const validation = form.validate();
    if (validation.hasErrors) {
      return;
    } else {
      return submitRegistration.mutate({
        email: form.values.email,
        firstName: form.values.firstName,
        lastName: form.values.lastName,
        password: form.values.password,
        phone: form.values.phoneNumber,
      });
    }
  };

  return (
    <Box p="xl">
      <form onSubmit={handleSubmit}>
        <TextInput
          label="First Name"
          placeholder="First name"
          {...form.getInputProps("firstName")}
        />
        <TextInput
          label="Last Name"
          placeholder="Last name"
          {...form.getInputProps("lastName")}
        />
        <TextInput
          label="Email"
          placeholder="Email"
          {...form.getInputProps("email")}
        />
        <PasswordInput
          label="Password"
          placeholder="Password"
          visible={visible}
          onVisibilityChange={toggle}
          {...form.getInputProps("password")}
        />
        <PasswordInput
          label="Confirm Password"
          placeholder="Confirm Password"
          visible={visible}
          onVisibilityChange={toggle}
          {...form.getInputProps("confirmPassword")}
        />
        <TextInput
          label="Phone Number"
          placeholder="Phone number"
          {...form.getInputProps("phoneNumber")}
        />
        <Group justify="flex-end" mt="md">
          <Button type="submit" variant="outline">Register</Button>
          <Link href="/login">Login</Link>
        </Group>
      </form>
    </Box>
  )
}