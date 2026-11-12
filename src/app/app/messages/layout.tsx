import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

import MessagesShell from "./_components/MessagesShell";

export const metadata: Metadata = { title: "Messages" };

export default async function Layout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!session?.user) redirect("/login?callbackUrl=/app/messages");

    const caller = await api();
    const threads = await caller.message.getThreadsByUserId();
    const initialThreads = await Promise.all(
        threads.map(async (thread) => ({
            ...thread,
            lastMessage: await caller.message.getLatestThreadMessage({ threadId: thread.id }),
        })),
    );

    // Which pane to show depends on the child route, which a layout cannot see
    // from its params: MessagesShell reads the selected segment on the client.
    return (
        <MessagesShell initialThreads={initialThreads} currentUserId={session.user.id}>
            {children}
        </MessagesShell>
    );
}
