import Anthropic from "@anthropic-ai/sdk";

import { env } from "~/env";
import { logger } from "~/_utils";

function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

interface UserProfile {
  firstName: string;
  lastName: string;
  city?: string | null;
  state?: string | null;
  photographer?: {
    name: string;
    location: string;
    bio?: string | null;
    companyName: string;
    portfolioImages?: { tags: string; title: string }[];
    reviews?: { rating: number }[];
  } | null;
}

export async function generateMatchSummary(
  user1: UserProfile,
  user2: UserProfile,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const formatProfile = (u: UserProfile) => {
      const lines = [`${u.firstName} ${u.lastName}`];
      if (u.city || u.state) lines.push(`Location: ${[u.city, u.state].filter(Boolean).join(", ")}`);
      if (u.photographer) {
        lines.push(`Photographer: ${u.photographer.companyName}`);
        lines.push(`Based in: ${u.photographer.location}`);
        if (u.photographer.bio) lines.push(`Bio: ${u.photographer.bio}`);
        if (u.photographer.portfolioImages?.length) {
          const tags = u.photographer.portfolioImages
            .flatMap((img) => {
              try { return JSON.parse(img.tags) as string[]; } catch { return []; }
            });
          if (tags.length) lines.push(`Portfolio tags: ${[...new Set(tags)].join(", ")}`);
        }
        if (u.photographer.reviews?.length) {
          const avg = u.photographer.reviews.reduce((s, r) => s + r.rating, 0) / u.photographer.reviews.length;
          lines.push(`Rating: ${avg.toFixed(1)}/5 (${u.photographer.reviews.length} reviews)`);
        }
      }
      return lines.join("\n");
    };

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You are writing a brief compatibility summary for two users who matched on a photographer marketplace. Write 2-3 sentences explaining why they're a good match. Be specific and reference their actual details. No greeting or sign-off.

User 1:
${formatProfile(user1)}

User 2:
${formatProfile(user2)}`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    return textBlock?.text ?? null;
  } catch (error) {
    logger.error("Failed to generate match summary", { error });
    return null;
  }
}

export async function generateIcebreakers(
  user1: UserProfile,
  user2: UserProfile,
): Promise<string[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const formatProfile = (u: UserProfile) => {
      const lines = [`${u.firstName} ${u.lastName}`];
      if (u.city || u.state) lines.push(`Location: ${[u.city, u.state].filter(Boolean).join(", ")}`);
      if (u.photographer) {
        lines.push(`Photographer: ${u.photographer.companyName}`);
        if (u.photographer.bio) lines.push(`Bio: ${u.photographer.bio}`);
        if (u.photographer.portfolioImages?.length) {
          const tags = u.photographer.portfolioImages
            .flatMap((img) => {
              try { return JSON.parse(img.tags) as string[]; } catch { return []; }
            });
          if (tags.length) lines.push(`Portfolio tags: ${[...new Set(tags)].join(", ")}`);
        }
      }
      return lines.join("\n");
    };

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are helping a user start a conversation with someone they matched with on a photographer marketplace. Generate exactly 3 short, natural conversation starters. Return them as a JSON array of strings, nothing else.

User (sending message):
${formatProfile(user1)}

Matched with:
${formatProfile(user2)}`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) return [];

    const parsed: unknown = JSON.parse(textBlock.text);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
    return [];
  } catch (error) {
    logger.error("Failed to generate icebreakers", { error });
    return [];
  }
}
