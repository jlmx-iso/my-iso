"use client";

import { Button, Modal, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLifebuoy, IconSend } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, SUPPORT_SUBJECT_MAX } from "~/_utils/limits";
import { logger } from "~/_utils/logger";
import { userFacingError } from "~/_utils/userError";
import DialogError from "~/app/_components/DialogError";
import { dialogLock, routeFailure } from "~/app/_components/dialogFailure";
import { useLatestRef } from "~/app/_hooks/useLatestRef";
import { notify } from "~/app/_lib/notify";
import { api } from "~/trpc/react";

type ContactSupportButtonProps = {
    /** Full width on phones, for a page's primary action. */
    prominent?: boolean;
};

/** Whatever went wrong, the member can still reach a person. */
const FAILED = `Your message couldn't be sent. Please try again, or email ${SUPPORT_EMAIL}.`;

/**
 * Priority support for Pro members: a short form, sent to the team's inbox
 * flagged as Pro (support.contact). Only rendered for Pro members; the
 * server checks again.
 */
export default function ContactSupportButton({ prominent = false }: ContactSupportButtonProps) {
    const [opened, { open, close }] = useDisclosure(false);
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const isOpen = useLatestRef(opened);

    const { mutate, isPending, error, reset } = api.support.contact.useMutation({
        onError: (failure) => {
            logger.error("Support request failed", { error: failure });
            if (routeFailure({ dialogOpen: isOpen.current, stale: false }).show === "toast") {
                notify.error({ message: userFacingError(failure, FAILED), title: "Message not sent" });
            }
        },
        onSuccess: () => {
            notify.success({
                message: "The team will reply to the email address on your account.",
                title: "Message sent",
            });
            setSubject("");
            setMessage("");
            close();
        },
    });

    const tooShort = message.trim().length < SUPPORT_MESSAGE_MIN;
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        mutate({ message: message.trim(), subject: subject.trim() });
    };

    return (
        <>
            <Modal
                opened={opened}
                onClose={() => {
                    if (isPending) return;
                    close();
                    reset();
                }}
                {...dialogLock(isPending)}
                title="Contact priority support"
                size="md"
            >
                <form onSubmit={handleSubmit}>
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">
                            Your message goes straight to the team, marked as Pro so it is read first. We reply to the
                            email address on your account.
                        </Text>
                        <TextInput
                            label="Subject"
                            placeholder="e.g. A question about my invoice"
                            value={subject}
                            onChange={(event) => setSubject(event.currentTarget.value)}
                            maxLength={SUPPORT_SUBJECT_MAX}
                            required
                            data-autofocus
                        />
                        <Textarea
                            label="Message"
                            description={`At least ${SUPPORT_MESSAGE_MIN} characters`}
                            placeholder="What happened, and what you expected"
                            value={message}
                            onChange={(event) => setMessage(event.currentTarget.value)}
                            maxLength={SUPPORT_MESSAGE_MAX}
                            autosize
                            minRows={4}
                            maxRows={10}
                            required
                        />
                        <DialogError
                            message={error ? userFacingError(error, FAILED) : null}
                            title="Message not sent"
                            data-testid="support-error"
                        />
                        <Button
                            type="submit"
                            loading={isPending}
                            disabled={subject.trim().length === 0 || tooShort}
                            leftSection={<IconSend size={16} aria-hidden />}
                        >
                            Send to support
                        </Button>
                    </Stack>
                </form>
            </Modal>

            <Button
                size={prominent ? "md" : "sm"}
                w={prominent ? { base: "100%", xs: "auto" } : undefined}
                leftSection={<IconLifebuoy size={18} aria-hidden />}
                onClick={open}
                data-testid="contact-support"
            >
                Contact support
            </Button>
        </>
    );
}
