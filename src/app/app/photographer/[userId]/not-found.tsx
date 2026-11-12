import { IconUserOff } from "@tabler/icons-react";

import NotFoundState from "~/app/_components/NotFoundState";

export default function PhotographerNotFound() {
  return (
    <NotFoundState
      icon={IconUserOff}
      title="Photographer not found"
      description="This profile doesn't exist or may have been removed."
      action={{ href: "/app/search", label: "Search photographers" }}
      secondaryAction={{ href: "/app/discover", label: "Go to Discover" }}
    />
  );
}
