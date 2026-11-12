import { IconCalendarOff } from "@tabler/icons-react";

import NotFoundState from "~/app/_components/NotFoundState";

export default function EventNotFound() {
  return (
    <NotFoundState
      icon={IconCalendarOff}
      title="Event not found"
      description="This event doesn't exist or has been removed by the photographer who posted it."
      action={{ href: "/app/events", label: "Browse events" }}
    />
  );
}
