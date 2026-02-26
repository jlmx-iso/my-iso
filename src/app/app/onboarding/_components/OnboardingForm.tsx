"use client";

import {
  Box,
  Button,
  Group,
  Image,
  Paper,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { type FileWithPath } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { type MouseEventHandler, useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type CropperProps } from "react-easy-crop";
import type { Area } from "react-easy-crop";

import { OnboardingComplete } from "./OnboardingComplete";
import { PlanSelection } from "./PlanSelection";
import { WelcomeScreen } from "./WelcomeScreen";

import { useSession } from "next-auth/react";
import { isValidInstagramHandle, isValidPhone, logger, normalizeInstagramHandle, normalizePhone } from "~/_utils";
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

  // Crop state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const cropSrcFileRef = useRef<FileWithPath | null>(null);

  const { update: updateSession } = useSession();
  const updateProfile = api.user.updateProfile.useMutation();
  const createPhotographer = api.photographer.create.useMutation();
  const uploadAvatar = api.photographer.uploadProfileImage.useMutation();

  const isPending =
    updateProfile.isPending ||
    createPhotographer.isPending ||
    avatarUploading;

  const error =
    updateProfile.error ?? createPhotographer.error ?? uploadAvatar.error;

  // Name fields are editable when not pre-filled (e.g. email OTP sign-up)
  const nameEditable = !user.firstName && !user.lastName;

  const form = useForm({
    initialValues: {
      companyName: "",
      firstName: user.firstName,
      handle: user.handle ?? "",
      instagram: "",
      lastName: user.lastName,
      location: "",
      phoneNumber: user.phone ?? "",
      website: "",
    },
    validate: {
      companyName: (value: string) =>
        value.length > 0 ? null : "Business name is required",
      firstName: (value: string) =>
        nameEditable && !value.trim() ? "First name is required" : null,
      instagram: (value: string) =>
        !value || isValidInstagramHandle(value) ? null : "Enter a valid Instagram handle (e.g. yourhandle)",
      lastName: (value: string) =>
        nameEditable && !value.trim() ? "Last name is required" : null,
      location: (value: string) =>
        value.length > 0 ? null : "Location is required",
      phoneNumber: (value: string) =>
        !value ? "Phone number is required" : isValidPhone(value) ? null : "Enter a valid 10-digit US phone number",
      website: (value: string) => {
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value))
          return "Invalid website URL";
        return null;
      },
    },
  });

  // Preview URL for the cropped file
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!avatarFiles?.[0]) { setAvatarPreviewUrl(null); return; }
    const url = URL.createObjectURL(avatarFiles[0]);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFiles]);

  // Called by react-easy-crop when the user finishes dragging
  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  // When user picks a file, enter crop mode
  const handleFileChange = useCallback((files: FileWithPath[]) => {
    const file = files[0];
    if (!file) return;
    cropSrcFileRef.current = file;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Crop the image on canvas and store as a File
  const applyCrop = useCallback(async () => {
    if (!cropSrc || !croppedAreaPixels) return;
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = cropSrc;
      });
      const canvas = document.createElement("canvas");
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        image,
        croppedAreaPixels.x, croppedAreaPixels.y,
        croppedAreaPixels.width, croppedAreaPixels.height,
        0, 0, size, size,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      if (!blob) throw new Error("Failed to generate cropped image");
      const croppedFile = new File([blob], cropSrcFileRef.current?.name ?? "avatar.jpg", { type: "image/jpeg" }) as FileWithPath;
      setAvatarFiles([croppedFile]);
      setCropSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch (err) {
      logger.error("Failed to crop image", { err });
      notifications.show({
        color: "red",
        message: "Failed to crop image. Please try again.",
        title: "Crop error",
      });
      setCropSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [cropSrc, croppedAreaPixels]);

  // Validate fields for each profile sub-step
  const nextProfileStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    const stepFields: Record<number, string[]> = {
      0: [...(nameEditable ? ["firstName", "lastName"] : []), "location", "phoneNumber"],
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

    const firstName = nameEditable ? values.firstName : user.firstName;
    const lastName = nameEditable ? values.lastName : user.lastName;

    try {
      await updateProfile.mutateAsync({
        ...(nameEditable ? { firstName, lastName } : {}),
        handle: values.handle || undefined,
        phone: normalizePhone(values.phoneNumber),
      });
    } catch (err) {
      logger.error("Profile update failed during onboarding", { err });
      return;
    }

    try {
      await createPhotographer.mutateAsync({
        companyName: values.companyName,
        facebook: null,
        instagram: values.instagram ? normalizeInstagramHandle(values.instagram) : null,
        location: values.location,
        name: `${firstName} ${lastName}`,
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

    // Refresh session so navbar shows updated name/avatar
    await updateSession();
    setStage("plan");
  };

  const handleSelectFree = () => setStage("complete");
  // Note: Pro users are redirected to Stripe checkout via PlanSelection
  // and land on /app/settings after payment. The complete stage is Free-only.

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
                  {nameEditable ? (
                    <>
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
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </Group>
                <TextInput label="Email" value={user.email} disabled />
                <TextInput
                  label="Phone Number"
                  placeholder="(555) 555-5555"
                  required
                  {...form.getInputProps("phoneNumber")}
                />
                <Stack gap={4}>
                  <TextInput
                    label="Username"
                    placeholder="yourhandle (optional)"
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
                  placeholder="yourhandle"
                  description="Most photographers live on Instagram — this is the one that counts."
                  leftSection={
                    <Text size="sm" c="dimmed" style={{ userSelect: "none", whiteSpace: "nowrap" }}>
                      instagram.com/
                    </Text>
                  }
                  leftSectionWidth="calc(14ch + 1rem)"
                  styles={{ input: { paddingLeft: "calc(14ch + 1.25rem)" } }}
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
                {cropSrc ? (
                  <Stack gap="sm">
                    <Box pos="relative" style={{ background: "#000", borderRadius: 8, height: 320, overflow: "hidden" }}>
                      <Cropper
                        image={cropSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        cropShape="round"
                        showGrid={false}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                      />
                    </Box>
                    <Text size="xs" c="dimmed" ta="center">Drag to reposition · scroll to zoom</Text>
                    <Group justify="flex-end" gap="xs">
                      <Button variant="subtle" size="sm" onClick={() => setCropSrc(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => void applyCrop()}>Use this photo</Button>
                    </Group>
                  </Stack>
                ) : avatarPreviewUrl ? (
                  <Box pos="relative">
                    <Image
                      src={avatarPreviewUrl}
                      radius="md"
                      style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
                    />
                    <Button
                      variant="default"
                      size="xs"
                      style={{ bottom: 8, position: "absolute", right: 8 }}
                      onClick={() => setAvatarFiles(null)}
                    >
                      Change photo
                    </Button>
                  </Box>
                ) : (
                  <Dropzone
                    multiple={false}
                    loading={avatarUploading}
                    handleFileChange={handleFileChange}
                  />
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
