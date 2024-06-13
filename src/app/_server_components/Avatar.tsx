import { Avatar as MantineAvatar } from "@mantine/core";

type AvatarProps = {
    alt: string;
    src?: string | null;
    size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
};

export const Avatar = ({ src, alt, size = 120 }: AvatarProps) => {
    return <MantineAvatar src={src ?? undefined} alt={alt} size={size} />;
}