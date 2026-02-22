import { Stack, Text, ThemeIcon } from "@mantine/core";
import { type IconProps } from "@tabler/icons-react";
import { type ForwardRefExoticComponent, type RefAttributes } from "react";

type EmptyStateProps = {
    icon: ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;
    title: string;
    description?: string;
};

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
    return (
        <Stack align="center" gap="md" py={60}>
            <ThemeIcon size={64} radius="xl" variant="light" color="gray">
                <Icon size={32} />
            </ThemeIcon>
            <Text fw={500} size="lg" c="dimmed">
                {title}
            </Text>
            {description && (
                <Text size="sm" c="dimmed" ta="center" maw={320}>
                    {description}
                </Text>
            )}
        </Stack>
    );
}
