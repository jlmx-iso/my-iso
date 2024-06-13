"use client";

import { useForm } from "@mantine/form";
import { zodResolver } from 'mantine-form-zod-resolver';
import { z } from "zod";
import { Loader } from "..";
import { Textarea, TextInput } from "@mantine/core";
import { type Photographer } from "@prisma/client";

type EditProfileProps = {
    photographer: Photographer;
}

const schema = z.object({
    bio: z.string().max(1000, "Bio must be between 0 and 1000 characters"),
    companyName: z.string().max(100, "Company name must be between 0 and 100 characters"),
    website: z.string().url("Website must be a valid URL"),
    location: z.string().max(100),
    facebook: z.string().url().includes("facebook.com", { message: "Not a valid Facebook URL" }).optional(),
    instagram: z.string().url().includes("instagram.com", { message: "Not a valid Instagram URL" }).optional(),
    twitter: z.string().url().includes("x.com", { message: "Not a valid X URL" }).or(z.string().url().includes("twitter.com", { message: "Not a valid X URL" })).optional(),
    youtube: z.string().url().includes("youtube.com", { message: "Not a valid YouTube URL" }).optional(),
    vimeo: z.string().url().includes("vimeo.com", { message: "Not a valid Vimeo URL" }).optional(),
    tiktok: z.string().url().includes("tiktok.com", { message: "Not a valid TikTok URL" }).optional(),
});

export default function EditProfile({ photographer }: EditProfileProps) {
    const form = useForm({
        mode: "uncontrolled",
        initialValues: {
            name: photographer?.name,
            companyName: photographer?.companyName,
            bio: photographer?.bio,
            location: photographer?.location,
            website: photographer?.website,
            facebook: photographer?.facebook,
            instagram: photographer?.instagram,
            twitter: photographer?.twitter,
            youtube: photographer?.youtube,
            vimeo: photographer?.vimeo,
            tiktok: photographer?.tiktok,
        },
        validate: zodResolver(schema),
    });

    const submitForm = (values: typeof form.values) => {
        // eslint-disable-next-line no-console
        console.log(values);
    }

    return (
        <form onSubmit={form.onSubmit(submitForm)}>
            <TextInput
                label="Name"
                placeholder="Name"
                required
                key={form.key("name")}
                {...form.getInputProps("name")}
            />
            <TextInput
                label="Company Name"
                placeholder="Company Name"
                required
                key={form.key("companyName")}
                {...form.getInputProps("companyName")}
            />
            <Textarea
                label="Bio"
                placeholder="Bio"
                required
                key={form.key("bio")}
                {...form.getInputProps("bio")}
            />
            <TextInput
                label="Location"
                placeholder="Location"
                required
                key={form.key("location")}
                {...form.getInputProps("location")}
            />
            <TextInput
                label="Website"
                placeholder="Website"
                required
                key={form.key("website")}
                {...form.getInputProps("website")}
            />
            <TextInput
                label="Facebook"
                placeholder="Facebook"
                key={form.key("facebook")}
                {...form.getInputProps("facebook")}
            />
            <TextInput
                label="Instagram"
                placeholder="Instagram"
                key={form.key("instagram")}
                {...form.getInputProps("instagram")}
            />
            <TextInput
                label="Twitter"
                placeholder="Twitter"
                key={form.key("twitter")}
                {...form.getInputProps("twitter")}
            />
            <TextInput
                label="YouTube"
                placeholder="YouTube"
                key={form.key("youtube")}
                {...form.getInputProps("youtube")}
            />
            <TextInput
                label="Vimeo"
                placeholder="Vimeo"
                key={form.key("vimeo")}
                {...form.getInputProps("vimeo")}
            />
            <TextInput
                label="TikTok"
                placeholder="TikTok"
                key={form.key("tiktok")}
                {...form.getInputProps("tiktok")}
            />
            <button type="submit">Submit</button>
        </form>
    )
}