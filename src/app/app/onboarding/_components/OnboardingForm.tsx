"use client";

import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { type FormEvent, useState } from "react";

import { normalizeHandle, publicProfileUrl, validateHandle } from "~/_utils/handle";
import { isValidInstagramHandle, normalizeInstagramHandle } from "~/_utils/instagram";
import { logger } from "~/_utils/logger";
import { isValidPhone, normalizePhone } from "~/_utils/phone";
import { trpcErrorCode, userFacingError } from "~/_utils/userError";
import { parseOptionalWebsite } from "~/_utils/website";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { readFileAsBase64 } from "~/app/_lib/readFile";
import { env } from "~/env";
import type { PricingInfo } from "~/server/_utils/pricing";
import { api } from "~/trpc/react";

import { AvatarStep } from "./AvatarStep";
import { PlanSelection } from "./PlanSelection";
import { WelcomeScreen } from "./WelcomeScreen";

/** Where the plan step lives, so a reload during it comes back to it. */
export const PLAN_STEP_URL = "/app/onboarding?step=plan";

type Stage = "welcome" | "profile" | "plan";

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
  /** "plan" when the profile already exists (a reload during the plan step). */
  initialStage: "welcome" | "plan";
  photographerCount: number;
  pricing: PricingInfo;
  user: OnboardingUser;
};

type FormValues = {
  companyName: string;
  firstName: string;
  handle: string;
  instagram: string;
  isDiscoverable: boolean;
  lastName: string;
  location: string;
  phoneNumber: string;
  website: string;
};

const STEPS = [
  { fields: ["firstName", "lastName", "phoneNumber", "handle", "location"], title: "The basics" },
  { fields: ["companyName", "website", "instagram"], title: "Your business" },
  { fields: [], title: "Your photo" },
] as const satisfies ReadonlyArray<{ fields: ReadonlyArray<keyof FormValues>; title: string }>;

const HANDLE_STEP = 0;

