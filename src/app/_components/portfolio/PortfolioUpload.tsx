"use client";

import {
  Button,
  Checkbox,
  Group,
  Image,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { type FileWithPath } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import { useState } from "react";

import { Dropzone } from "~/app/_components/input/Dropzone";
import { Modal } from "~/app/_components/Modal";
import { logger } from "~/_utils";
import { api } from "~/trpc/react";

type PortfolioUploadProps = {
  onSuccess?: () => void;
};

export default function PortfolioUpload({ onSuccess }: PortfolioUploadProps) {
  const [files, setFiles] = useState<FileWithPath[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadMutation = api.photographer.addPortfolioImage.useMutation();

  const form = useForm({
    initialValues: {
      title: "",
      description: "",
      tags: [] as string[],
      isFeatured: false,
    },
  });

  const handleFileChange = (newFiles: FileWithPath[]) => {
    setFiles(newFiles);
  };

  const handleUpload = async () => {
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file) return;

    setUploading(true);

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64File = reader.result?.toString().split(",")[1];

      if (!base64File) {
        setUploading(false);
        return;
      }

      try {
        await uploadMutation.mutateAsync({
          image: base64File,
          title: form.values.title,
          description: form.values.description || undefined,
          tags: form.values.tags,
          isFeatured: form.values.isFeatured,
        });

        notifications.show({
          title: "Image Uploaded",
          message: "Your portfolio image has been added successfully.",
          color: "green",
        });

        // Reset form
        form.reset();
        setFiles(null);
        setUploading(false);
        onSuccess?.();
      } catch (error) {
        logger.error("Error uploading portfolio image", { error });
        notifications.show({
          title: "Upload Failed",
          message: "Failed to upload image. Please try again.",
          color: "red",
        });
        setUploading(false);
      }
    };

    reader.readAsDataURL(file);
  };

  const previews = files?.map((file, index) => {
    const imageUrl = URL.createObjectURL(file);
    return (
      <Image
        key={index}
        src={imageUrl}
        onLoad={() => URL.revokeObjectURL(imageUrl)}
        radius="md"
      />
    );
  });

  return (
    <Modal
      title="Upload Portfolio Image"
      isIconModal={false}
      buttonLabel={<><IconUpload size={16} /> Upload Image</>}
      buttonProps={{
        variant: "light",
      }}
    >
      <Stack gap="md">
        <Dropzone
          multiple={false}
          loading={uploading}
          handleFileChange={handleFileChange}
        />

        {previews && previews.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs">
            {previews}
          </SimpleGrid>
        )}

        <TextInput
          label="Title"
          placeholder="Give your image a title"
          required
          {...form.getInputProps("title")}
        />

        <Textarea
          label="Description"
          placeholder="Describe this image (optional)"
          autosize
          minRows={2}
          maxRows={4}
          {...form.getInputProps("description")}
        />

        <TagsInput
          label="Tags"
          placeholder="Type a tag and press Enter"
          data={[
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
          ]}
          {...form.getInputProps("tags")}
        />

        <Checkbox
          label="Feature this image"
          description="Featured images appear at the top of your portfolio"
          {...form.getInputProps("isFeatured", { type: "checkbox" })}
        />

        <Group mt="xs">
          <Button
            onClick={handleUpload}
            disabled={!files?.length || !form.values.title}
            loading={uploading}
          >
            Upload
          </Button>
          <Text size="xs" c="dimmed">
            Max file size: 5MB
          </Text>
        </Group>
      </Stack>
    </Modal>
  );
}
