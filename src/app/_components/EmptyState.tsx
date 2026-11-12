import { Stack, Text, ThemeIcon } from "@mantine/core";
import { type IconProps } from "@tabler/icons-react";
import { type ForwardRefExoticComponent, type RefAttributes } from "react";

type EmptyStateProps = {
    icon: ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;
    title: string;
    description?: string;
    /** Buttons or links that tell the user what to do next. */
    action?: React.ReactNode;
};

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
    return (
        <Stack align="center" gap="md" py={60}>
            <ThemeIcon size={64} radius="xl" variant="light" color="gray">
                <Icon size={32} aria-hidden />
            </ThemeIcon>
            <Text fw={600} size="lg" ta="center">
                {title}
            </Text>
            {description && (
                <Text size="sm" c="dimmed" ta="center" maw={360}>
                    {description}
                </Text>
            )}
            {action}
        </Stack>
    );
}
