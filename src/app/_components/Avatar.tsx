import { Avatar as MantineAvatar, type AvatarProps as MantineAvatarProps } from "@mantine/core";

type AvatarProps = Omit<MantineAvatarProps, "src" | "name" | "alt"> & {
    name?: string;
    src?: string | null;
    /**
     * Text alternative. Defaults to the person's name; pass `""` when the
     * name is already next to the avatar or on the surrounding control.
     */
    alt?: string;
};

const INITIALS_COLORS = ["orange", "teal", "blue", "purple", "red", "green", "tan"];

export const Avatar = ({ src, name, alt, size = 120, ...props }: AvatarProps) => {
    const label = alt ?? name ?? "";
    const decorative = label === "";

    if (!src) {
        return (
            <MantineAvatar
                key={name}
                name={name}
                size={size}
                color="initials"
                allowedInitialsColors={INITIALS_COLORS}
                role={decorative ? undefined : "img"}
                aria-label={decorative ? undefined : label}
                aria-hidden={decorative ? true : undefined}
                {...props}
            />
        );
    }
    return <MantineAvatar key={name} src={src} alt={label} size={size} {...props} />;
};
