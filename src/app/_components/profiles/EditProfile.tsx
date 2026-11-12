"use client";

import { Alert, Button, Group, SimpleGrid, Stack, Text, TextInput, Textarea, type TextInputProps, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { type Photographer } from "@prisma/client";
import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import {
    HANDLE_MAX_LENGTH,
    HANDLE_MIN_LENGTH,
    normalizeHandle,
    publicProfileUrl,
    refusedHandleMessage,
    validateHandle,
} from "~/_utils/handle";
import { isValidInstagramHandle, normalizeInstagramHandle } from "~/_utils/instagram";
import { logger } from "~/_utils/logger";
import {
    isValidSocialHandle,
    normalizeFacebookHandle,
    normalizeTikTokHandle,
    normalizeTwitterHandle,
    normalizeVimeoHandle,
    normalizeYouTubeHandle,
} from "~/_utils/social";
import { trpcErrorCode, userFacingError, zodErrorFields, zodFieldErrors } from "~/_utils/userError";
import { parseOptionalWebsite } from "~/_utils/website";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { notify } from "~/app/_lib/notify";
import { env } from "~/env";
import { api } from "~/trpc/react";

const MAX_BIO_LENGTH = 1000;

function SocialHandleInput({ prefix, ...props }: TextInputProps & { prefix: string }) {
    return (
        <TextInput
            placeholder="yourhandle"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            leftSection={
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap", userSelect: "none" }}>
                    {prefix}
                </Text>
            }
            leftSectionWidth={`calc(${prefix.length}ch + 1rem)`}
            styles={{ input: { paddingLeft: `calc(${prefix.length}ch + 1.25rem)` } }}
            {...props}
        />
    );
}

type EditProfileProps = {
    photographer: Photographer;
    /** The member's current username, the last part of their public profile link. */
    handle: string | null;
}

type FormValues = {
    bio: string;
    companyName: string;
    facebook: string;
    firstName: string;
    handle: string;
    instagram: string;
    lastName: string;
    location: string;
    tiktok: string;
    twitter: string;
    vimeo: string;
    website: string;
    youtube: string;
};

const handleError = (value: string) =>
    !value.trim() || isValidSocialHandle(value) ? null : "Enter just the handle, like yourhandle";

/** `normalize(value)` for a filled-in handle, null for an empty one. */
const optionalHandle = (value: string, normalize: (handle: string) => string) =>
    value.trim() ? normalize(value) : null;

/**
 * Edit form for the member's own profile. The rules match onboarding: only
 * name, business name and location are required; bio, website and socials
 * are optional.
 */
export default function EditProfile({ photographer, handle: savedHandle }: EditProfileProps) {
    const router = useRouter();
    const { update: updateSession } = useSession();
    const updateProfile = api.photographer.update.useMutation();
    const updateHandle = api.user.updateProfile.useMutation();
    const [submitError, setSubmitError] = useState<string | null>(null);
    const nameParts = photographer.name.split(" ");

    const form = useForm<FormValues>({
        initialValues: {
            bio: photographer.bio ?? "",
            companyName: photographer.companyName,
            facebook: photographer.facebook ? normalizeFacebookHandle(photographer.facebook) : "",
            firstName: nameParts[0] ?? "",
            handle: savedHandle ?? "",
            instagram: photographer.instagram ? normalizeInstagramHandle(photographer.instagram) : "",
            lastName: nameParts.slice(1).join(" "),
            location: photographer.location,
            tiktok: photographer.tiktok ? normalizeTikTokHandle(photographer.tiktok) : "",
            twitter: photographer.twitter ? normalizeTwitterHandle(photographer.twitter) : "",
            vimeo: photographer.vimeo ? normalizeVimeoHandle(photographer.vimeo) : "",
            website: photographer.website ?? "",
            youtube: photographer.youtube ? normalizeYouTubeHandle(photographer.youtube) : "",
        },
        validate: {
            bio: (value) =>
                value.length > MAX_BIO_LENGTH ? `Keep your bio under ${MAX_BIO_LENGTH} characters` : null,
            companyName: (value) => {
                if (!value.trim()) return "Enter your business name";
                return value.length > 100 ? "Keep your business name under 100 characters" : null;
            },
            facebook: handleError,
            firstName: (value) => (value.trim() ? null : "Enter your first name"),
            handle: (value) => {
                // A username cannot be removed once set: links to the public profile use it.
                if (savedHandle && !normalizeHandle(value)) return "Enter a username, or keep your current one";
                return validateHandle(value);
            },
            instagram: (value) =>
                !value.trim() || isValidInstagramHandle(value)
                    ? null
                    : "Enter just the handle, like yourhandle",
            lastName: (value) => (value.trim() ? null : "Enter your last name"),
            location: (value) => (value.trim() ? null : "Enter your location"),
            tiktok: handleError,
            twitter: handleError,
            vimeo: handleError,
            website: (value) =>
                parseOptionalWebsite(value).ok ? null : "Enter a web address, like yoursite.com",
            youtube: handleError,
        },
    });

    const handleSubmit = form.onSubmit(async (values) => {
        setSubmitError(null);
        const website = parseOptionalWebsite(values.website);
        const handle = normalizeHandle(values.handle);
        if (handle && handle !== savedHandle) {
            try {
                await updateHandle.mutateAsync({ handle });
            } catch (error) {
                logger.error("Username update failed", { error });
                const refusal = refusedHandleMessage(handle, {
                    code: trpcErrorCode(error),
                    invalidFields: zodErrorFields(error),
                });
                if (refusal) {
                    form.setFieldError("handle", refusal);
                    setSubmitError("That username can't be used. Nothing was saved — choose a different one.");
                } else {
                    setSubmitError(userFacingError(error, "We couldn't save your profile. Your changes are still here — please try again."));
                }
                return;
            }
        }
        try {
            await updateProfile.mutateAsync({
                bio: values.bio.trim() || null,
                companyName: values.companyName.trim(),
                facebook: optionalHandle(values.facebook, normalizeFacebookHandle),
                firstName: values.firstName.trim(),
                id: photographer.id,
                instagram: optionalHandle(values.instagram, normalizeInstagramHandle),
                lastName: values.lastName.trim(),
                location: values.location.trim(),
                tiktok: optionalHandle(values.tiktok, normalizeTikTokHandle),
                twitter: optionalHandle(values.twitter, normalizeTwitterHandle),
                vimeo: optionalHandle(values.vimeo, normalizeVimeoHandle),
                website: website.ok ? website.value : null,
                youtube: optionalHandle(values.youtube, normalizeYouTubeHandle),
            });
        } catch (error) {
            // Keep the form (and everything typed into it) and explain inline.
            logger.error("Profile update failed", { error });
            const fieldErrors = zodFieldErrors(error);
            if (Object.keys(fieldErrors).length > 0) {
                form.setErrors(fieldErrors);
                setSubmitError("Some details need another look. Check the highlighted fields.");
            } else {
                setSubmitError(userFacingError(error, "We couldn't save your profile. Your changes are still here — please try again."));
            }
            return;
        }

        // The header shows the member's name from the session.
        await updateSession().catch((error: unknown) =>
            logger.error("Session refresh failed after profile update", { error }),
        );
        notify.success({ message: "Your changes are live.", title: "Profile updated" });
        router.push("/app/profile");
        router.refresh();
    });

    const isSaving = updateProfile.isPending || updateHandle.isPending;
    const typedHandle = normalizeHandle(form.values.handle);

    return (
        <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md" maw={720}>
                <Title order={1} size="h2" c="orange.7">Edit profile</Title>

                {/* Always rendered so screen readers announce errors as they appear. */}
                <div role="alert">
                    {submitError && (
                        <Alert color="red" icon={<IconAlertCircle size={16} />} data-testid="edit-profile-error">
                            {submitError}
                        </Alert>
                    )}
                </div>

                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
                    <TextInput
                        label="First name"
                        autoComplete="given-name"
                        required
                        {...form.getInputProps("firstName")}
                    />
                    <TextInput
                        label="Last name"
                        autoComplete="family-name"
                        required
                        {...form.getInputProps("lastName")}
                    />
                </SimpleGrid>
                <TextInput
                    label="Business name"
                    placeholder="Jane Smith Photography"
                    autoComplete="organization"
                    required
                    {...form.getInputProps("companyName")}
                />
                <TextInput
                    label="Username"
                    description={
                        typedHandle && !validateHandle(typedHandle)
                            ? `Your public profile: ${publicProfileUrl(env.NEXT_PUBLIC_BASE_URL, typedHandle)}`
                            : `${HANDLE_MIN_LENGTH} to ${HANDLE_MAX_LENGTH} lowercase letters, numbers or underscores. It becomes your public profile link.`
                    }
                    placeholder="yourname"
                    leftSection={<Text size="sm" c="dimmed" aria-hidden>@</Text>}
                    autoCapitalize="none"
                    autoComplete="username"
                    spellCheck={false}
                    {...form.getInputProps("handle")}
                    onBlur={() => form.validateField("handle")}
                />
                <Textarea
                    label="Bio"
                    description={`Optional. ${form.values.bio.length}/${MAX_BIO_LENGTH} characters`}
                    placeholder="What you shoot, how you work, what you're looking for…"
                    autosize
                    minRows={3}
                    maxRows={8}
                    {...form.getInputProps("bio")}
                />
                <LocationAutocomplete
                    isRequired
                    label="Location"
                    placeholder="City, State"
                    {...form.getInputProps("location")}
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

                <Title order={2} size="h5" mt="xs">
                    Social links
                </Title>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <SocialHandleInput label="Instagram" prefix="instagram.com/" {...form.getInputProps("instagram")} />
                    <SocialHandleInput label="Facebook" prefix="facebook.com/" {...form.getInputProps("facebook")} />
                    <SocialHandleInput label="Twitter / X" prefix="x.com/" {...form.getInputProps("twitter")} />
                    <SocialHandleInput label="YouTube" prefix="youtube.com/@" {...form.getInputProps("youtube")} />
                    <SocialHandleInput label="TikTok" prefix="tiktok.com/@" {...form.getInputProps("tiktok")} />
                    <SocialHandleInput label="Vimeo" prefix="vimeo.com/" {...form.getInputProps("vimeo")} />
                </SimpleGrid>

                <Group mt="xs">
                    <Button type="submit" loading={isSaving}>Save changes</Button>
                    <Button variant="default" component={Link} href="/app/profile" replace disabled={isSaving}>
                        Cancel
                    </Button>
                </Group>
            </Stack>
        </form>
    )
}
