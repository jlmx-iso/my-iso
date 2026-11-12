"use client";

import { Button, Group, Modal, Stack, Text } from "@mantine/core";

import DialogError from "./DialogError";

type ConfirmDialogProps = {
    opened: boolean;
    /** Called for Escape, the overlay, the close button and the "keep" button. */
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    /** What will happen, and to whom. */
    children: React.ReactNode;
    /** Says what the button does: "Decline application", not "OK". */
    confirmLabel: string;
    /** The way out, in the same terms: "Keep application". */
    cancelLabel: string;
    /** Red confirm button, for something that cannot be taken back. */
    destructive?: boolean;
    loading?: boolean;
    /** Why the last attempt failed: shown above the buttons (see DialogError). */
    error?: string | null;
    errorTitle?: string;
};

/**
 * "Are you sure?" for actions that end or discard something. Focus starts on
 * the way out, so Enter or a stray click never confirms; closing returns
 * focus to the control that opened it.
 */
export default function ConfirmDialog({
    opened,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel,
    cancelLabel,
    destructive = false,
    loading = false,
    error,
    errorTitle,
}: ConfirmDialogProps) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} size="sm" centered closeOnClickOutside={!loading}>
            <Stack gap="lg">
                <Text size="sm" component="div" style={{ lineHeight: 1.55 }}>
                    {children}
                </Text>
                <DialogError message={error} title={errorTitle} />
                <Group justify="flex-end" gap="sm">
                    <Button variant="default" onClick={onClose} disabled={loading} data-autofocus>
                        {cancelLabel}
                    </Button>
                    <Button color={destructive ? "red" : undefined} onClick={onConfirm} loading={loading}>
                        {confirmLabel}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
