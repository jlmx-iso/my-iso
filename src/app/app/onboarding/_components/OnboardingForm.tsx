"use client";

import {
  Box,
  Button,
  Grid,
  Group,
  Paper,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useRouter } from "next/navigation";
import { type MouseEventHandler, useState } from "react";

import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { ErrorAlert } from "~/app/_components/Alerts";
import { Loader } from "~/app/_components/Loader";
import { api } from "~/trpc/react";

type OnboardingUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  handle: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

export function OnboardingForm({ user }: { user: OnboardingUser }) {
  const router = useRouter();
  const [active, setActive] = useState(0);

  const updateProfile = api.user.updateProfile.useMutation();
  const createPhotographer = api.photographer.create.useMutation({
    onSuccess: () => {
      router.push("/app/events");
      router.refresh();
    },
  });

  const isPending = updateProfile.isPending || createPhotographer.isPending;
  const error = updateProfile.error ?? createPhotographer.error;

  const form = useForm({
    initialValues: {
      phoneNumber: user.phone ?? "",
      handle: user.handle ?? "",
      location: "",
      companyName: "",
      website: "",
      facebook: "",
      instagram: "",
      tiktok: "",
      twitter: "",
      vimeo: "",
      youtube: "",
    },

    validate: {
      phoneNumber: (value: string) => {
        if (!/^\d{10}$/.test(value)) return "Invalid phone number (10 digits)";
        return null;
      },
      location: (value: string) => (value.length > 0 ? null : "Location is required"),
      companyName: (value: string) => (value.length > 0 ? null : "Business name is required"),
      facebook: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?facebook.com\/[^ "]+$/.test(value)) return "Invalid Facebook URL";
      },
      instagram: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?instagram.com\/[^ "]+$/.test(value)) return "Invalid Instagram URL";
      },
      tiktok: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?tiktok.com\/[^ "]+$/.test(value)) return "Invalid TikTok URL";
      },
      twitter: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?(twitter\.com|x\.com)\/[^ "]+$/.test(value)) return "Invalid Twitter URL";
      },
      vimeo: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?vimeo.com\/[^ "]+$/.test(value)) return "Invalid Vimeo URL";
      },
      website: (value: string) => {
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value)) return "Invalid website URL";
      },
      youtube: (value: string) => {
        if (value.length && !/^(http|https):\/\/(www.)?youtube.com\/[^ "]+$/.test(value)) return "Invalid YouTube URL";
      },
    },
  });

  const nextStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    const stepOneFields = ["phoneNumber", "location"];
    let hasErrors = false;
    for (const field of stepOneFields) {
      if (form.validateField(field).hasError) {
        hasErrors = true;
      }
    }
    if (hasErrors) return;
    setActive((current) => (current < 1 ? current + 1 : current));
  };

  const prevStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    setActive((current) => (current > 0 ? current - 1 : current));
  };

  const handleSubmit = async () => {
    const validation = form.validate();
    if (validation.hasErrors) return;

    const values = form.values;

    await updateProfile.mutateAsync({
      phone: values.phoneNumber,
      handle: values.handle || undefined,
    });

    await createPhotographer.mutateAsync({
      name: `${user.firstName} ${user.lastName}`,
      companyName: values.companyName,
      location: values.location,
      website: values.website || null,
      facebook: values.facebook || null,
      instagram: values.instagram || null,
      tiktok: values.tiktok || null,
      twitter: values.twitter || null,
      vimeo: values.vimeo || null,
      youtube: values.youtube || null,
    });
  };

  if (isPending) {
    return (
      <Box maw={600} w="100%" mx="auto" mt="xl">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Setting up your profile...</Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box maw={600} w="100%" mx="auto">
      <Stack align="center" mb="xl">
        <Title order={2} ta="center">
          Complete your profile
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Welcome, {user.firstName}! Let&apos;s finish setting up your account.
        </Text>
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
          {error && <ErrorAlert title="Error" message={error.message} />}

          <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false}>
            <Stepper.Step label="Personal Info" description="About you">
              <Stack gap="sm">
                <Group grow>
                  <TextInput
                    label="First Name"
                    value={user.firstName}
                    disabled
                  />
                  <TextInput
                    label="Last Name"
                    value={user.lastName}
                    disabled
                  />
                </Group>
                <TextInput
                  label="Email"
                  value={user.email}
                  disabled
                />
                <TextInput
                  label="Phone Number"
                  placeholder="10-digit phone number"
                  required
                  {...form.getInputProps("phoneNumber")}
                />
                <TextInput
                  label="Handle"
                  placeholder="username (optional)"
                  {...form.getInputProps("handle")}
                />
                <LocationAutocomplete
                  label="Location"
                  placeholder="City, State"
                  isRequired={true}
                  {...form.getInputProps("location")}
                />
              </Stack>
            </Stepper.Step>

            <Stepper.Step label="Business Info" description="Your business">
              <Stack gap="sm">
                <TextInput
                  label="Business Name"
                  placeholder="Awesome Photography, LLC"
                  required
                  {...form.getInputProps("companyName")}
                />
                <TextInput
                  label="Website"
                  placeholder="https://awesome-photographer.com"
                  {...form.getInputProps("website")}
                />
                <Grid grow>
                  <Grid.Col span={6}>
                    <TextInput label="Facebook" placeholder="https://facebook.com/..." {...form.getInputProps("facebook")} />
                    <TextInput label="Instagram" placeholder="https://instagram.com/..." {...form.getInputProps("instagram")} />
                    <TextInput label="TikTok" placeholder="https://tiktok.com/..." {...form.getInputProps("tiktok")} />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <TextInput label="Twitter" placeholder="https://x.com/..." {...form.getInputProps("twitter")} />
                    <TextInput label="Vimeo" placeholder="https://vimeo.com/..." {...form.getInputProps("vimeo")} />
                    <TextInput label="YouTube" placeholder="https://youtube.com/..." {...form.getInputProps("youtube")} />
                  </Grid.Col>
                </Grid>
              </Stack>
            </Stepper.Step>
          </Stepper>

          <Group justify="flex-end" mt="lg">
            {active > 0 && (
              <Button onClick={prevStep} variant="subtle">
                Back
              </Button>
            )}
            {active < 1 ? (
              <Button onClick={nextStep}>Next</Button>
            ) : (
              <Button type="submit" disabled={isPending}>
                Complete Setup
              </Button>
            )}
          </Group>
        </form>
      </Paper>
    </Box>
  );
}
