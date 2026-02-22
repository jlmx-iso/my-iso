"use client";
import { Anchor, Badge, Box, Button, Divider, Grid, Group, Paper, Stack, Stepper, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconBrandGoogle, IconUserPlus } from "@tabler/icons-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { type MouseEventHandler, useEffect, useState } from "react";


import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { ErrorAlert } from "../_components/Alerts";
import { Loader } from "../_components/Loader";

import { api } from "~/trpc/react";

export default function Page() {
  const searchParams = useSearchParams();
  const refCode = searchParams.get("ref") ?? "";
  const [referralCode] = useState(refCode);
  const [active, setActive] = useState(0);
  const { mutate: submitRegistration, error: submitError, isError, isPending, isSuccess } = api.auth.register.useMutation();
  const { mutate: claimReferral } = api.referral.claimReferral.useMutation();

  // After successful registration, attempt to claim the referral code.
  // The claim requires authentication, so we also persist the code in
  // localStorage for a post-login retry if needed.
  useEffect(() => {
    if (isSuccess && referralCode) {
      try {
        localStorage.setItem("iso_referral_code", referralCode);
      } catch {
        // localStorage may be unavailable
      }
      claimReferral({ code: referralCode });
    }
  }, [isSuccess, referralCode, claimReferral]);
  const nextStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    const stepOneFields = ["firstName", "lastName", "email", "phoneNumber", "location"];
    if (active === 0) {
      let hasErrors = false;
      for (const field of stepOneFields) {
        if (form.validateField(field).hasError) {
          hasErrors = true;
        }
      }
      if (hasErrors) return;
    }
    setActive((current) => (current < 3 ? current + 1 : current));
  };
  const prevStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    setActive((current) => (current > 0 ? current - 1 : current));
  };
  const form = useForm({
    initialValues: {
      companyName: "",
      email: "",
      facebook: "",
      firstName: "",
      instagram: "",
      lastName: "",
      location: "",
      phoneNumber: "",
      provider: "email",
      tiktok: "",
      twitter: "",
      vimeo: "",
      website: "",
      youtube: "",
    },

    validate: {
      companyName: (value: string) => value.length > 0 ? null : "Business name is required",
      email: (value: string) => {
        if (value.length === 0) return "Email is required";
        // regex to confirm valid email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
        return null;
      },
      facebook: (value: string) => {
        // regex to confirm valid facebook includes "facebook.com"
        if (value.length && !/^(http|https):\/\/(www.)?facebook.com\/[^ "]+$/.test(value)) return "Invalid Facebook URL";
      },
      firstName: (value: string) => value.length > 0 ? null : "First name is required",
      instagram: (value: string) => {
        // regex to confirm valid instagram includes "instagram.com" or "x.com"
        if (value.length && !/^(http|https):\/\/(www.)?instagram.com\/[^ "]+$/.test(value)) return "Invalid Instagram URL";
      },
      lastName: (value: string) => value.length > 0 ? null : "Last name is required",
      location: (value: string) => value.length > 0 ? null : "Location is required",
      phoneNumber: (value: string) => {
        // regex to confirm valid phone number
        if (!/^\d{10}$/.test(value)) return "Invalid phone number";
      },
      tiktok: (value: string) => {
        // regex to confirm valid tiktok includes "tiktok.com"
        if (value.length && !/^(http|https):\/\/(www.)?tiktok.com\/[^ "]+$/.test(value)) return "Invalid TikTok URL";
      },
      twitter: (value: string) => {
        // regex to confirm valid twitter includes "twitter.com" or "x.com"
        if (value.length && !/^(http|https):\/\/(www.)?(twitter\.com|x\.com)\/[^ "]+$/.test(value)) return "Invalid Twitter URL";
      },
      vimeo: (value: string) => {
        // regex to confirm valid vimeo includes "vimeo.com"
        if (value.length && !/^(http|https):\/\/(www.)?vimeo.com\/[^ "]+$/.test(value)) return "Invalid Vimeo URL";
      },
      website: (value: string) => {
        // regex to confirm valid website
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value)) return "Invalid website";
      },
      youtube: (value: string) => {
        // regex to confirm valid youtube includes "youtube.com"
        if (value.length && !/^(http|https):\/\/(www.)?youtube.com\/[^ "]+$/.test(value)) return "Invalid YouTube URL";
      }
    },
  });

  const handleSubmit = () => {
    const validation = form.validate();
    if (validation.hasErrors) {
      return;
    } else {
      submitRegistration({
        companyName: form.values.companyName,
        email: form.values.email,
        facebook: form.values.facebook,
        firstName: form.values.firstName,
        instagram: form.values.instagram,
        lastName: form.values.lastName,
        location: form.values.location,
        phone: form.values.phoneNumber,
        provider: form.values.provider as "email" | "google" | "facebook",
        tiktok: form.values.tiktok,
        twitter: form.values.twitter,
        vimeo: form.values.vimeo,
        website: form.values.website,
        youtube: form.values.youtube,
      });
    }
  };

  if (isPending) {
    return <Loader />
  }
  if (isSuccess) {
    return (
      <Box maw={600} w="100%" mx="auto">
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack align="center" gap="md">
            <Title order={2}>You&apos;re all set!</Title>
            <Text c="dimmed" ta="center">
              Registration successful. You can now sign in to your account.
            </Text>
            <Button component="a" href="/login">
              Sign in
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }
  return (
    <Box maw={600} w="100%" mx="auto">
      <Stack align="center" mb="xl">
        <Title order={2} ta="center">
          Create your account
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Join the photographer network
        </Text>
        {referralCode && (
          <Badge
            color="teal"
            variant="light"
            size="lg"
            leftSection={<IconUserPlus size={14} />}
          >
            Referred by a friend
          </Badge>
        )}
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          {isError && <ErrorAlert title="Error" message={submitError.message} />}

          <Button
            onClick={() => signIn("google", { callbackUrl: "/app/events" })}
            leftSection={<IconBrandGoogle size={20} />}
            variant="default"
            size="md"
            fullWidth
            mb="md"
          >
            Sign Up with Google
          </Button>

          <Divider label="or register with email" labelPosition="center" mb="md" />

          <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false}>
            <Stepper.Step label="Personal Info" description="About you">
              <Stack gap="sm">
                <Group grow>
                  <TextInput
                    label="First Name"
                    placeholder="First name"
                    required
                    {...form.getInputProps("firstName")}
                  />
                  <TextInput
                    label="Last Name"
                    placeholder="Last name"
                    required
                    {...form.getInputProps("lastName")}
                  />
                </Group>
                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  required
                  {...form.getInputProps("email")}
                />
                <TextInput
                  label="Phone Number"
                  placeholder="Phone number"
                  required
                  {...form.getInputProps("phoneNumber")}
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
                <TextInput label="Business Name" placeholder="Awesome Photography, LLC" {...form.getInputProps("companyName")} />
                <TextInput label="Website" placeholder="https://awesome-photographer.com" {...form.getInputProps("website")} />
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
            {active > 0 && <Button onClick={prevStep} variant="subtle">Back</Button>}
            {active < 1
              ? <Button onClick={nextStep}>Next</Button>
              : <Button type="submit">Register</Button>
            }
          </Group>
        </form>
      </Paper>

      <Text ta="center" mt="md" size="sm">
        Already have an account?{" "}
        <Anchor component={Link} href="/login" fw={500}>
          Sign in
        </Anchor>
      </Text>
    </Box>
  )
}