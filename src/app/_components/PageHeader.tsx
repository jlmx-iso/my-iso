import { Group, Stack, Text, Title } from "@mantine/core";

type PageHeaderProps = {
    title: string;
    description?: string;
    action?: React.ReactNode;
};

export default function PageHeader({ title, description, action }: PageHeaderProps) {
    return (
        <Group justify="space-between" align="center">
            <Stack gap={4}>
                <Title order={2} c="orange.7">{title}</Title>
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
