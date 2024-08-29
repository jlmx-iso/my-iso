import { Avatar as MantineAvatar, type AvatarProps as MantineAvatarProps } from "@mantine/core";

type AvatarProps = MantineAvatarProps & {
    name?: string;
    src?: string | null;
    size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
};

export const Avatar = ({ src, name, size = 120, ...props }: AvatarProps) => {
    if (!src) {
        return <MantineAvatar key={name} name={name} alt={name} size={size} color="initials" {...props} />;
    }
    return <MantineAvatar key={name} src={src} alt={name} size={size} {...props} />;
}