"use client"

import { Button, Flex } from "@mantine/core";
import { useState, useEffect } from "react";

type ScrollButtonProps = {
    children: React.ReactNode;
    hide: boolean;
    onClick: () => void;
};

export const useScrollButton = () => {
    const [isHidden, setIsHidden] = useState(true);

    const hide = () => setIsHidden(true);

    return { hide, isHidden };
}

export default function ScrollButton({ children, hide, onClick }: ScrollButtonProps) {
    const [isHidden, setIsHidden] = useState(true);

    useEffect(() => {
        setIsHidden(hide);
    }, [hide]);

    const handleClick = () => {
        onClick();
        // setIsHidden(true);
    }

    return (
        <Flex w="100%" justify="center">
            <Button
                style={{
                    alignSelf: "center",
                    bottom: 16,
                    position: "absolute",
                    textDecoration: "underline",
                    zIndex: 1000,
                }}
                hidden={isHidden}
                onClick={handleClick}
                variant="subtle"
            >
                {children}
            </Button>
        </Flex>
    )
}