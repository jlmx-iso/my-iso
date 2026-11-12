"use client";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Image,
  Modal,
  Paper,
  Popover,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconDots,
  IconEdit,
  IconStar,
  IconStarFilled,
  IconStarOff,
  IconTrash,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type MoveDirection, canMoveImage, moveImage, sortPortfolio } from "~/_utils/portfolioOrder";
import { userFacingError } from "~/_utils/userError";
import { type RouterOutputs, api } from "~/trpc/react";

import PortfolioUpload, { PORTFOLIO_TAG_SUGGESTIONS } from "./PortfolioUpload";

type PortfolioImage = RouterOutputs["photographer"]["getPortfolioImages"][number];

type PortfolioSectionProps = {
  photographerId: string;
  /** Server-fetched images, so the grid is in the first HTML. */
  initialImages?: PortfolioImage[];
  /** The owner can upload, edit, feature, reorder and delete. */
  isOwner: boolean;
};

function parseTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function Thumbnail({ image }: { image: PortfolioImage }) {
  // Track which src failed so a replaced image gets a fresh attempt.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  if (brokenSrc === image.image) {
    return (
      <Group justify="center" align="center" h="100%" bg="gray.1" c="gray.6">
        <IconCamera size={32} aria-hidden />
        <span className="sr-only">{image.title} (image unavailable)</span>
      </Group>
    );
  }
  return (
    <Image
      src={image.image}
      alt={image.title}
      h="100%"
      w="100%"
      fit="cover"
      loading="lazy"
      onError={() => setBrokenSrc(image.image)}
    />
  );
}

type CardProps = {
  image: PortfolioImage;
  isOwner: boolean;
  busy: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFeatured: () => void;
  onMove: (direction: MoveDirection) => void;
};

