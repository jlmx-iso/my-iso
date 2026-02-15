import { Stack } from "@mantine/core";

import CreateEventFormSimple from "~/app/_components/events/CreateEventFormSimple";
import EventsFeed from "~/app/_components/events/EventsFeed";
import PageHeader from "~/app/_components/PageHeader";

export default function Page() {
    return (
        <Stack gap="lg">
            <PageHeader
                title="Events"
                description="Find and post second shooter opportunities near you"
                action={<CreateEventFormSimple />}
            />
            <EventsFeed />
        </Stack>
    );
}
