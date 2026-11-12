"use client";

import { useMediaQuery } from "@mantine/hooks";
import { Notifications, useNotifications } from "@mantine/notifications";
import { useEffect } from "react";

/** Matches the `sm` breakpoint: below it the app is in its phone layout. */
const PHONE_QUERY = "(max-width: 47.99em)";
/** The title bar of an open dialog or sheet. */
const DIALOG_HEADER = ".mantine-Modal-header, .mantine-Drawer-header";
const GAP_PX = 8;

/**
 * Keeps toasts off the title and close button of an open dialog: while a
 * toast is showing, `--toast-top` on <html> is the bottom edge of the
 * topmost dialog header that the toast would otherwise cover. globals.css
 * places the toast container there. Phones only: on wider screens toasts
 * sit in the corner, clear of centred dialogs.
 */
function useToastsBelowDialogHeader(active: boolean) {
    useEffect(() => {
        if (!active) return;
        const root = document.documentElement;
        const phone = window.matchMedia(PHONE_QUERY);

        const place = () => {
            const headers = [...document.querySelectorAll<HTMLElement>(DIALOG_HEADER)];
            // Only a header near the top of the screen is in the toast's way.
            const bottoms = headers
                .map((header) => header.getBoundingClientRect())
                .filter((rect) => rect.height > 0 && rect.top < window.innerHeight / 3)
                .map((rect) => rect.bottom);
            if (phone.matches && bottoms.length > 0) {
                root.style.setProperty("--toast-top", `${Math.round(Math.max(...bottoms) + GAP_PX)}px`);
            } else {
                root.style.removeProperty("--toast-top");
            }
        };

        place();
        // Dialogs are portalled to <body>: watch them come and go, and settle.
        const observer = new MutationObserver(place);
        observer.observe(document.body, { childList: true, subtree: true });
        const settle = setInterval(place, 250);
        phone.addEventListener("change", place);
        window.addEventListener("resize", place);
        return () => {
            observer.disconnect();
            clearInterval(settle);
            phone.removeEventListener("change", place);
            window.removeEventListener("resize", place);
            root.style.removeProperty("--toast-top");
        };
    }, [active]);
}

/**
 * The toast container (see ~/app/_lib/notify for showing one). At the top of
 * the screen, clear of the phone tab bar and of the buttons at the bottom of
 * dialogs. A phone shows one toast at a time (the rest wait their turn);
 * wider screens stack up to three.
 */
export default function Toasts() {
    const isPhone = useMediaQuery(PHONE_QUERY) ?? false;
    const { notifications } = useNotifications();
    useToastsBelowDialogHeader(notifications.length > 0);

    return <Notifications position="top-center" limit={isPhone ? 1 : 3} containerWidth={440} zIndex={1000} />;
}
