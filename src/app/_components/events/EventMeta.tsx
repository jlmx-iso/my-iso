import { Badge, Group } from "@mantine/core";
import { IconCalendar, IconClock, IconMapPin } from "@tabler/icons-react";

import LocalDate from "~/app/_components/LocalDate";

function formatDuration(hours: number) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
}

type EventMetaProps = {
    date: Date | string;
    duration: number;
    location: string | null;
    /** The detail page says when the event starts, not just on which day. */
    withTime?: boolean;
};

/** Location, date and duration of an event, with text alternatives for the icons. */
export default function EventMeta({ date, duration, location, withTime = false }: EventMetaProps) {
    return (
        <Group gap="xs" wrap="wrap">
            {location && (
                <Badge variant="light" color="teal" leftSection={<IconMapPin size={12} aria-hidden />}>
                    <span className="sr-only">Location: </span>{location}
                </Badge>
            )}
            <Badge variant="light" leftSection={<IconCalendar size={12} aria-hidden />}>
                <span className="sr-only">Date: </span>
                {/* Written in the browser, in the reader's own time zone: the
                    server's would be a different day (or hour) for many. */}
                <LocalDate date={new Date(date).toISOString()} format={withTime ? "dayTime" : "date"} />
            </Badge>
            <Badge variant="light" color="purple" leftSection={<IconClock size={12} aria-hidden />}>
                <span className="sr-only">Duration: </span>{formatDuration(duration)}
            </Badge>
        </Group>
    );
}
