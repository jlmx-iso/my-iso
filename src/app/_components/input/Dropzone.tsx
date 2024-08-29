"use client";

import { Group, Text, rem } from '@mantine/core';
import { IconUpload, IconPhoto, IconX } from '@tabler/icons-react';
import { Dropzone as MantineDropzone, type DropzoneProps as MantineDropzoneProps, IMAGE_MIME_TYPE, type FileWithPath } from '@mantine/dropzone';

type DropzoneProps = Partial<MantineDropzoneProps> & {
    handleFileChange: (files: FileWithPath[]) => void;
};

export function Dropzone({ handleFileChange, ...props }: DropzoneProps) {

    const handleFileDrop = (files: FileWithPath[]) => {
        handleFileChange(files);
    }

    return (
        <>
            <MantineDropzone
                onDrop={handleFileDrop}
                maxSize={5 * 1024 ** 2}
                accept={IMAGE_MIME_TYPE}
                maxFiles={1}
                {...props}
            >
                <Group justify="center" gap="xl" mih={220} style={{ pointerEvents: 'none' }}>
                    <MantineDropzone.Accept>
                        <IconUpload
                            style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-blue-6)' }}
                            stroke={1.5}
                        />
                    </MantineDropzone.Accept>
                    <MantineDropzone.Reject>
                        <IconX
                            style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-red-6)' }}
                            stroke={1.5}
                        />
                    </MantineDropzone.Reject>
                    <MantineDropzone.Idle>
                        <IconPhoto
                            style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-dimmed)' }}
                            stroke={1.5}
                        />
                    </MantineDropzone.Idle>

                    <div>
                        <Text size="xl" inline>
                            Drag image here or click to select file
                        </Text>
                        <Text size="sm" c="dimmed" inline mt={7}>
                            File size should not exceed 5mb
                        </Text>
                    </div>
                </Group>
            </MantineDropzone>
        </>
    );
}