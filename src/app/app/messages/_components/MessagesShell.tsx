"use client";

import { Title } from "@mantine/core";
import { useRouter, useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { activeMessagePane, defaultThreadRedirect, selectedThreadId } from "~/_utils/messagePanes";

import ConversationList, { type ConversationSummary } from "./ConversationList";
import classes from "./MessagesShell.module.css";
import NewMessageModal from "./NewMessageModal";

type MessagesShellProps = {
    /** Thread list with each thread's latest message, fetched on the server. */
    initialThreads: ConversationSummary[];
    /** Cursor of the next page of conversations; null when these are all. */
    initialNextCursor: string | null;
    currentUserId: string;
    children: React.ReactNode;
};

/** Matches Mantine's `md` breakpoint, where both panes fit side by side. */
const WIDE_SCREEN_QUERY = "(min-width: 62em)";
/** A visual viewport this much shorter than the window means a keyboard is up. */
const KEYBOARD_THRESHOLD_PX = 150;

/**
 * Keeps the screen above the on-screen keyboard on browsers that shrink only
 * the visual viewport (iOS Safari): the shell is sized to the visual viewport
 * and the tab-bar offset is dropped while the keyboard covers it. Browsers
 * that honour `interactive-widget=resizes-content` shrink `100dvh` themselves.
 */
function useKeyboardAwareHeight(ref: React.RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        const viewport = window.visualViewport;
        const element = ref.current;
        if (!viewport || !element) return;

        const update = () => {
            const keyboardOpen = window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX;
            if (keyboardOpen) {
                element.style.setProperty("--messages-viewport", `${Math.round(viewport.height)}px`);
                element.style.setProperty("--messages-bottom", "0px");
                // iOS scrolls the page to reveal the focused field; undo it,
                // the composer is already in view at the shrunken height.
                window.scrollTo(0, 0);
            } else {
                element.style.removeProperty("--messages-viewport");
                element.style.removeProperty("--messages-bottom");
            }
        };

        update();
        viewport.addEventListener("resize", update);
        return () => viewport.removeEventListener("resize", update);
    }, [ref]);
}

/** Sends a wide-screen visitor on `/app/messages` to their most recent thread. */
function DefaultThreadRedirect({ threads }: { threads: ConversationSummary[] }) {
    const router = useRouter();
    const segment = useSelectedLayoutSegment();
    const hasNewMessageDeepLink = useSearchParams().has("new");

    useEffect(() => {
        const target = defaultThreadRedirect({
            hasNewMessageDeepLink,
            isWideScreen: window.matchMedia(WIDE_SCREEN_QUERY).matches,
            selectedSegment: segment,
            threads,
        });
        if (target) router.replace(target);
    }, [hasNewMessageDeepLink, router, segment, threads]);

    return null;
}

/**
 * Two-pane messages screen. The pane shown on small screens follows the URL:
 * the list at `/app/messages`, the thread at `/app/messages/[id]`.
 */
export default function MessagesShell({ initialThreads, initialNextCursor, currentUserId, children }: MessagesShellProps) {
    const segment = useSelectedLayoutSegment();
    const shellRef = useRef<HTMLDivElement>(null);
    useKeyboardAwareHeight(shellRef);

    return (
        <div ref={shellRef} className={classes.shell} data-pane={activeMessagePane(segment)}>
            <Suspense>
                <DefaultThreadRedirect threads={initialThreads} />
            </Suspense>
            <div className={classes.header}>
                <Title order={1} size="h2" c="orange.7">Messages</Title>
                <div className={classes.headerAction}>
                    <Suspense>
                        <NewMessageModal />
                    </Suspense>
                </div>
            </div>
            <div className={classes.panes}>
                <aside className={classes.sidebar} aria-label="Conversations">
                    <ConversationList
                        initialThreads={initialThreads}
                        initialNextCursor={initialNextCursor}
                        currentUserId={currentUserId}
                        selectedThreadId={selectedThreadId(segment)}
                    />
                </aside>
                <section className={classes.thread} aria-label="Conversation">
                    {children}
                </section>
            </div>
        </div>
    );
}
