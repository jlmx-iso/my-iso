"use client";

import { Box, Center, Loader, Stack } from "@mantine/core";
import { IconHeartHandshake } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import EmptyState from "~/app/_components/EmptyState";
import { api } from "~/trpc/react";
import MatchCelebration from "./MatchCelebration";
import SwipeCard from "./SwipeCard";

interface MatchData {
  matchId: string;
  threadId: string;
  otherUserName: string;
  otherUserAvatar?: string | null;
}

export default function CardStack() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchData, setMatchData] = useState<MatchData | null>(null);

  const { data: deck, isLoading, refetch } = api.discover.getCardDeck.useQuery(
    { limit: 20 },
  );

  const { data: currentUser } = api.discover.getPreferences.useQuery();
  const swipeMutation = api.discover.swipe.useMutation();

  // Expire stale matches on mount
  const expireMutation = api.discover.expireStaleMatches.useMutation();
  const hasExpired = useRef(false);
  useEffect(() => {
    if (!hasExpired.current) {
      expireMutation.mutate();
      hasExpired.current = true;
    }
  }, [expireMutation]);

  const handleSwipe = useCallback(
    async (direction: "like" | "pass") => {
      if (!deck || currentIndex >= deck.length) return;

      const target = deck[currentIndex]!;
      setCurrentIndex((prev) => prev + 1);

      try {
        const result = await swipeMutation.mutateAsync({
          targetId: target.id,
          direction,
        });

        if (result.matched && result.matchId && result.threadId) {
          const photo = target.photographer;
          setMatchData({
            matchId: result.matchId,
            threadId: result.threadId,
            otherUserName: photo?.companyName ?? `${target.firstName} ${target.lastName}`,
            otherUserAvatar: photo?.avatar ?? target.profilePic,
          });
        }
      } catch {
        // Swipe failed — card already moved, just continue
      }
    },
    [deck, currentIndex, swipeMutation],
  );

  const handleCloseMatch = useCallback(() => {
    setMatchData(null);
  }, []);

  // Refetch when we run out of cards
  useEffect(() => {
    if (deck && currentIndex >= deck.length && deck.length > 0) {
      void refetch();
      setCurrentIndex(0);
    }
  }, [currentIndex, deck, refetch]);

  if (isLoading) {
    return (
      <Center py={60}>
        <Loader color="orange" />
      </Center>
    );
  }

  if (!deck || deck.length === 0) {
    return (
      <EmptyState
        icon={IconHeartHandshake}
        title="No more profiles nearby"
        description="Try expanding your preferences or check back later for new photographers."
      />
    );
  }

  const visibleCards = deck.slice(currentIndex, currentIndex + 2);

  return (
    <>
      <Box
        pos="relative"
        mih={400}
        style={{ touchAction: "pan-y" }}
      >
        <AnimatePresence mode="popLayout">
          {visibleCards.length > 0 ? (
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
                    width: "100%",
                    top: 0,
                  }}
                >
                  <SwipeCard
                    user={user}
                    onSwipe={handleSwipe}
                    isTop={i === 0}
                  />
                </motion.div>
              ))}
            </Stack>
          ) : (
            <EmptyState
              icon={IconHeartHandshake}
              title="No more profiles nearby"
              description="Try expanding your preferences or check back later for new photographers."
            />
          )}
        </AnimatePresence>
      </Box>

      <MatchCelebration
        opened={matchData !== null}
        onClose={handleCloseMatch}
        matchId={matchData?.matchId ?? ""}
        threadId={matchData?.threadId ?? ""}
        otherUserName={matchData?.otherUserName ?? ""}
        otherUserAvatar={matchData?.otherUserAvatar}
        currentUserAvatar={currentUser?.photographer?.avatar ?? undefined}
      />
    </>
  );
}
