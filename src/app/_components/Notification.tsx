"use client";

import { Notification as MantineNotification, type MantineStyleProp } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";

type NotificationProps = {
    children: string;
    type: "success" | "error";
    autoDismiss?: number;
};

export const Notification = ({ children, type, autoDismiss = 5000 }: NotificationProps) => {
    const [left, setLeft] = useState("1rem");
    const [opacity, setOpacity] = useState(1);

    const notificationStyle: MantineStyleProp = {
        bottom: "1rem",
        left,
        opacity,
        position: "fixed",
        transition: "left 5s, opacity 1s",
        zIndex: 1000,
    };

    const handleClose = useCallback(() => {
        setLeft("-100%");
        setOpacity(0);
    }, []);

    useEffect(() => {
        const timer = setTimeout(handleClose, autoDismiss);
        return () => clearTimeout(timer);
    }, [autoDismiss, handleClose]);

    return (
        <MantineNotification
            title={type === "success" ? "Success" : "Error"}
            color={type === "success" ? "teal" : "red"}
            onClose={handleClose}
            style={notificationStyle}
        >
            {children}
        </MantineNotification>
    );
};