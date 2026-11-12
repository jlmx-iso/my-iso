import { Anchor, Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconCrown, IconMail } from "@tabler/icons-react";

import { SUPPORT_EMAIL } from "~/_lib/site";

import ContactSupportButton from "./ContactSupportButton";

type SupportCardProps = {
    /** From the server: whether the member has Pro right now. */
    isPro: boolean;
    /** The address on the member's account, where the team replies. */
    replyTo: string;
};

const MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ISO support")}`;

/**
 * How to get help, the same in Settings and on /app/support (the account
 * menu's "Help & support"). Pro members write to the team from here
 * (priority support, flagged Pro); everyone else emails the support address.
 */
export default function SupportCard({ isPro, replyTo }: SupportCardProps) {
    return (
        <Paper withBorder radius="md" p="lg" data-testid="support-card">
            <Stack gap="sm" align="flex-start">
                <Group gap="sm">
                    <Title order={2} size="h4">Support</Title>
                    {isPro && (
                        <Badge color="orange" variant="light" tt="none" leftSection={<IconCrown size={12} aria-hidden />}>
                            Priority
                        </Badge>
                    )}
                </Group>
                {isPro ? (
                    <>
                        <Text size="sm" c="dimmed">Your messages are flagged Pro and read first.</Text>
                        <ContactSupportButton replyTo={replyTo} />
                    </>
                ) : (
                    <>
                        <Text size="sm" c="dimmed">
                            Questions about your account, a booking or billing? Email{" "}
                            <Anchor href={MAILTO} size="sm">{SUPPORT_EMAIL}</Anchor> and a person on the team will read it.
                            Pro members get priority support.
                        </Text>
                        <Button component="a" href={MAILTO} variant="default" size="sm" leftSection={<IconMail size={16} aria-hidden />}>
                            Email support
                        </Button>
                    </>
                )}
            </Stack>
        </Paper>
    );
}
