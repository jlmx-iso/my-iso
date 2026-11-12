"use client";

import { Avatar, Box, Button, Group, Slider, Stack, Text } from "@mantine/core";
import { useEffect, useId, useMemo, useState } from "react";
import type { Area } from "react-easy-crop";
import Cropper from "react-easy-crop";

import { logger } from "~/_utils/logger";
import { ImagePicker } from "~/app/_components/input/ImagePicker";
import { notify } from "~/app/_lib/notify";

const OUTPUT_SIZE = 512;

type AvatarStepProps = {
  /** The cropped photo, ready to upload; null when none is chosen. */
  photo: File | null;
  onChange: (photo: File | null) => void;
  /**
   * Told when the crop view opens and closes. While it is open, "Use this
   * photo" is the step's one primary action: the form hides its own.
   */
  onCroppingChange?: (isCropping: boolean) => void;
  disabled?: boolean;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

/** Draws the selected square of `source` onto a canvas and returns it as a JPEG file. */
async function cropToFile(source: string, area: Area, name: string): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not load the selected image"));
    element.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Could not create the cropped image");
  return new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** Onboarding photo step: pick an image, crop it to a circle, preview it. */
export function AvatarStep({ photo, onChange, onCroppingChange, disabled }: AvatarStepProps) {
  const zoomLabelId = useId();
  const [source, setSource] = useState<{ dataUrl: string; name: string } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetCrop = () => {
    onCroppingChange?.(false);
    setSource(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
  };

  const handlePicked = async (file: File | null) => {
    if (!file) return;
    try {
      setSource({ dataUrl: await readAsDataUrl(file), name: file.name });
      onCroppingChange?.(true);
    } catch (error) {
      logger.error("Failed to read avatar file", { error });
      notify.error({
        message: "We couldn't read that file. Try a different image.",
        title: "Photo not loaded",
      });
    }
  };

  const applyCrop = async () => {
    if (!source || !area) return;
    setIsCropping(true);
    try {
      onChange(await cropToFile(source.dataUrl, area, source.name));
      resetCrop();
    } catch (error) {
      logger.error("Failed to crop image", { error });
      notify.error({
        message: "We couldn't crop that image. Try a different one.",
        title: "Photo not cropped",
      });
    } finally {
      setIsCropping(false);
    }
  };

  if (source) {
    return (
      <Stack gap="sm">
        <Box pos="relative" h={320} bg="dark.9" style={{ borderRadius: "var(--mantine-radius-md)", overflow: "hidden" }} data-replay-block>
          <Cropper
            image={source.dataUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_area, pixels) => setArea(pixels)}
          />
        </Box>
        <Text size="sm" c="dimmed" ta="center">
          Drag to reposition. Pinch, scroll or use the slider to zoom.
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" fw={500} id={zoomLabelId}>
            Zoom
          </Text>
          <Slider
            aria-labelledby={zoomLabelId}
            value={zoom}
            onChange={setZoom}
            min={1}
            max={3}
            step={0.05}
            label={(value) => `${Math.round(value * 100)}%`}
            style={{ flex: 1 }}
          />
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={resetCrop} disabled={isCropping}>
            Choose another
          </Button>
          <Button onClick={() => void applyCrop()} loading={isCropping} disabled={!area} data-testid="crop-apply">
            Use this photo
          </Button>
        </Group>
      </Stack>
    );
  }

  if (photo && previewUrl) {
    return (
      <Stack align="center" gap="sm">
        <Avatar src={previewUrl} alt="Your profile photo preview" size={160} data-replay-block />
        <Button variant="default" size="sm" className="touch-target" onClick={() => onChange(null)} disabled={disabled}>
          Choose a different photo
        </Button>
      </Stack>
    );
  }

  return <ImagePicker file={null} onChange={(file) => void handlePicked(file)} label="Profile photo" disabled={disabled} />;
}
