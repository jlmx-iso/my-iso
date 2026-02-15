"use client"

import { Button, Flex } from "@mantine/core";
import { IconArrowDown } from "@tabler/icons-react";

type ScrollButtonProps = {
    children: React.ReactNode;
    hide: boolean;
    onClick: () => void;
};

export default function ScrollButton({ children, hide, onClick }: ScrollButtonProps) {
    if (hide) return null;

    return (
        <Flex w="100%" justify="center" pos="sticky" bottom={8} style={{ zIndex: 10 }}>
            <Button
                onClick={onClick}
                variant="filled"
                color="orange"
                size="compact-sm"
                radius="xl"
                leftSection={<IconArrowDown size={14} />}
                style={{
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}
            >
                {children}
            </Button>
        </Flex>
    )
}
