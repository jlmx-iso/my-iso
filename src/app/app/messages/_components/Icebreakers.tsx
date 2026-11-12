"use client";

import { Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { ICEBREAKER_WAIT_MS, icebreakerPollInterval, icebreakerView } from "~/_utils/icebreakers";
import { api } from "~/trpc/react";

import classes from "./Icebreakers.module.css";

type IcebreakersProps = {
    threadId: string;
    /** Puts a suggestion in the message box, for the member to edit and send. */
    onPick: (text: string) => void;
};

/** The same request the Matches page makes, so the two share one cache entry. */
const MATCHES_INPUT = { limit: 50, offset: 0 };

/**
 * Conversation starters for a thread that began with a match, shown until
 * the member has written something. Suggestions are generated after the
 * match is made: while they are on their way this says so and looks again a
 * few times; if they never come (or this deployment has none) it shows
 * nothing at all.
 */
export default function Icebreakers({ threadId, onPick }: IcebreakersProps) {
    const matches = api.discover.getMatches.useQuery(MATCHES_INPUT, { staleTime: 60_000 });
    const matchId = matches.data?.find((match) => match.messageThreadId === threadId)?.id;

    // Set once we have waited long enough for pending suggestions.
    const [gaveUp, setGaveUp] = useState(false);
    const waitedMs = gaveUp ? ICEBREAKER_WAIT_MS : 0;

    const match = api.discover.getMatchById.useQuery(
        { matchId: matchId ?? "" },
        {
            enabled: !!matchId,
            refetchInterval: (query) => icebreakerPollInterval(query.state.data?.icebreakersStatus, waitedMs),
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: false,
        },
    );

    const isWaiting = match.data?.icebreakersStatus === "pending";
    useEffect(() => {
        if (!isWaiting) return;
        const timer = setTimeout(() => setGaveUp(true), ICEBREAKER_WAIT_MS);
        return () => clearTimeout(timer);
    }, [isWaiting]);

    const view = icebreakerView(match.data, waitedMs);

    if (view.kind === "hidden") return null;

    if (view.kind === "pending") {
        return (
            <Group gap="xs" px="sm" py={6} wrap="nowrap" role="status" data-testid="icebreakers-pending">
                <Loader size={12} color="gray" aria-hidden />
                <Text size="xs" c="dimmed">Conversation starters are on their way…</Text>
            </Group>
        );
    }

    return (
        <Stack gap={6} px="sm" py="xs" component="section" aria-label="Conversation starters" data-testid="icebreakers">
            <Group gap={6} wrap="nowrap">
                <IconSparkles size={14} color="var(--iso-accent-text)" aria-hidden />
                <Text size="xs" fw={600} c="dimmed">Not sure how to start? Tap one to edit and send.</Text>
            </Group>
            <Group gap="xs" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
                {view.suggestions.map((suggestion) => (
                    <li key={suggestion}>
                        <UnstyledButton className={classes.suggestion} onClick={() => onPick(suggestion)}>
                            {suggestion}
                        </UnstyledButton>
                    </li>
                ))}
            </Group>
        </Stack>
    );
}
