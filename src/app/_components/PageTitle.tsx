import { Stack, Title } from "@mantine/core";

export const PageTitle = ({ children, subtitle }: { children: string; subtitle?: string }) => {

    return (
        <Stack>
            <Title>{children}</Title>
            <Title order={3}>{subtitle}</Title>
        </Stack>
    );
}