"use client";

import { Box, Button, Group, Image, Stack, Text } from "@mantine/core";
import { type FileRejection, Dropzone } from "@mantine/dropzone";
import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  IMAGE_ACCEPT,
  IMAGE_TOO_LARGE_MESSAGE,
  IMAGE_TYPES_LABEL,
  IMAGE_WRONG_TYPE_MESSAGE,
  MAX_IMAGE_MB,
  imageFileError,
} from "~/_utils/imageFile";
import { MAX_IMAGE_BYTES } from "~/_utils/limits";

type ImagePickerProps = {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Accessible name of the drop area, e.g. "Portfolio image". */
  label: string;
  disabled?: boolean;
  /** Validation message from the surrounding form. */
  error?: string | null;
  /** Shape of the preview. */
  previewRadius?: "md" | "50%";
};

function describeRejection(rejections: FileRejection[]): string {
  const code = rejections[0]?.errors[0]?.code;
  if (code === "file-too-large") return IMAGE_TOO_LARGE_MESSAGE;
  if (code === "file-invalid-type") return IMAGE_WRONG_TYPE_MESSAGE;
  if (code === "too-many-files") return "Choose a single image.";
  return "That file can't be used. Choose a different image.";
}

/** Single-image picker: drop area (also keyboard and tap operable) with a preview. */
export function ImagePicker({ file, onChange, label, disabled, error, previewRadius = "md" }: ImagePickerProps) {
  const [rejection, setRejection] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const message = rejection ?? error ?? null;

  return (
    <Stack gap="xs">
      {file && previewUrl ? (
        // Wraps on a narrow phone: the button goes under the preview
        // instead of being cut off beside it.
        <Group wrap="wrap" align="center" gap="md">
          <Image
            data-replay-block
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            w={previewRadius === "50%" ? 120 : 160}
            h={120}
            fit="cover"
            radius={previewRadius}
            style={{ flexShrink: 0 }}
          />
          <Stack gap={6} style={{ flex: "1 1 180px", minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {file.name}
            </Text>
            <Button
              variant="default"
              size="sm"
              className="touch-target"
              w="fit-content"
              maw="100%"
              onClick={() => onChange(null)}
              disabled={disabled}
            >
              Choose a different image
            </Button>
          </Stack>
        </Group>
      ) : (
        <Dropzone
          onDrop={(files) => {
            const picked = files[0] ?? null;
            // Checked again here: some browsers report no type for a dropped
            // file, which the dropzone lets through.
            const problem = picked ? imageFileError(picked) : null;
            setRejection(problem);
            onChange(problem ? null : picked);
          }}
          onReject={(rejections) => setRejection(describeRejection(rejections))}
          maxSize={MAX_IMAGE_BYTES}
          accept={IMAGE_ACCEPT}
          maxFiles={1}
          multiple={false}
          disabled={disabled}
          aria-label={`${label}: choose an image`}
          inputProps={{ "aria-label": label }}
        >
          <Group justify="center" gap="md" mih={140} wrap="nowrap" style={{ pointerEvents: "none" }}>
            <Box c="dimmed" style={{ flexShrink: 0 }}>
              <Dropzone.Accept>
                <IconUpload size={40} stroke={1.5} color="var(--iso-success-icon)" aria-hidden />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={40} stroke={1.5} color="var(--mantine-color-red-6)" aria-hidden />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconPhoto size={40} stroke={1.5} aria-hidden />
              </Dropzone.Idle>
            </Box>
            <div>
              <Text fw={500}>Tap to choose an image, or drop one here</Text>
              <Text size="sm" c="dimmed" mt={4}>
                {IMAGE_TYPES_LABEL}, up to {MAX_IMAGE_MB} MB
              </Text>
            </div>
          </Group>
        </Dropzone>
      )}
      {/* Always rendered so screen readers announce validation as it appears. */}
      <div role="alert">
        {message && (
          <Text size="sm" c="red" data-testid="image-picker-error">
            {message}
          </Text>
        )}
      </div>
    </Stack>
  );
}
