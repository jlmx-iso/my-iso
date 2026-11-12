"use client";

import { Button, type ButtonProps, Checkbox, Group, Modal, Stack, TagsInput, TextInput, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import { useState } from "react";

import { logger } from "~/_utils/logger";
import { userFacingError } from "~/_utils/userError";
import { ImagePicker } from "~/app/_components/input/ImagePicker";
import { readFileAsBase64 } from "~/app/_lib/readFile";
import { api } from "~/trpc/react";

export const PORTFOLIO_TAG_SUGGESTIONS = [
  "Wedding",
  "Portrait",
  "Landscape",
  "Street",
  "Fashion",
  "Event",
  "Product",
  "Architecture",
  "Nature",
  "Sports",
];

type PortfolioUploadProps = {
  /** Called after the image is saved, to refresh whatever shows the portfolio. */
  onUploaded: () => void;
  buttonProps?: ButtonProps;
};

type FormValues = {
  description: string;
  isFeatured: boolean;
  tags: string[];
  title: string;
};

/** "Upload image" button and the modal form behind it. */
export default function PortfolioUpload({ onUploaded, buttonProps }: PortfolioUploadProps) {
  const [opened, { close, open }] = useDisclosure(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const upload = api.photographer.addPortfolioImage.useMutation();
  const isSaving = isReading || upload.isPending;

  const form = useForm<FormValues>({
    initialValues: { description: "", isFeatured: false, tags: [], title: "" },
    validate: {
      description: (value) => (value.length > 1000 ? "Keep the description under 1000 characters" : null),
      title: (value) => {
        if (!value.trim()) return "Give the image a title";
        return value.length > 200 ? "Keep the title under 200 characters" : null;
      },
    },
  });

  const reset = () => {
    form.reset();
    setFile(null);
    setFileError(null);
  };

  const handleClose = () => {
    if (isSaving) return;
    close();
    reset();
  };

  const handleSubmit = form.onSubmit(async (values) => {
    if (!file) {
      setFileError("Choose an image to upload");
      return;
    }
    setFileError(null);
    setIsReading(true);
    try {
      const image = await readFileAsBase64(file);
      await upload.mutateAsync({
        description: values.description.trim() || undefined,
        image,
        isFeatured: values.isFeatured,
        tags: values.tags,
        title: values.title.trim(),
      });
      notifications.show({
        color: "teal",
        message: `"${values.title.trim()}" is now in your portfolio.`,
        title: "Image uploaded",
      });
      close();
      reset();
      onUploaded();
    } catch (error) {
      logger.error("Error uploading portfolio image", { error });
      notifications.show({
        color: "red",
        message: userFacingError(error, "We couldn't upload that image. Please try again."),
        title: "Upload failed",
      });
    } finally {
      setIsReading(false);
    }
  });

  return (
    <>
      <Button variant="light" leftSection={<IconUpload size={16} />} onClick={open} {...buttonProps}>
        Upload image
      </Button>
      <Modal
        opened={opened}
        onClose={handleClose}
        title="Upload portfolio image"
        closeOnClickOutside={!isSaving}
        closeOnEscape={!isSaving}
      >
        <form onSubmit={handleSubmit} noValidate>
          <Stack gap="md">
            <ImagePicker
              file={file}
              onChange={(next) => {
                setFile(next);
                setFileError(null);
              }}
              label="Portfolio image"
              disabled={isSaving}
              error={fileError}
            />
            <TextInput
              label="Title"
              placeholder="Give your image a title"
              required
              maxLength={200}
              {...form.getInputProps("title")}
            />
            <Textarea
              label="Description"
              description="Optional"
              placeholder="Describe this image"
              autosize
              minRows={2}
              maxRows={4}
              {...form.getInputProps("description")}
            />
            <TagsInput
              label="Tags"
              description="Optional. Pick from the list or type your own and press Enter."
              placeholder="Add a tag"
              data={PORTFOLIO_TAG_SUGGESTIONS}
              {...form.getInputProps("tags")}
            />
            <Checkbox
              label="Feature this image"
              description="Featured images appear at the top of your portfolio"
              {...form.getInputProps("isFeatured", { type: "checkbox" })}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={handleClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" loading={isSaving}>
                Upload
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
