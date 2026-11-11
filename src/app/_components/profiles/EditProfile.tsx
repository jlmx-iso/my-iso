"use client";

import { Button, Group, Stack, Text, TextInput, Textarea, type TextInputProps } from "@mantine/core";
import { useForm } from "@mantine/form";
import { type Photographer } from "@prisma/client";
import { IconCheck } from "@tabler/icons-react";
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { useSession } from "next-auth/react";
import Link from "next/link";
import { redirect } from 'next/navigation';
import { z } from "zod";

import { Loader } from "../Loader";

import { isValidInstagramHandle, isValidSocialHandle, normalizeInstagramHandle, normalizeFacebookHandle, normalizeTwitterHandle, normalizeTikTokHandle, normalizeVimeoHandle, normalizeYouTubeHandle } from "~/_utils";
import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { api } from "~/trpc/react";


function SocialHandleInput({ prefix, ...props }: TextInputProps & { prefix: string }) {
    return (
        <TextInput
            placeholder="yourhandle"
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
}

const handleField = z.string().refine((v) => !v || isValidSocialHandle(v), "Enter a valid handle (e.g. yourhandle)").nullable();

const schema = z.object({
    bio: z.string().min(1).max(1000, "Bio must be between 0 and 1000 characters"),
    companyName: z.string().max(100, "Company name must be between 0 and 100 characters"),
    facebook: handleField,
    firstName: z.string().min(1, "First name is required"),
    instagram: z.string().refine((v) => !v || isValidInstagramHandle(v), "Enter a valid Instagram handle (e.g. yourhandle)").nullable(),
    lastName: z.string().min(1, "Last name is required"),
    location: z.string().max(100),
    tiktok: handleField,
    twitter: handleField,
    vimeo: handleField,
    website: z.string().url("Website must be a valid URL"),
    youtube: handleField,
});

export default function EditProfile({ photographer }: EditProfileProps) {
    const { update: updateSession } = useSession();
    const { isError, error, isPending, mutateAsync, isSuccess } = api.photographer.update.useMutation();
    const nameParts = photographer.name.split(" ");
    const form = useForm({
        initialValues: {
            bio: photographer.bio,
            companyName: photographer.companyName,
            facebook: photographer.facebook ? normalizeFacebookHandle(photographer.facebook) : photographer.facebook,
            firstName: nameParts[0] ?? "",
            instagram: photographer.instagram ? normalizeInstagramHandle(photographer.instagram) : photographer.instagram,
            lastName: nameParts.slice(1).join(" ") || "",
            location: photographer.location,
            tiktok: photographer.tiktok ? normalizeTikTokHandle(photographer.tiktok) : photographer.tiktok,
            twitter: photographer.twitter ? normalizeTwitterHandle(photographer.twitter) : photographer.twitter,
            vimeo: photographer.vimeo ? normalizeVimeoHandle(photographer.vimeo) : photographer.vimeo,
            website: photographer.website,
            youtube: photographer.youtube ? normalizeYouTubeHandle(photographer.youtube) : photographer.youtube,
        },
        mode: "uncontrolled",
        validate: zod4Resolver(schema),
    });

    const submitForm = async (values: typeof form.values) => {
        await mutateAsync({
            ...values,
            id: photographer.id,
            facebook: values.facebook ? normalizeFacebookHandle(values.facebook) : values.facebook,
            instagram: values.instagram ? normalizeInstagramHandle(values.instagram) : values.instagram,
            tiktok: values.tiktok ? normalizeTikTokHandle(values.tiktok) : values.tiktok,
            twitter: values.twitter ? normalizeTwitterHandle(values.twitter) : values.twitter,
            vimeo: values.vimeo ? normalizeVimeoHandle(values.vimeo) : values.vimeo,
            youtube: values.youtube ? normalizeYouTubeHandle(values.youtube) : values.youtube,
        });
        await updateSession();
    }

    if (isPending) return <Loader />;

    if (isError) {
        return (
            <Stack align="center" gap="sm" py="xl">
                <Text fw={500} c="red">Failed to update profile</Text>
                <Text size="sm" c="dimmed">{error.message}</Text>
            </Stack>
        );
    }

    if (isSuccess) {
        return redirect("/app/profile?success=true");
    }

    return (
        <form onSubmit={form.onSubmit(submitForm)}>
            <Stack gap="md">
                <Group grow>
                    <TextInput
                        label="First Name"
                        placeholder="First name"
                        required
                        key={form.key("firstName")}
                        {...form.getInputProps("firstName")}
                    />
                    <TextInput
                        label="Last Name"
                        placeholder="Last name"
                        required
                        key={form.key("lastName")}
                        {...form.getInputProps("lastName")}
                    />
                </Group>
                <TextInput
                    label="Company Name"
                    placeholder="Your business name"
                    required
                    key={form.key("companyName")}
                    {...form.getInputProps("companyName")}
                />
                <Textarea
                    label="Bio"
                    placeholder="Tell us about yourself..."
                    required
                    autosize
                    minRows={3}
                    maxRows={6}
                    key={form.key("bio")}
                    {...form.getInputProps("bio")}
                />
                <LocationAutocomplete
                    isRequired
                    label="Location"
                    placeholder="City, State"
                    required
                    key={form.key("location")}
                    {...form.getInputProps("location")}
                />
                <TextInput
                    label="Website"
                    placeholder="https://yoursite.com"
                    required
                    key={form.key("website")}
                    {...form.getInputProps("website")}
                />

                <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }} mt="xs">
                    Social Links
                </Text>
                <Group grow>
                    <SocialHandleInput
                        label="Facebook"
                        prefix="facebook.com/"
                        key={form.key("facebook")}
                        {...form.getInputProps("facebook")}
                    />
                    <SocialHandleInput
                        label="Instagram"
                        prefix="instagram.com/"
                        key={form.key("instagram")}
                        {...form.getInputProps("instagram")}
                    />
                </Group>
                <Group grow>
                    <SocialHandleInput
                        label="Twitter / X"
                        prefix="x.com/"
                        key={form.key("twitter")}
                        {...form.getInputProps("twitter")}
                    />
                    <SocialHandleInput
                        label="YouTube"
                        prefix="youtube.com/@"
                        key={form.key("youtube")}
                        {...form.getInputProps("youtube")}
                    />
                </Group>
                <Group grow>
                    <SocialHandleInput
                        label="Vimeo"
                        prefix="vimeo.com/"
                        key={form.key("vimeo")}
                        {...form.getInputProps("vimeo")}
                    />
                    <SocialHandleInput
                        label="TikTok"
                        prefix="tiktok.com/@"
                        key={form.key("tiktok")}
                        {...form.getInputProps("tiktok")}
                    />
                </Group>

                <Group mt="xs">
                    <Button type="submit">Save Changes</Button>
                    <Button variant="subtle" component={Link} href="/app/profile" replace>Cancel</Button>
                </Group>
            </Stack>
        </form>
    )
}