function PortfolioCard({
  image,
  isOwner,
  busy,
  canMoveEarlier,
  canMoveLater,
  onView,
  onEdit,
  onDelete,
  onToggleFeatured,
  onMove,
}: CardProps) {
  const [menuOpened, setMenuOpened] = useState(false);
  // A popover of plain buttons (a disclosure) rather than an ARIA menu.
  const actions = [
    { icon: <IconEdit size={16} />, label: "Edit details", onClick: onEdit },
    {
      icon: image.isFeatured ? <IconStarOff size={16} /> : <IconStar size={16} />,
      label: image.isFeatured ? "Remove from featured" : "Feature",
      onClick: onToggleFeatured,
    },
    { disabled: !canMoveEarlier, icon: <IconArrowLeft size={16} />, label: "Move earlier", onClick: () => onMove("earlier") },
    { disabled: !canMoveLater, icon: <IconArrowRight size={16} />, label: "Move later", onClick: () => onMove("later") },
    { danger: true, icon: <IconTrash size={16} />, label: "Delete", onClick: onDelete },
  ];

  return (
    <Box
      component="li"
      pos="relative"
      style={{
        aspectRatio: "1 / 1",
        borderRadius: "var(--mantine-radius-md)",
        listStyle: "none",
        overflow: "hidden",
      }}
      data-testid="portfolio-card"
    >
      <UnstyledButton
        onClick={onView}
        aria-label={`View ${image.title}`}
        w="100%"
        h="100%"
        display="block"
        style={{ outlineOffset: -3 }}
      >
        <Thumbnail image={image} />
      </UnstyledButton>

      {/* Caption: always visible, so it also works without hover. */}
      <Group
        pos="absolute"
        bottom={0}
        left={0}
        right={0}
        px="sm"
        pt="xl"
        pb="xs"
        gap={6}
        wrap="nowrap"
        style={{
          background: "linear-gradient(0deg, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 100%)",
          pointerEvents: "none",
        }}
        aria-hidden
      >
        {image.isFeatured && (
          <IconStarFilled size={14} color="var(--mantine-color-tan-3)" style={{ flexShrink: 0 }} />
        )}
        <Text size="sm" fw={600} c="white" truncate>
          {image.title}
        </Text>
      </Group>
      {image.isFeatured && <span className="sr-only">Featured</span>}

      {isOwner && (
        <Popover position="bottom-end" width={210} shadow="md" opened={menuOpened} onChange={setMenuOpened} trapFocus returnFocus>
          <Popover.Target>
            <ActionIcon
              pos="absolute"
              top={8}
              right={8}
              size="lg"
              radius="xl"
              color="dark"
              variant="filled"
              loading={busy}
              aria-label={`Actions for ${image.title}`}
              aria-expanded={menuOpened}
              onClick={() => setMenuOpened((current) => !current)}
            >
              <IconDots size={18} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown p={6} aria-label={`Actions for ${image.title}`}>
            <Stack gap={2}>
              {actions.map((action) => (
                <Button
                  key={action.label}
                  variant="subtle"
                  color={action.danger ? "red" : "gray"}
                  justify="flex-start"
                  fullWidth
                  leftSection={action.icon}
                  disabled={action.disabled}
                  onClick={() => {
                    setMenuOpened(false);
                    action.onClick();
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      )}
    </Box>
  );
}

type EditValues = { description: string; isFeatured: boolean; tags: string[]; title: string };

function EditImageForm({
  image,
  isSaving,
  onCancel,
  onSave,
}: {
  image: PortfolioImage;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (values: EditValues) => void;
}) {
  const form = useForm<EditValues>({
    initialValues: {
      description: image.description ?? "",
      isFeatured: image.isFeatured,
      tags: parseTags(image.tags),
      title: image.title,
    },
    validate: {
      description: (value) => (value.length > 1000 ? "Keep the description under 1000 characters" : null),
      title: (value) => (value.trim() ? null : "Give the image a title"),
    },
  });

  return (
    <form onSubmit={form.onSubmit(onSave)} noValidate>
      <Stack gap="md">
        <TextInput label="Title" required maxLength={200} {...form.getInputProps("title")} />
        <Textarea
          label="Description"
          description="Optional"
          autosize
          minRows={2}
          maxRows={4}
          {...form.getInputProps("description")}
        />
        <TagsInput
          label="Tags"
          description="Optional"
          placeholder="Add a tag"
          data={PORTFOLIO_TAG_SUGGESTIONS}
          {...form.getInputProps("tags")}
        />
        <Checkbox
          label="Feature this image"
          description="Featured images appear at the top of your portfolio"
          {...form.getInputProps("isFeatured", { type: "checkbox" })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** A photographer's portfolio grid, with management controls for its owner. */
export default function PortfolioSection({ photographerId, initialImages, isOwner }: PortfolioSectionProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const { data: images = [], isPending } = api.photographer.getPortfolioImages.useQuery(
    { photographerId },
    { initialData: initialImages },
  );
  const [viewing, setViewing] = useState<PortfolioImage | null>(null);
  const [editing, setEditing] = useState<PortfolioImage | null>(null);
  const [deleting, setDeleting] = useState<PortfolioImage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    await utils.photographer.getPortfolioImages.invalidate({ photographerId });
    // The cover banner above the grid is server-rendered from the same images.
    router.refresh();
  };

  const showError = (title: string, error: unknown, fallback: string) =>
    notifications.show({ color: "red", message: userFacingError(error, fallback), title });

  const updateImage = api.photographer.updatePortfolioImage.useMutation();
  const deleteImage = api.photographer.deletePortfolioImage.useMutation();
  const reorderImages = api.photographer.reorderPortfolioImages.useMutation();

  const sorted = sortPortfolio(images);

  const handleToggleFeatured = async (image: PortfolioImage) => {
    setBusyId(image.id);
    try {
      await updateImage.mutateAsync({ id: image.id, isFeatured: !image.isFeatured });
      await refresh();
      notifications.show({
        color: "teal",
        message: image.isFeatured
          ? `"${image.title}" is no longer featured.`
          : `"${image.title}" now appears at the top of your portfolio.`,
        title: image.isFeatured ? "Removed from featured" : "Image featured",
      });
    } catch (error) {
      showError("Couldn't update image", error, "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (index: number, direction: MoveDirection) => {
    const image = sorted[index];
    const order = moveImage(sorted, index, direction);
    if (!image || !order) return;
    setBusyId(image.id);
    try {
      await reorderImages.mutateAsync({ images: order });
      await refresh();
    } catch (error) {
      showError("Couldn't reorder images", error, "Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEdit = async (values: EditValues) => {
    if (!editing) return;
    try {
      await updateImage.mutateAsync({
        description: values.description.trim() || null,
        id: editing.id,
        isFeatured: values.isFeatured,
        tags: values.tags,
        title: values.title.trim(),
      });
      await refresh();
      setEditing(null);
      notifications.show({ color: "teal", message: "Your changes are live.", title: "Image updated" });
    } catch (error) {
      showError("Couldn't save changes", error, "Please try again.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteImage.mutateAsync({ id: deleting.id });
      await refresh();
      notifications.show({
        color: "teal",
        message: `"${deleting.title}" was removed from your portfolio.`,
        title: "Image deleted",
      });
      setDeleting(null);
    } catch (error) {
      showError("Couldn't delete image", error, "Please try again.");
    }
  };

  if (!isOwner && sorted.length === 0) {
    if (isPending) return null;
    return (
      <Stack gap="xs">
        <Title order={2} size="h4">
          Portfolio
        </Title>
        <Text c="dimmed" size="sm">
          This photographer hasn&apos;t added portfolio images yet.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" component="section" aria-labelledby="portfolio-heading">
      <Group justify="space-between" align="center">
        <Title order={2} size="h4" id="portfolio-heading">
          Portfolio
        </Title>
        {isOwner && sorted.length > 0 && <PortfolioUpload onUploaded={() => void refresh()} />}
      </Group>

      {sorted.length === 0 ? (
        <Paper p="xl" radius="md" withBorder style={{ borderStyle: "dashed" }}>
          <Stack align="center" gap="md" py="md">
            <IconCamera size={40} color="var(--mantine-color-gray-6)" stroke={1.5} aria-hidden />
            <Stack align="center" gap={4}>
              <Text fw={600}>Add your first portfolio image</Text>
              <Text size="sm" c="dimmed" ta="center" maw={320}>
                Leads look at your portfolio before they message you. Start with the work
                you&apos;re proudest of.
              </Text>
            </Stack>
            <PortfolioUpload onUploaded={() => void refresh()} buttonProps={{ variant: "filled" }} />
          </Stack>
        </Paper>
      ) : (
        <SimpleGrid
          component="ul"
          cols={{ base: 2, sm: 3 }}
          spacing={{ base: "xs", sm: "sm" }}
          m={0}
          p={0}
          aria-label="Portfolio images"
        >
          {sorted.map((image, index) => (
            <PortfolioCard
              key={image.id}
              image={image}
              isOwner={isOwner}
              busy={busyId === image.id}
              canMoveEarlier={canMoveImage(sorted, index, "earlier")}
              canMoveLater={canMoveImage(sorted, index, "later")}
              onView={() => setViewing(image)}
              onEdit={() => setEditing(image)}
              onDelete={() => setDeleting(image)}
              onToggleFeatured={() => void handleToggleFeatured(image)}
              onMove={(direction) => void handleMove(index, direction)}
            />
          ))}
        </SimpleGrid>
      )}

      <Modal opened={!!viewing} onClose={() => setViewing(null)} title={viewing?.title} size="xl" centered>
        {viewing && (
          <Stack gap="sm">
            <Image
              src={viewing.image}
              alt={viewing.title}
              mah="70dvh"
              fit="contain"
              radius="md"
              bg="gray.1"
            />
            {viewing.description && <Text size="sm">{viewing.description}</Text>}
            {parseTags(viewing.tags).length > 0 && (
              <Group gap={6}>
                {parseTags(viewing.tags).map((tag) => (
                  <Badge key={tag} variant="light" color="gray">
                    {tag}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!editing}
        onClose={() => !updateImage.isPending && setEditing(null)}
        title="Edit image details"
      >
        {editing && (
          <EditImageForm
            key={editing.id}
            image={editing}
            isSaving={updateImage.isPending}
            onCancel={() => setEditing(null)}
            onSave={(values) => void handleSaveEdit(values)}
          />
        )}
      </Modal>

      <Modal
        opened={!!deleting}
        onClose={() => !deleteImage.isPending && setDeleting(null)}
        title="Delete this image?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            &ldquo;{deleting?.title}&rdquo; will be removed from your portfolio. This can&apos;t be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteImage.isPending}>
              Keep image
            </Button>
            <Button color="red" onClick={() => void handleConfirmDelete()} loading={deleteImage.isPending}>
              Delete image
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
