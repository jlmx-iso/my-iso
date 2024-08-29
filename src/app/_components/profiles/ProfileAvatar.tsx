"use client";

import { Box, Button, Image, SimpleGrid } from '@mantine/core';
import { type FileWithPath } from '@mantine/dropzone';
import { useHover } from '@mantine/hooks';
import { IconUpload } from '@tabler/icons-react';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Modal, Dropzone } from '~/app/_components';
import colors from '~/app/theme/colors';
import { api } from '~/trpc/react';

import { Avatar } from '../../_server_components/Avatar';

type AvatarProps = {
    isSelf: boolean;
    avatar: string | null;
    name: string;
};

export default function ProfileAvatar({ isSelf, avatar, name }: AvatarProps) {
    const { hovered, ref } = useHover();
    const [uploading, setUploading] = useState(false);
    const [files, setFiles] = useState<FileWithPath[] | null>(null);
    const uploadImage = api.photographer.uploadProfileImage.useMutation();
    const router = useRouter();

    const handleFileChange = (files: FileWithPath[]) => {
        setFiles(files);
    };

    const handleImageUpload = () => {
        if (!files) return;
        const file = files[0];
        if (!file) return;
        setUploading(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64File = reader.result?.toString().split(',')[1]; // Get base64 string without the prefix

            if (base64File) {
                try {
                    await uploadImage.mutateAsync({
                        image: base64File,
                    });
                } catch (error) {
                    console.error('Error uploading image:', error);
                } finally {
                    setFiles(null);
                    setUploading(false);
                    router.push('/app/profile');
                }
            }
        };

        reader.readAsDataURL(file); // Convert file to base64
    }

    const previews = files?.map((file, index) => {
        const imageUrl = URL.createObjectURL(file);
        return <Image key={index} src={imageUrl} onLoad={() => URL.revokeObjectURL(imageUrl)} />;
    });

    if (isSelf) {
        return (
            <Box ref={ref} w={120} h={120} style={{ position: "relative" }}>
                <Modal
                    title="Upload Image"
                    isIconModal={true}
                    actionIconProps={{
                        color: colors.gray![0],
                        size: "xl",
                        variant: "subtle",
                        opacity: hovered ? 1 : 0,
                        pos: "absolute",
                        top: "50%",
                        left: "50%",
                        w: 120,
                        h: 120,
                        radius: "50%",
                        style: {
                            transform: "translate(-50%, -50%)",
                            zIndex: 9999,
                        },
                    }}
                    icon={<IconUpload />}>
                    <Dropzone multiple={false} loading={uploading} handleFileChange={handleFileChange} />
                    <SimpleGrid cols={{ base: 1, sm: 4 }} mt={previews?.length ? 'xl' : 0}>
                        {previews}
                    </SimpleGrid>
                    <Button mt="lg" onClick={handleImageUpload} disabled={!files?.length}>
                        Upload
                    </Button>
                </Modal>
                <Avatar src={avatar} name={name} />
            </Box>
        )
    }
    return (
        <Avatar src={avatar} name={name} />
    )
}