export function OnboardingForm({ initialStage, photographerCount, pricing, user }: OnboardingFormProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(initialStage);
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { update: updateSession } = useSession();
  const updateProfile = api.user.updateProfile.useMutation();
  const createPhotographer = api.photographer.create.useMutation();
  const updatePreferences = api.discover.updatePreferences.useMutation();
  const uploadAvatar = api.photographer.uploadProfileImage.useMutation();

  // Name fields are editable when not pre-filled (e.g. email OTP sign-up)
  const nameEditable = !user.firstName && !user.lastName;

  const form = useForm<FormValues>({
    initialValues: {
      companyName: "",
      firstName: user.firstName,
      handle: user.handle ?? "",
      instagram: "",
      isDiscoverable: true,
      lastName: user.lastName,
      location: "",
      phoneNumber: user.phone ?? "",
      website: "",
    },
    validate: {
      companyName: (value) => (value.trim() ? null : "Enter your business name. Your own name is fine."),
      firstName: (value) => (nameEditable && !value.trim() ? "Enter your first name" : null),
      handle: validateHandle,
      instagram: (value) =>
        !value.trim() || isValidInstagramHandle(value) ? null : "Enter just the handle, like yourhandle",
      lastName: (value) => (nameEditable && !value.trim() ? "Enter your last name" : null),
      location: (value) => (value.trim() ? null : "Enter the city you're based in"),
      phoneNumber: (value) =>
        !value.trim() || isValidPhone(value) ? null : "Enter a 10-digit US phone number, or leave this blank",
      website: (value) => (parseOptionalWebsite(value).ok ? null : "Enter a web address, like yoursite.com"),
    },
  });

  const handle = normalizeHandle(form.values.handle);

  const validateStep = (index: number) => {
    const fields = STEPS[index]?.fields ?? [];
    // Validate every field (not just up to the first error) so all show.
    return fields.map((field) => form.validateField(field).hasError).every((hasError) => !hasError);
  };

  /** Saves everything collected by the steps, then moves on to the plan step. */
  const saveProfile = async (): Promise<void> => {
    const values = form.values;
    const firstName = nameEditable ? values.firstName.trim() : user.firstName;
    const lastName = nameEditable ? values.lastName.trim() : user.lastName;
    const website = parseOptionalWebsite(values.website);

    setSubmitError(null);
    setIsSaving(true);
    try {
      try {
        await updateProfile.mutateAsync({
          ...(nameEditable ? { firstName, lastName } : {}),
          handle: handle || undefined,
          phone: values.phoneNumber.trim() ? normalizePhone(values.phoneNumber) : "",
        });
      } catch (error) {
        logger.error("Profile update failed during onboarding", { error });
        if (trpcErrorCode(error) === "CONFLICT") {
          // The handle belongs to the first step: go back there and say so.
          setStep(HANDLE_STEP);
          form.setFieldError("handle", "That username is taken. Try another one.");
          setSubmitError("That username is already taken. Choose a different one to continue.");
        } else {
          setSubmitError(userFacingError(error, "We couldn't save your details. Please try again."));
        }
        return;
      }

      try {
        await createPhotographer.mutateAsync({
          companyName: values.companyName.trim(),
          facebook: null,
          instagram: values.instagram.trim() ? normalizeInstagramHandle(values.instagram) : null,
          location: values.location.trim(),
          name: `${firstName} ${lastName}`.trim(),
          tiktok: null,
          twitter: null,
          vimeo: null,
          website: website.ok ? website.value : null,
          youtube: null,
        });
      } catch (error) {
        logger.error("Photographer creation failed during onboarding", { error });
        setSubmitError(userFacingError(error, "We couldn't create your profile. Please try again."));
        return;
      }

      // From here the profile exists: nothing below may block finishing.
      try {
        await updatePreferences.mutateAsync({ isDiscoverable: values.isDiscoverable });
      } catch (error) {
        logger.error("Saving discoverability failed during onboarding", { error });
        notifications.show({
          color: "tan",
          message: "We couldn't save your Discover visibility. You can set it on the Discover page.",
          title: "One setting wasn't saved",
        });
      }

      if (photo) {
        try {
          await uploadAvatar.mutateAsync({ image: await readFileAsBase64(photo) });
        } catch (error) {
          logger.error("Avatar upload failed during onboarding", { error });
          notifications.show({
            color: "tan",
            message: "Your profile is ready, but the photo didn't upload. You can add it from your profile.",
            title: "Photo not uploaded",
          });
        }
      }

      // Refresh the session so the header shows the name and photo.
      await updateSession().catch((error: unknown) =>
        logger.error("Session refresh failed after onboarding", { error }),
      );
      // The plan step has its own URL, so a reload stays on it.
      router.replace(PLAN_STEP_URL);
      setStage("plan");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!validateStep(step)) return;
    if (step < STEPS.length - 1) {
      setSubmitError(null);
      setStep(step + 1);
      return;
    }
    // Re-check everything: an earlier step may have been edited since.
    const firstInvalid = STEPS.findIndex((_step, index) => !validateStep(index));
    if (firstInvalid !== -1) {
      setStep(firstInvalid);
      return;
    }
    void saveProfile();
  };

  if (stage === "welcome") {
    return (
      <WelcomeScreen
        firstName={user.firstName}
        onContinue={() => setStage("profile")}
        photographerCount={photographerCount}
      />
    );
  }

  if (stage === "plan") {
    return <PlanSelection pricing={pricing} />;
  }

  const currentStep = STEPS[step] ?? STEPS[0];
  const isLastStep = step === STEPS.length - 1;

  return (
    <Box maw={640} w="100%" mx="auto">
      <Stack align="center" mb="lg" gap={4}>
        <Title order={1} size="h2" ta="center">
          Set up your profile
        </Title>
        <Text c="dimmed" size="sm" ta="center">
          Tell other photographers about yourself.
        </Text>
      </Stack>

      <Paper withBorder shadow="md" p={{ base: "md", sm: "xl" }} radius="md">
        <form onSubmit={handleSubmit} noValidate>
          <Stack gap="md">
            <Stack gap={6}>
              <Group justify="space-between" align="baseline">
                <Title order={2} size="h4">
                  {currentStep.title}
                </Title>
                <Text size="sm" c="dimmed">
                  Step {step + 1} of {STEPS.length}
                </Text>
              </Group>
              <Progress
                value={((step + 1) / STEPS.length) * 100}
                size="sm"
                aria-label={`Step ${step + 1} of ${STEPS.length}`}
              />
            </Stack>

            {/* Always rendered so screen readers announce errors as they appear. */}
            <div role="alert" aria-live="assertive">
              {submitError && (
                <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="onboarding-error">
                  {submitError}
                </Alert>
              )}
            </div>

            {step === 0 && (
              <Stack gap="sm">
                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
                  <TextInput
                    label="First name"
                    autoComplete="given-name"
                    required={nameEditable}
                    readOnly={!nameEditable}
                    variant={nameEditable ? "default" : "filled"}
                    {...form.getInputProps("firstName")}
                  />
                  <TextInput
                    label="Last name"
                    autoComplete="family-name"
                    required={nameEditable}
                    readOnly={!nameEditable}
                    variant={nameEditable ? "default" : "filled"}
                    {...form.getInputProps("lastName")}
                  />
                </SimpleGrid>
                <TextInput
                  label="Email"
                  description="The address you signed in with"
                  value={user.email}
                  readOnly
                  variant="filled"
                />
                <LocationAutocomplete
                  label="Location"
                  placeholder="City, State"
                  isRequired
                  {...form.getInputProps("location")}
                />
                <TextInput
                  label="Username"
                  description={
                    handle && !validateHandle(handle)
                      ? `Your public profile: ${publicProfileUrl(env.NEXT_PUBLIC_BASE_URL, handle)}`
                      : "Optional. 3 to 30 lowercase letters, numbers or underscores. It becomes your public profile link."
                  }
                  placeholder="yourname"
                  leftSection={<Text size="sm" c="dimmed" aria-hidden>@</Text>}
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={31}
                  {...form.getInputProps("handle")}
                />
                <TextInput
                  label="Phone number"
                  description="Optional. Not shown on your profile."
                  placeholder="(555) 555-5555"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  {...form.getInputProps("phoneNumber")}
                />
              </Stack>
            )}

            {step === 1 && (
              <Stack gap="sm">
                <TextInput
                  label="Business name"
                  placeholder="Jane Smith Photography"
                  autoComplete="organization"
                  required
                  {...form.getInputProps("companyName")}
                />
                <TextInput
                  label="Website"
                  description="Optional"
                  placeholder="yoursite.com"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  {...form.getInputProps("website")}
                />
                <TextInput
                  label="Instagram"
                  placeholder="yourhandle"
                  description="Optional. Most photographers live on Instagram — this is the one that counts."
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  leftSection={
                    <Text size="sm" c="dimmed" style={{ userSelect: "none", whiteSpace: "nowrap" }}>
                      instagram.com/
                    </Text>
                  }
                  leftSectionWidth="calc(14ch + 1rem)"
                  styles={{ input: { paddingLeft: "calc(14ch + 1.25rem)" } }}
                  {...form.getInputProps("instagram")}
                />
                <Switch
                  mt="xs"
                  label="Show me in Discover"
                  description="Lets other photographers find your profile and match with you. You can change this any time on the Discover page."
                  {...form.getInputProps("isDiscoverable", { type: "checkbox" })}
                />
              </Stack>
            )}

            {step === 2 && (
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  Profiles with a photo get noticed more. You can skip this and add one later
                  from your profile.
                </Text>
                <AvatarStep photo={photo} onChange={setPhoto} disabled={isSaving} />
              </Stack>
            )}

            <Group justify="space-between" mt="sm">
              {step > 0 ? (
                <Button variant="default" onClick={() => setStep(step - 1)} disabled={isSaving}>
                  Back
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" loading={isSaving}>
                {!isLastStep ? "Next" : photo ? "Create profile" : "Skip photo and create profile"}
              </Button>
            </Group>

            {isSaving && (
              <Group gap="xs" justify="center" role="status">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">Setting up your profile…</Text>
              </Group>
            )}
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
