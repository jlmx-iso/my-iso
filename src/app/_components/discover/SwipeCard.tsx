"use client";

import {
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBrandInstagram,
  IconCalendarEvent,
  IconCamera,
  IconChevronDown,
  IconChevronUp,
  IconHeart,
  IconMapPin,
  IconStar,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { useState } from "react";

import { instagramUrl } from "~/_utils";

interface SwipeCardProps {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    profilePic?: string | null;
    city?: string | null;
    state?: string | null;
    photographer?: {
      name: string;
      location: string;
      bio?: string | null;
      avatar?: string | null;
      companyName: string;
      website?: string | null;
      instagram?: string | null;
      avgRating?: number | null;
      reviewCount: number;
      eventCount: number;
      specializations: string[];
      portfolioImages?: { image: string; title: string }[];
    } | null;
  };
  onSwipe: (direction: "like" | "pass") => void;
  isTop: boolean;
}

export default function SwipeCard({ user, onSwipe, isTop }: SwipeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const likeOpacity = useTransform(x, [0, 100], [0, 1]);
  const passOpacity = useTransform(x, [-100, 0], [1, 0]);

  const photo = user.photographer;
  const avatar = photo?.avatar ?? user.profilePic;
  const normalizedCompanyName = photo?.companyName?.trim();
  const displayName = normalizedCompanyName || (`${user.firstName || ""} ${user.lastName || ""}`.trim() || "User");
  const location = photo?.location ?? [user.city, user.state].filter(Boolean).join(", ");

  const hasPortfolio = photo?.portfolioImages && photo.portfolioImages.length > 0;
  const hasExpandedContent = !!photo;

  return (
    <motion.div
      style={{
        x,
        rotate,
        position: isTop ? "relative" : "absolute",
        width: "100%",
        top: isTop ? 0 : 0,
        zIndex: isTop ? 2 : 1,
        cursor: isTop ? "grab" : "default",
      }}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_e, info) => {
        if (info.offset.x > 100) {
          onSwipe("like");
        } else if (info.offset.x < -100) {
          onSwipe("pass");
        }
      }}
      whileDrag={{ cursor: "grabbing" }}
    >
      <Box
        p="lg"
        style={{
          background: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-gray-2)",
          borderRadius: "var(--mantine-radius-lg)",
          boxShadow: isTop ? "0 4px 20px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.08)",
          overflow: "hidden",
          position: "relative",
          transform: isTop ? undefined : "scale(0.93) translateY(20px)",
        }}
      >
        {/* Swipe indicators */}
        {isTop && (
          <>
            <motion.div
              style={{
                opacity: likeOpacity,
                position: "absolute",
                top: 20,
                left: 20,
                zIndex: 10,
                padding: "8px 16px",
                borderRadius: 8,
                border: "3px solid var(--mantine-color-teal-5)",
                color: "var(--mantine-color-teal-5)",
                fontWeight: 700,
                fontSize: 24,
                transform: "rotate(-15deg)",
              }}
            >
              LIKE
            </motion.div>
            <motion.div
              style={{
                opacity: passOpacity,
                position: "absolute",
                top: 20,
                right: 20,
                zIndex: 10,
                padding: "8px 16px",
                borderRadius: 8,
                border: "3px solid var(--mantine-color-red-5)",
                color: "var(--mantine-color-red-5)",
                fontWeight: 700,
                fontSize: 24,
                transform: "rotate(15deg)",
              }}
            >
              PASS
            </motion.div>
          </>
        )}

        <Stack gap="md">
          {/* Avatar + Name + Location */}
          <Group gap="md" wrap="nowrap">
            <Avatar src={avatar} size={64} radius="xl" color="orange">
              {(user.firstName || "U")[0]}
            </Avatar>
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Title order={4} lineClamp={1}>{displayName}</Title>
              {location && (
                <Group gap={4} wrap="nowrap">
                  <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="sm" c="dimmed" lineClamp={1}>{location}</Text>
                </Group>
              )}
            </Stack>
          </Group>

          {/* Quick stats row */}
          {photo && (
            <Group gap="lg">
              {photo.avgRating != null && (
                <Group gap={4}>
                  <IconStar size={14} color="var(--mantine-color-yellow-5)" fill="var(--mantine-color-yellow-5)" />
                  <Text size="sm" fw={500}>{photo.avgRating.toFixed(1)}</Text>
                  <Text size="xs" c="dimmed">({photo.reviewCount})</Text>
                </Group>
              )}
              {photo.eventCount > 0 && (
                <Group gap={4}>
                  <IconCalendarEvent size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    {photo.eventCount} event{photo.eventCount !== 1 ? "s" : ""} posted
                  </Text>
                </Group>
              )}
              {hasPortfolio && (
                <Group gap={4}>
                  <IconCamera size={14} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    {photo.portfolioImages!.length} photo{photo.portfolioImages!.length !== 1 ? "s" : ""}
                  </Text>
                </Group>
              )}
            </Group>
          )}

          {/* Bio — always visible, truncated when collapsed */}
          {photo?.bio && (
            <Text size="sm" c="dimmed" lineClamp={expanded ? undefined : 3}>
              {photo.bio}
            </Text>
          )}

          {/* Specialization badges */}
          {photo?.specializations && photo.specializations.length > 0 && (
            <Group gap="xs">
              {photo.specializations.map((tag) => (
                <Badge key={tag} variant="light" color="orange" size="sm">
                  {tag}
                </Badge>
              ))}
            </Group>
          )}

          {/* Expand/collapse toggle */}
          {isTop && photo && hasExpandedContent && (
            <UnstyledButton
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((o) => !o);
              }}
            >
              <Group gap={4} justify="center">
                {expanded ? (
                  <IconChevronUp size={16} color="var(--mantine-color-orange-5)" />
                ) : (
                  <IconChevronDown size={16} color="var(--mantine-color-orange-5)" />
                )}
                <Text size="xs" fw={500} c="orange.5">
                  {expanded ? "Show less" : "View full profile"}
                </Text>
              </Group>
            </UnstyledButton>
          )}

          {/* Expanded details — onPointerDownCapture stops drag from starting here */}
          <Collapse in={expanded}>
            <div onPointerDownCapture={(e) => e.stopPropagation()}>
            <Stack gap="md">
              <Divider color="gray.2" />

              {/* Portfolio */}
              <Stack gap="xs">
                <Text size="sm" fw={600}>Portfolio</Text>
                {hasPortfolio ? (
                  <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                    {photo!.portfolioImages!.map((img, i) => (
                      <Image
                        key={i}
                        src={img.image}
                        alt={img.title}
                        h={140}
                        radius="sm"
                        fit="cover"
                      />
                    ))}
                  </SimpleGrid>
                ) : (
                  <SimpleGrid cols={3} spacing="xs">
                    {[0, 1, 2].map((i) => (
                      <Box
                        key={i}
                        h={100}
                        style={{
                          borderRadius: "var(--mantine-radius-sm)",
                          background: "var(--mantine-color-gray-1)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconCamera size={24} color="var(--mantine-color-gray-4)" />
                      </Box>
                    ))}
                  </SimpleGrid>
                )}
              </Stack>

              {/* Rating detail */}
              {photo && photo.avgRating != null && (
                <Group gap="xs">
                  <Group gap={4}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <IconStar
                        key={star}
                        size={16}
                        color="var(--mantine-color-yellow-5)"
                        fill={star <= Math.round(photo.avgRating!) ? "var(--mantine-color-yellow-5)" : "none"}
                      />
                    ))}
                  </Group>
                  <Text size="sm" fw={500}>
                    {photo.avgRating.toFixed(1)} from {photo.reviewCount} review{photo.reviewCount !== 1 ? "s" : ""}
                  </Text>
                </Group>
              )}

              {/* Links */}
              {(photo?.website || photo?.instagram) && (
                <Stack gap="xs">
                  <Text size="sm" fw={600}>Links</Text>
                  <Group gap="md">
                    {photo.website && (
                      <Anchor href={photo.website} target="_blank" rel="noopener noreferrer" size="sm" underline="hover">
                        <Group gap={4}>
                          <ThemeIcon size={20} variant="subtle" color="gray">
                            <IconWorld size={14} />
                          </ThemeIcon>
                          Website
                        </Group>
                      </Anchor>
                    )}
                    {photo.instagram && (
                      <Anchor href={instagramUrl(photo.instagram)} target="_blank" rel="noopener noreferrer" size="sm" underline="hover">
                        <Group gap={4}>
                          <ThemeIcon size={20} variant="subtle" color="grape">
                            <IconBrandInstagram size={14} />
                          </ThemeIcon>
                          Instagram
                        </Group>
                      </Anchor>
                    )}
                  </Group>
                </Stack>
              )}
            </Stack>
            </div>
          </Collapse>

          {/* Action buttons */}
          {isTop && (
            <Group grow>
              <Button
                variant="light"
                color="red"
                leftSection={<IconX size={18} />}
                onClick={() => onSwipe("pass")}
              >
                Pass
              </Button>
              <Button
                variant="filled"
                color="teal"
                leftSection={<IconHeart size={18} />}
                onClick={() => onSwipe("like")}
              >
                Like
              </Button>
            </Group>
          )}
        </Stack>
      </Box>
    </motion.div>
  );
}
