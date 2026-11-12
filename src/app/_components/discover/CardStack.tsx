"use client";

import { Alert, Box, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconEyeOff, IconHeartHandshake } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { userFacingError } from "~/_utils/userError";
import EmptyState from "~/app/_components/EmptyState";
import { api } from "~/trpc/react";

import MatchCelebration from "./MatchCelebration";
import SwipeCard from "./SwipeCard";

interface MatchData {
  threadId: string;
  otherUserName: string;
  otherUserAvatar?: string | null;
}

const DECK_SIZE = 20;

export default function CardStack() {
  // Ids swiped in this session. The deck is filtered by id (not walked by
  // index), so a card never comes back when the deck refetches, and a failed
  // swipe can put exactly its own card back.
  const [swipedIds, setSwipedIds] = useState<ReadonlySet<string>>(new Set());
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const { data: deck, isPending, isError, isFetching, refetch } = api.discover.getCardDeck.useQuery(
    { limit: DECK_SIZE },
  );
  const { data: preferences } = api.discover.getPreferences.useQuery();
  const { mutateAsync: swipe } = api.discover.swipe.useMutation();

  // Expire stale matches once per visit.
  const { mutate: expireStaleMatches } = api.discover.expireStaleMatches.useMutation();
  const hasExpired = useRef(false);
  useEffect(() => {
    if (!hasExpired.current) {
      hasExpired.current = true;
      expireStaleMatches();
    }
  }, [expireStaleMatches]);

  const remaining = deck?.filter((user) => !swipedIds.has(user.id)) ?? [];
  const deckLength = deck?.length ?? 0;
  const isExhausted = deckLength > 0 && remaining.length === 0;

  // Out of cards: ask the server for the next batch (it excludes everyone
  // already swiped).
  useEffect(() => {
    if (isExhausted && !isFetching) void refetch();
  }, [isExhausted, isFetching, refetch]);

  const handleSwipe = async (direction: "like" | "pass") => {
    const target = remaining[0];
    if (!target) return;

    const photo = target.photographer;
    const name = photo?.companyName?.trim() || `${target.firstName} ${target.lastName}`.trim() || "this photographer";

    setSwipedIds((current) => new Set(current).add(target.id));
    setAnnouncement(direction === "like" ? `Liked ${name}` : `Passed on ${name}`);

    try {
      const result = await swipe({ direction, targetId: target.id });
      if (result.matched && result.threadId) {
        setMatchData({
          otherUserAvatar: photo?.avatar ?? target.profilePic,
          otherUserName: name,
          threadId: result.threadId,
        });
      }
    } catch (error) {
      // Nothing was saved: put the card back and say so.
      setSwipedIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      setAnnouncement(`Your ${direction} on ${name} was not saved`);
      notifications.show({
        color: "red",
        message: userFacingError(error, `Your ${direction} wasn't saved, so ${name} is back on top. Please try again.`),
        title: direction === "like" ? "Couldn't save your like" : "Couldn't save your pass",
      });
    }
  };

  const liveRegion = (
    // Always rendered so screen readers announce each swipe.
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
  );

  if (isPending || (isExhausted && isFetching)) {
    return (
      <Center py={60}>
        {liveRegion}
        <Loader aria-label="Finding photographers" />
      </Center>
    );
  }

  if (isError && !deck) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title="We couldn't load photographers">
        <Button variant="default" size="xs" mt="xs" onClick={() => void refetch()}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (remaining.length === 0) {
    const isHidden = preferences?.isDiscoverable === false;
    return (
      <>
        {liveRegion}
        <EmptyState
          icon={isHidden ? IconEyeOff : IconHeartHandshake}
          title="You've seen everyone for now"
          description={
            isHidden
              ? "New photographers join every week. While you wait: you're hidden from Discover, so nobody can match with you. Turn on \"Show me in Discover\" above."
              : "New photographers join every week. In the meantime, check your matches, loosen your preferences above, or search by name or city."
          }
          action={
            <Group justify="center">
              <Button component={Link} href="/app/discover/matches">
                See your matches
              </Button>
              <Button component={Link} href="/app/search" variant="default">
                Search photographers
              </Button>
            </Group>
          }
        />
        {matchData && (
          <MatchCelebration onClose={() => setMatchData(null)} currentUserAvatar={preferences?.photographer?.avatar} {...matchData} />
        )}
      </>
    );
  }

  const visibleCards = remaining.slice(0, 2);

  return (
    <>
      {liveRegion}
      <Box pos="relative" mih={400} maw={640} mx="auto" w="100%" style={{ touchAction: "pan-y" }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <Stack pos="relative" w="100%">
            {visibleCards.map((user, i) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, x: 300 }}
                transition={{ duration: 0.2 }}
                style={{
                  position: i === 0 ? "relative" : "absolute",
                  top: 0,
                  width: "100%",
                }}
              >
                <SwipeCard
                  user={user}
                  onSwipe={(direction) => void handleSwipe(direction)}
                  isTop={i === 0}
                />
              </motion.div>
            ))}
          </Stack>
        </AnimatePresence>
      </Box>

      {matchData && (
        <MatchCelebration onClose={() => setMatchData(null)} currentUserAvatar={preferences?.photographer?.avatar} {...matchData} />
      )}
    </>
  );
}
