import { Badge, type BadgeProps } from "@mantine/core";
import { IconCrown } from "@tabler/icons-react";

type ProBadgeProps = {
    size?: BadgeProps["size"];
};

/**
 * Marks a Pro member next to their name. Whether someone is Pro comes from
 * the server (`isPro` on the payload, decided from their subscription), never
 * from client state.
 *
 * Read as "Pro member" (the visible "Pro" alone is ambiguous next to a
 * name); the crown is decorative. Sand, the brand's colour for Pro (a gold
 * crown), and small: a signal, not a headline.
 */
export function ProBadge({ size = "xs" }: ProBadgeProps) {
    return (
        <Badge
            size={size}
            variant="light"
            color="tan"
            radius="sm"
            tt="none"
            leftSection={<IconCrown size={size === "xs" ? 10 : 12} aria-hidden />}
            style={{ flexShrink: 0 }}
            data-testid="pro-badge"
        >
            <span aria-hidden>Pro</span>
            <span className="sr-only">Pro member</span>
        </Badge>
    );
}
