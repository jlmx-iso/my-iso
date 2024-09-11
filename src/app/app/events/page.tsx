import { Stack } from "@mantine/core";
import CreateEventFormSimple from "~/app/_components/events/CreateEventFormSimple";
import EventsFeed from "~/app/_components/events/EventsFeed";

export default function Page() {
    return (
        <Stack>
            <CreateEventFormSimple />
            <EventsFeed />
        </Stack>
    );
}