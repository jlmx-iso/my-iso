import { Badge, Group, List, ListItem, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck, IconClock } from "@tabler/icons-react";

import { PRO_PLAN, type PlanPricing, proFeaturesFor } from "~/_utils/plans";

type ProFeaturesProps = {
    pricing: Pick<PlanPricing, "isFoundingPrice">;
    /** Smaller type on the landing page's preview card. */
    compact?: boolean;
};

/**
 * What Pro gives, everywhere it is shown (landing page, onboarding,
 * Settings): what is true today with a check mark, then what is planned
 * under its own "Coming soon" heading, in muted type with a clock, so it
 * never reads as a current benefit.
 */
export default function ProFeatures({ pricing, compact = false }: ProFeaturesProps) {
    const size = compact ? "sm" : "sm";
    return (
        <Stack gap="md" data-testid="pro-features">
            <List
                spacing="xs"
                size={size}
                center
                icon={
                    <ThemeIcon size={20} radius="xl" variant="light" color="orange">
                        <IconCheck size={12} aria-hidden />
                    </ThemeIcon>
                }
                aria-label="Included in Pro"
                data-testid="pro-features-now"
            >
                {proFeaturesFor(pricing).map((feature) => (
                    <ListItem key={feature}>{feature}</ListItem>
                ))}
            </List>
            <Stack gap={6} data-testid="pro-features-coming-soon">
                <Group gap="xs">
                    <Text size="xs" fw={700} c="gray.7" tt="uppercase" style={{ letterSpacing: 0.5 }} id="pro-coming-soon">
                        Coming soon
                    </Text>
                    <Badge size="xs" variant="outline" color="gray">
                        Not yet available
                    </Badge>
                </Group>
                <List
                    spacing={4}
                    size="sm"
                    c="gray.7"
                    center
                    icon={<IconClock size={14} color="var(--mantine-color-gray-6)" aria-hidden />}
                    aria-labelledby="pro-coming-soon"
                >
                    {PRO_PLAN.comingSoon.map((feature) => (
                        <ListItem key={feature}>{feature}</ListItem>
                    ))}
                </List>
            </Stack>
        </Stack>
    );
}
