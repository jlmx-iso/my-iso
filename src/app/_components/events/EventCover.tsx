import { Image, type ImageProps } from "@mantine/core";

type EventCoverProps = Omit<ImageProps, "src" | "alt"> & { src: string };

/**
 * An event's cover photo. Decorative next to the title, and often a picture
 * of people: session replay records an empty box in its place.
 */
export default function EventCover({ src, fit = "cover", ...props }: EventCoverProps) {
    return <Image src={src} alt="" fit={fit} data-replay-block {...props} />;
}
