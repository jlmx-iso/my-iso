import { Anchor, Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconCrown, IconMail } from "@tabler/icons-react";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { NextLink } from "~/app/_components/NextLink";

import ContactSupportButton from "./ContactSupportButton";

type SupportCardProps = {
    /** From the server: whether the member has Pro right now. */
    isPro: boolean;
};

/**
 * How to get help. Pro members write to the team from here (priority
 * support, flagged as Pro); everyone else gets the public contact route.
 */
export default function SupportCard({ isPro }: SupportCardProps) {
    return (
        <Paper withBorder radius="md" p="lg" data-testid="support-card">
            <Stack gap="sm" align="flex-start">
                <Group gap="sm">
                    <Title order={2} size="h4">Support</Title>
                    {isPro && (
                        <Badge color="orange" variant="light" leftSection={<IconCrown size={12} aria-hidden />}>
                            Priority
                        </Badge>
                    )}
                </Group>
                {isPro ? (
                    <>
                        <Text size="sm" c="dimmed">
                            As a Pro member your messages reach the team marked as Pro, and are read first.
                        </Text>
                        <ContactSupportButton />
                    </>
                ) : (
                    <>
                        <Text size="sm" c="dimmed">
                            Questions about your account, a booking or billing? Email{" "}
                            <Anchor href={`mailto:${SUPPORT_EMAIL}`} size="sm">{SUPPORT_EMAIL}</Anchor> and a person on
                            the team will read it. Pro members get priority support.
                        </Text>
                        <Button component={NextLink} href="/contact" variant="default" size="sm" leftSection={<IconMail size={16} aria-hidden />}>
                            Contact us
                        </Button>
                    </>
                )}
            </Stack>
        </Paper>
    );
}
