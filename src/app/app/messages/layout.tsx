import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { THREADS_PAGE_SIZE } from "~/_utils/pageSizes";
import { auth } from "~/auth";
import { api } from "~/trpc/server";

import MessagesShell from "./_components/MessagesShell";

export const metadata: Metadata = { title: "Messages" };

export default async function Layout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect("/login?callbackUrl=/app/messages");

    const caller = await api();
    const firstPage = await caller.message.getThreadsPage({ limit: THREADS_PAGE_SIZE });
    const initialThreads = await Promise.all(
        firstPage.items.map(async (thread) => ({
            ...thread,
            lastMessage: await caller.message.getLatestThreadMessage({ threadId: thread.id }),
        })),
    );

    // Which pane to show depends on the child route, which a layout cannot see
    // from its params: MessagesShell reads the selected segment on the client.
    return (
        <MessagesShell
            initialThreads={initialThreads}
            initialNextCursor={firstPage.nextCursor}
            currentUserId={session.user.id}
        >
            {children}
        </MessagesShell>
    );
}
