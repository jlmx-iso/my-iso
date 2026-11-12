"use client";

import { ActionIcon, Box, Button, Group, Modal, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCamera } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import { logger } from "~/_utils/logger";
import { userFacingError } from "~/_utils/userError";
import { ImagePicker } from "~/app/_components/input/ImagePicker";
import { readFileAsBase64 } from "~/app/_lib/readFile";
import { api } from "~/trpc/react";

import { Avatar } from "../Avatar";

type ProfileAvatarProps = {
    avatar: string | null;
    /** The owner gets a button to change the photo. */
    isSelf: boolean;
    name: string;
    size: number;
};

function ChangePhotoButton() {
    const [opened, { close, open }] = useDisclosure(false);
    const [file, setFile] = useState<File | null>(null);
    const [isReading, setIsReading] = useState(false);
    const uploadImage = api.photographer.uploadProfileImage.useMutation();
    const { update: updateSession } = useSession();
    const router = useRouter();
    const isSaving = isReading || uploadImage.isPending;

    const handleClose = () => {
        if (isSaving) return;
        close();
        setFile(null);
    };

    const handleUpload = async () => {
        if (!file) return;
        setIsReading(true);
        try {
            const image = await readFileAsBase64(file);
            await uploadImage.mutateAsync({ image });
            // Refresh the session so the header avatar updates, then the
            // server-rendered profile.
            await updateSession();
            router.refresh();
            close();
            setFile(null);
            notifications.show({
                color: "teal",
                message: "Your new photo is live across ISO.",
                title: "Profile photo updated",
            });
        } catch (error) {
            logger.error("Error uploading profile avatar", { error });
            notifications.show({
                color: "red",
                message: userFacingError(error, "We couldn't upload that photo. Please try again."),
                title: "Upload failed",
            });
        } finally {
            setIsReading(false);
        }
    };

    return (
        <>
            {/* Always visible (not hover-only) so it works on touch screens. */}
            <ActionIcon
                onClick={open}
                pos="absolute"
                bottom={0}
                right={0}
                size="lg"
                radius="xl"
                variant="filled"
                aria-label="Change profile photo"
                style={{ border: "2px solid var(--mantine-color-body)" }}
            >
                <IconCamera size={18} />
            </ActionIcon>
            <Modal
                opened={opened}
                onClose={handleClose}
                title="Change profile photo"
                closeOnClickOutside={!isSaving}
                closeOnEscape={!isSaving}
            >
                <Stack gap="md">
                    <ImagePicker
                        file={file}
                        onChange={setFile}
                        label="Profile photo"
                        disabled={isSaving}
                        previewRadius="50%"
                    />
                    <Group justify="flex-end">
                        <Button variant="default" onClick={handleClose} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button onClick={() => void handleUpload()} disabled={!file} loading={isSaving}>
                            Save photo
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}

export default function ProfileAvatar({ isSelf, avatar, name, size }: ProfileAvatarProps) {
    return (
        <Box pos="relative" w={size} h={size}>
            <Avatar src={avatar} name={name} alt={`${name}'s profile photo`} size={size} />
            {isSelf && <ChangePhotoButton />}
        </Box>
    );
}
