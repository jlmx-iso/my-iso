"use client";

import { Button, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { type Photographer } from "@prisma/client";
import { IconCheck } from "@tabler/icons-react";
import { zod4Resolver } from 'mantine-form-zod-resolver';
import Link from "next/link";
import { redirect } from 'next/navigation';
import { z } from "zod";

import { Loader } from "../Loader";

import { LocationAutocomplete } from "~/app/_components/LocationAutocomplete";
import { api } from "~/trpc/react";


type EditProfileProps = {
    photographer: Photographer;
}

const schema = z.object({
    bio: z.string().min(1).max(1000, "Bio must be between 0 and 1000 characters"),
    companyName: z.string().max(100, "Company name must be between 0 and 100 characters"),
    facebook: z.string().url().includes("facebook.com", { message: "Not a valid Facebook URL" }).nullable(),
    instagram: z.string().url().includes("instagram.com", { message: "Not a valid Instagram URL" }).nullable(),
    location: z.string().max(100),
    tiktok: z.string().url().includes("tiktok.com", { message: "Not a valid TikTok URL" }).nullable(),
    twitter: z.string().url().includes("x.com", { message: "Not a valid X URL" }).or(z.string().url().includes("twitter.com", { message: "Not a valid X URL" })).nullable(),
    vimeo: z.string().url().includes("vimeo.com", { message: "Not a valid Vimeo URL" }).nullable(),
    website: z.string().url("Website must be a valid URL"),
    youtube: z.string().url().includes("youtube.com", { message: "Not a valid YouTube URL" }).nullable(),
});

export default function EditProfile({ photographer }: EditProfileProps) {
    const { isError, error, isPending, mutate, isSuccess } = api.photographer.update.useMutation();
    const form = useForm({
        initialValues: {
            bio: photographer.bio,
            companyName: photographer.companyName,
            facebook: photographer.facebook,
            instagram: photographer.instagram,
            location: photographer.location,
            name: photographer.name,
            tiktok: photographer.tiktok,
            twitter: photographer.twitter,
            vimeo: photographer.vimeo,
            website: photographer.website,
            youtube: photographer.youtube,
        },
        mode: "uncontrolled",
        validate: zod4Resolver(schema),
    });

    const submitForm = (values: typeof form.values) => {
        mutate({ ...values, id: photographer.id });
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
                <TextInput
                    label="Name"
                    placeholder="Your full name"
                    required
                    key={form.key("name")}
                    {...form.getInputProps("name")}
                />
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
                    <TextInput
                        label="Facebook"
                        placeholder="https://facebook.com/..."
                        key={form.key("facebook")}
                        {...form.getInputProps("facebook")}
                    />
                    <TextInput
                        label="Instagram"
                        placeholder="https://instagram.com/..."
                        key={form.key("instagram")}
                        {...form.getInputProps("instagram")}
                    />
                </Group>
                <Group grow>
                    <TextInput
                        label="Twitter / X"
                        placeholder="https://x.com/..."
                        key={form.key("twitter")}
                        {...form.getInputProps("twitter")}
                    />
                    <TextInput
                        label="YouTube"
                        placeholder="https://youtube.com/..."
                        key={form.key("youtube")}
                        {...form.getInputProps("youtube")}
                    />
                </Group>
                <Group grow>
                    <TextInput
                        label="Vimeo"
                        placeholder="https://vimeo.com/..."
                        key={form.key("vimeo")}
                        {...form.getInputProps("vimeo")}
                    />
                    <TextInput
                        label="TikTok"
                        placeholder="https://tiktok.com/..."
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
