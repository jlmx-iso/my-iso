import { Avatar as MantineAvatar, type AvatarProps as MantineAvatarProps } from "@mantine/core";

type AvatarProps = Omit<MantineAvatarProps, "src" | "name" | "alt"> & {
    name?: string;
    src?: string | null;
    /**
     * Text alternative. Defaults to the person's name; pass `""` when the
     * name is already next to the avatar or on the surrounding control.
     */
    alt?: string;
    /** The signed-in member's own avatar: teal. Everyone else's is lavender (people). */
    self?: boolean;
};

export const Avatar = ({ src, name, alt, size = 120, self = false, ...props }: AvatarProps) => {
    const label = alt ?? name ?? "";
    const decorative = label === "";

    if (!src) {
        return (
            // Initials on the pastel, with dark text (theme autoContrast):
            // teal for you, lavender for other members.
            <MantineAvatar
                key={name}
                name={name}
                size={size}
                color={self ? "teal" : "purple"}
                variant="filled"
                role={decorative ? undefined : "img"}
                aria-label={decorative ? undefined : label}
                aria-hidden={decorative ? true : undefined}
                {...props}
            />
        );
    }
    // A face identifies a person: session replay shows an empty box instead
    // (see REPLAY_BLOCK_SELECTOR in ~/_lib/analyticsBrowser).
    return <MantineAvatar key={name} src={src} alt={label} size={size} data-replay-block {...props} />;
};
