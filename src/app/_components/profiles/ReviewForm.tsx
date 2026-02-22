"use client";

import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { useState } from "react";

import { api } from "~/trpc/react";

type ReviewFormProps = {
  photographerId: string;
  onSuccess?: () => void;
};

function RatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <Group gap={4}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hovered || value);
        return (
          <ActionIcon
            key={star}
            variant="transparent"
            color={filled ? "yellow" : "gray"}
            size="lg"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(star)}
            aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
          >
            {filled ? (
              <IconStarFilled size={24} />
            ) : (
              <IconStar size={24} />
            )}
          </ActionIcon>
        );
      })}
      {value > 0 && (
        <Text size="sm" c="dimmed" ml="xs">
          {value} / 5
        </Text>
      )}
    </Group>
  );
}

export default function ReviewForm({
  photographerId,
  onSuccess,
}: ReviewFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const createReview = api.review.create.useMutation();

  const form = useForm({
    initialValues: {
      rating: 0,
      title: "",
      description: "",
    },
    validate: {
      rating: (value) => (value < 1 || value > 5 ? "Please select a rating" : null),
      title: (value) => (value.trim().length === 0 ? "Title is required" : null),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    setSubmitting(true);

    try {
      await createReview.mutateAsync({
        photographerId,
        rating: values.rating,
        title: values.title,
        description: values.description || undefined,
      });

      notifications.show({
        title: "Review Submitted",
        message: "Thank you for your review!",
        color: "green",
      });

      form.reset();
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit review";
      notifications.show({
        title: "Error",
        message,
        color: "red",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper p="lg" radius="md" withBorder>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Text size="sm" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
            Leave a Review
          </Text>

          <div>
            <Text size="sm" fw={500} mb={4}>
              Rating
            </Text>
            <RatingInput
              value={form.values.rating}
              onChange={(rating) => form.setFieldValue("rating", rating)}
            />
            {form.errors.rating && (
              <Text size="xs" c="red" mt={4}>
                {form.errors.rating}
              </Text>
            )}
          </div>

          <TextInput
            label="Title"
            placeholder="Summarize your experience"
            required
            {...form.getInputProps("title")}
          />

          <Textarea
            label="Description"
            placeholder="Tell others about your experience (optional)"
            autosize
            minRows={3}
            maxRows={6}
            {...form.getInputProps("description")}
          />

          <Group>
            <Button type="submit" loading={submitting}>
              Submit Review
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
