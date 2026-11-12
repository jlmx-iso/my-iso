import { Group, Stack, Text, Title } from "@mantine/core";

type PageHeaderProps = {
    title: string;
    description?: string;
    action?: React.ReactNode;
};

/** The page's single h1, with an optional description and primary action. */
export default function PageHeader({ title, description, action }: PageHeaderProps) {
    return (
        <Group justify="space-between" align="center" gap="sm">
            <Stack gap={4} style={{ flex: "1 1 240px", minWidth: 0 }}>
                <Title order={1} size="h2" c="orange.7">{title}</Title>
                {description && (
                    <Text c="dimmed" size="sm">
                        {description}
                    </Text>
                )}
            </Stack>
            {action}
        </Group>
    );
}
