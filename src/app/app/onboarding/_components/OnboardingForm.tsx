"use client";

import {
  Box,
  Button,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { type FileWithPath } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { type MouseEventHandler, useEffect, useMemo, useState } from "react";

import { OnboardingComplete } from "./OnboardingComplete";
import { PlanSelection } from "./PlanSelection";
import { WelcomeScreen } from "./WelcomeScreen";

import { logger } from "~/_utils";
import { ErrorAlert } from "~/app/_components/Alerts";
import { Dropzone } from "~/app/_components/input/Dropzone";
import { Loader } from "~/app/_components/Loader";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { env } from "~/env";
import type { PricingInfo } from "~/server/_utils/pricing";
import { api } from "~/trpc/react";

// Onboarding stages (not steps in the stepper — separate screens)
type Stage = "welcome" | "profile" | "plan" | "complete";

type OnboardingUser = {
  city: string | null;
  country: string | null;
  email: string;
  firstName: string;
  handle: string | null;
  id: string;
  lastName: string;
  phone: string | null;
  state: string | null;
};

type OnboardingFormProps = {
  photographerCount: number;
  pricing: PricingInfo;
  user: OnboardingUser;
};

// Profile stepper steps
const PROFILE_STEPS = 3; // basics, business, avatar

export function OnboardingForm({ photographerCount, pricing, user }: OnboardingFormProps) {
  const [stage, setStage] = useState<Stage>("welcome");
  const [profileStep, setProfileStep] = useState(0);

  // Avatar upload state
  const [avatarFiles, setAvatarFiles] = useState<FileWithPath[] | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const updateProfile = api.user.updateProfile.useMutation();
  const createPhotographer = api.photographer.create.useMutation();
  const uploadAvatar = api.photographer.uploadProfileImage.useMutation();

  const isPending =
    updateProfile.isPending ||
    createPhotographer.isPending ||
    avatarUploading;

  const error =
    updateProfile.error ?? createPhotographer.error ?? uploadAvatar.error;

  const form = useForm({
    initialValues: {
      companyName: "",
      handle: user.handle ?? "",
      instagram: "",
      location: "",
      phoneNumber: user.phone ?? "",
      website: "",
    },
    validate: {
      companyName: (value: string) =>
        value.length > 0 ? null : "Business name is required",
      instagram: (value: string) => {
        if (
          value.length &&
          !/^(https?):\/\/(www\.)?instagram\.com\/[^ "]+$/.test(value)
        )
          return "Invalid Instagram URL";
        return null;
      },
      location: (value: string) =>
        value.length > 0 ? null : "Location is required",
      phoneNumber: (value: string) => {
        if (!/^\d{10}$/.test(value))
          return "Invalid phone number (10 digits)";
        return null;
      },
      website: (value: string) => {
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value))
          return "Invalid website URL";
        return null;
      },
    },
  });

  // Memoize avatar preview URLs and revoke on cleanup to prevent URL leaks
  const avatarUrls = useMemo(
    () => (avatarFiles ?? []).map((file) => URL.createObjectURL(file)),
    [avatarFiles],
  );

  useEffect(() => {
    return () => {
      avatarUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [avatarUrls]);

  const avatarPreviews = avatarUrls.map((url, index) => (
    <Image key={index} src={url} radius="md" />
  ));

  // Validate fields for each profile sub-step
  const nextProfileStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    const stepFields: Record<number, string[]> = {
      0: ["location", "phoneNumber"],
      1: ["companyName", "instagram", "website"],
    };
    const fields = stepFields[profileStep] ?? [];
    let hasErrors = false;
    for (const field of fields) {
      if (form.validateField(field).hasError) hasErrors = true;
    }
    if (!hasErrors)
      setProfileStep((s) => Math.min(s + 1, PROFILE_STEPS - 1));
  };

  const prevProfileStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    setProfileStep((s) => Math.max(s - 1, 0));
  };

  // Submit profile data (called after avatar step)
  const submitProfile = async () => {
    const validation = form.validate();
    if (validation.hasErrors) return;

    const values = form.values;

    try {
      await updateProfile.mutateAsync({
        handle: values.handle || undefined,
        phone: values.phoneNumber,
      });
    } catch (err) {
      logger.error("Profile update failed during onboarding", { err });
      return;
    }

    try {
      await createPhotographer.mutateAsync({
        companyName: values.companyName,
        facebook: null,
        instagram: values.instagram || null,
        location: values.location,
        name: `${user.firstName} ${user.lastName}`,
        tiktok: null,
        twitter: null,
        vimeo: null,
        website: values.website || null,
        youtube: null,
      });
    } catch (err) {
      logger.error("Photographer creation failed during onboarding", { err });
      return;
    }

    // Upload avatar if provided
    if (avatarFiles?.[0]) {
      setAvatarUploading(true);
      const file = avatarFiles[0];
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64File = reader.result?.toString().split(",")[1];
          if (base64File) {
            try {
              await uploadAvatar.mutateAsync({ image: base64File });
            } catch (uploadErr) {
              logger.error("Avatar upload failed during onboarding", {
                uploadErr,
              });
              notifications.show({
                color: "yellow",
                message:
                  "Profile created, but avatar upload failed. You can upload it from your profile.",
                title: "Avatar not uploaded",
              });
            }
          }
          setAvatarUploading(false);
          resolve();
        };
        reader.onerror = () => {
          logger.error("FileReader error during avatar upload");
          notifications.show({
            color: "yellow",
            message: "Could not read the selected file. You can upload your photo from your profile.",
            title: "File read error",
          });
          setAvatarUploading(false);
          resolve();
        };
        reader.onabort = () => {
          setAvatarUploading(false);
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }

    setStage("plan");
  };

  const handleSelectFree = () => setStage("complete");
  // Note: Pro users are redirected to Stripe checkout via PlanSelection.
  // After payment, Stripe returns to /app/onboarding/complete?plan=pro which shows
  // the celebration screen with Pro messaging (same as free, but with Pro copy).
  // The /app/settings?checkout=success route is bypassed intentionally for better UX.

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

  // Stage: Welcome
  if (stage === "welcome") {
    return (
      <WelcomeScreen
        firstName={user.firstName}
        onContinue={() => setStage("profile")}
        photographerCount={photographerCount}
      />
    );
  }

  // Stage: Complete (Free users only — Pro users are redirected to Stripe)
  if (stage === "complete") {
    return <OnboardingComplete plan="free" />;
  }

  // Stage: Plan selection
  if (stage === "plan") {
    return <PlanSelection pricing={pricing} onSelectFree={handleSelectFree} />;
  }

  // Stage: Profile setup (multi-step stepper)
  return (
    <Box maw={640} w="100%" mx="auto">
      <Stack align="center" mb="xl">
        <Title order={2} ta="center">
          Set up your profile
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Tell other photographers about yourself.
        </Text>
      </Stack>

      <Paper withBorder shadow="md" p="xl" radius="md">
        <form onSubmit={(e) => e.preventDefault()}>
          {error && <ErrorAlert title="Error" message={error.message} />}

          <Stepper
            active={profileStep}
            onStepClick={(step) => {
              // Only allow going back
              if (step < profileStep) setProfileStep(step);
            }}
            allowNextStepsSelect={false}
          >
            {/* Step 1: Basics */}
            <Stepper.Step label="The basics" description="Who you are">
              <Stack gap="sm" mt="md">
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
                <TextInput label="Email" value={user.email} disabled />
                <TextInput
                  label="Phone Number"
                  placeholder="10-digit phone number"
                  required
                  {...form.getInputProps("phoneNumber")}
                />
                <Stack gap={4}>
                  <TextInput
                    label="Username"
                    placeholder="@yourhandle (optional)"
                    leftSection={<Text size="sm" c="dimmed">@</Text>}
                    {...form.getInputProps("handle")}
                  />
                  {form.values.handle && (
                    <Text size="xs" c="dimmed">
                      Your profile: {env.NEXT_PUBLIC_BASE_URL}/photographer/@{form.values.handle}
                    </Text>
                  )}
                </Stack>
                <LocationAutocomplete
                  label="Location"
                  placeholder="City, State"
                  isRequired={true}
                  {...form.getInputProps("location")}
                />
              </Stack>
            </Stepper.Step>

            {/* Step 2: Business */}
            <Stepper.Step label="Your business" description="How to find you">
              <Stack gap="sm" mt="md">
                <TextInput
                  label="Business Name"
                  placeholder="Jane Smith Photography"
                  required
                  {...form.getInputProps("companyName")}
                />
                <TextInput
                  label="Website"
                  placeholder="https://your-website.com"
                  {...form.getInputProps("website")}
                />
                <TextInput
                  label="Instagram"
                  placeholder="https://instagram.com/yourhandle"
                  description="Most photographers live on Instagram — this is the one that counts."
                  {...form.getInputProps("instagram")}
                />
                <Text size="xs" c="dimmed">
                  You can add Facebook, TikTok, and other socials from your
                  profile later.
                </Text>
              </Stack>
            </Stepper.Step>

            {/* Step 3: Avatar */}
            <Stepper.Step
              label="Your photo"
              description="Put a face to the name"
            >
              <Stack gap="md" mt="md">
                <Text size="sm" c="dimmed">
                  Profiles with a photo get significantly more views. You can
                  skip this and add it later from your profile.
                </Text>
                <Dropzone
                  multiple={false}
                  loading={avatarUploading}
                  handleFileChange={(files) => setAvatarFiles(files)}
                />
                {avatarPreviews.length > 0 && (
                  <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs">
                    {avatarPreviews}
                  </SimpleGrid>
                )}
              </Stack>
            </Stepper.Step>
          </Stepper>

          <Group justify="space-between" mt="xl">
            {profileStep > 0 ? (
              <Button onClick={prevProfileStep} variant="subtle">
                Back
              </Button>
            ) : (
              <Box />
            )}

            {profileStep < PROFILE_STEPS - 1 ? (
              <Button onClick={nextProfileStep} color="orange">
                Next
              </Button>
            ) : (
              <Group gap="sm">
                {!avatarFiles?.length && (
                  <Button
                    variant="subtle"
                    color="gray"
                    onClick={() => void submitProfile()}
                    disabled={isPending}
                  >
                    Skip for now
                  </Button>
                )}
                <Button
                  color="orange"
                  onClick={() => void submitProfile()}
                  loading={isPending}
                >
                  {avatarFiles?.length ? "Upload & Continue" : "Continue"}
                </Button>
              </Group>
            )}
          </Group>
        </form>
      </Paper>
    </Box>
  );
}
