import { Group } from "@mantine/core";
import { useId } from "react";

const STAR_POINTS =
  "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2";
const FILLED = "var(--iso-rating)";
const EMPTY = "var(--mantine-color-gray-5)";

/** Read-only star rating (to the nearest half), announced as one image. */
export function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  const gradientId = useId();
  const rounded = Math.round(rating * 10) / 10;

  return (
    <Group gap={2} wrap="nowrap" role="img" aria-label={`Rated ${rounded} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = rating >= star;
        const halfFilled = !filled && rating >= star - 0.5;
        return (
          <svg
            key={star}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? FILLED : halfFilled ? `url(#${gradientId})` : "none"}
            stroke={filled || halfFilled ? FILLED : EMPTY}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {halfFilled && (
              <defs>
                <linearGradient id={gradientId}>
                  <stop offset="50%" stopColor={FILLED} />
                  <stop offset="50%" stopColor="transparent" />
                </linearGradient>
              </defs>
            )}
            <polygon points={STAR_POINTS} />
          </svg>
        );
      })}
    </Group>
  );
}
