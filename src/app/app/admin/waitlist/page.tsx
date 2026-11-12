"use client";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconLock,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { formatLocalDate } from "~/_lib/dayjs";
import { toSafeWebsiteUrl } from "~/_utils/social";
import { userFacingError } from "~/_utils/userError";
import PageHeader from "~/app/_components/PageHeader";
import { type RouterOutputs, api } from "~/trpc/react";

type Status = "pending" | "approved" | "rejected" | "all";
type Entry = RouterOutputs["waitlist"]["getAll"]["items"][number];
type Decision = { action: "approve" | "reject"; entry: Entry };

const statusColors: Record<string, string> = {
  approved: "teal",
  pending: "tan",
  rejected: "red",
};

const userTypeLabels: Record<string, string> = {
  both: "Lead and second",
  lead: "Lead",
  second: "Second",
};

function instagramHref(value: string) {
  return toSafeWebsiteUrl(
    /^https?:\/\//i.test(value) ? value : `instagram.com/${value.replace(/^@/, "")}`,
  );
}

export default function Page() {
  const [status, setStatus] = useState<Status>("pending");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);

  const utils = api.useUtils();
  const { data, error, isLoading, refetch } = api.waitlist.getAll.useQuery({ status, page, limit: 20 });
  const approve = api.waitlist.approve.useMutation();
  const reject = api.waitlist.reject.useMutation();
  const isDeciding = approve.isPending || reject.isPending;

  const confirmDecision = async () => {
    if (!decision) return;
    const { action, entry } = decision;
    try {
      await (action === "approve" ? approve : reject).mutateAsync({ id: entry.id });
      await utils.waitlist.getAll.invalidate();
      notifications.show({
        color: "teal",
        message:
          action === "approve"
            ? `${entry.name} can now join ISO with ${entry.email}.`
            : `${entry.name} was moved to Rejected.`,
        title: action === "approve" ? "Application approved" : "Application declined",
      });
      setDecision(null);
    } catch (mutationError) {
      notifications.show({
        color: "red",
        message: userFacingError(mutationError, "Nothing was changed. Please try again."),
        title: action === "approve" ? "Couldn't approve application" : "Couldn't decline application",
      });
    }
  };

  // Show access denied if the user is not a founder/ambassador (I6)
  if (error?.data?.code === "FORBIDDEN") {
    return (
      <Stack gap="lg">
        <PageHeader title="Waitlist" />
        <Alert icon={<IconLock size={16} />} color="red" title="Access denied">
          You don&apos;t have permission to view this page. Only founders and
          ambassadors can manage the waitlist.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title="Waitlist"
        description="Review and approve waitlist applications"
      />

      <SegmentedControl
        aria-label="Filter by status"
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        data={[
          { label: `Pending${data && status === "pending" ? ` (${data.total})` : ""}`, value: "pending" },
          { label: "Approved", value: "approved" },
          { label: "Rejected", value: "rejected" },
          { label: "All", value: "all" },
        ]}
        w={{ base: "100%", sm: "fit-content" }}
      />

      {isLoading && (
        <Stack gap="sm" aria-busy="true" aria-label="Loading waitlist">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={104} radius="md" />
          ))}
        </Stack>
      )}

      {!isLoading && error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="We couldn't load the waitlist">
          {userFacingError(error, "Please try again.")}
          <Group mt="xs">
            <Button size="xs" variant="default" onClick={() => void refetch()}>
              Try again
            </Button>
          </Group>
        </Alert>
      )}

      {!isLoading && data && (
        <Stack gap="sm" component="ul" m={0} p={0} style={{ listStyle: "none" }}>
          {data.items.map((entry) => {
            const instagram = entry.instagram ? instagramHref(entry.instagram) : null;
            const website = entry.website ? toSafeWebsiteUrl(entry.website) : null;
            return (
              <Paper key={entry.id} component="li" withBorder p="md" radius="md">
                <Group justify="space-between" align="flex-start" gap="sm">
                  <Stack gap={4} style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <Group gap="xs">
                      <Text fw={600}>{entry.name}</Text>
                      <Badge size="sm" variant="light" color={statusColors[entry.status] ?? "gray"}>
                        {entry.status}
                      </Badge>
                      <Badge size="sm" variant="light" color="gray">
                        {userTypeLabels[entry.userType] ?? entry.userType}
                      </Badge>
                      {entry.position && (
                        <Text size="xs" c="dimmed">
                          <span className="sr-only">Position </span>#{entry.position}
                        </Text>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>{entry.email}</Text>
                    <Group gap="sm">
                      {instagram && (
                        <Anchor size="sm" href={instagram} target="_blank" rel="noopener noreferrer">
                          Instagram <IconExternalLink size={12} style={{ display: "inline" }} aria-hidden />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </Anchor>
                      )}
                      {website && (
                        <Anchor size="sm" href={website} target="_blank" rel="noopener noreferrer">
                          Website <IconExternalLink size={12} style={{ display: "inline" }} aria-hidden />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </Anchor>
                      )}
                      {entry.referralSource && (
                        <Text size="xs" c="dimmed">
                          Source: {entry.referralSource}
                        </Text>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      Applied {formatLocalDate(entry.createdAt)}
                    </Text>
                  </Stack>

                  {entry.status === "pending" && (
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        color="teal"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => setDecision({ action: "approve", entry })}
                        aria-label={`Approve ${entry.name}`}
                      >
                        Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        leftSection={<IconX size={14} />}
                        onClick={() => setDecision({ action: "reject", entry })}
                        aria-label={`Decline ${entry.name}`}
                      >
                        Decline
                      </Button>
                    </Group>
                  )}
                </Group>
              </Paper>
            );
          })}

          {data.items.length === 0 && (
            <Text component="li" c="dimmed" ta="center" py="xl">
              No {status === "all" ? "" : `${status} `}applications.
            </Text>
          )}
        </Stack>
      )}

      {data && data.totalPages > 1 && (
        <Pagination
          total={data.totalPages}
          value={page}
          onChange={setPage}
          mx="auto"
        />
      )}

      <Modal
        opened={!!decision}
        onClose={() => !isDeciding && setDecision(null)}
        title={decision?.action === "approve" ? "Approve this application?" : "Decline this application?"}
        centered
      >
        {decision && (
          <Stack gap="md">
            <Text size="sm">
              {decision.action === "approve"
                ? `${decision.entry.name} (${decision.entry.email}) will be able to create an ISO account.`
                : `${decision.entry.name} (${decision.entry.email}) will be moved to Rejected and won't be able to join with this application.`}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDecision(null)} disabled={isDeciding}>
                Cancel
              </Button>
              <Button
                color={decision.action === "approve" ? "teal" : "red"}
                onClick={() => void confirmDecision()}
                loading={isDeciding}
              >
                {decision.action === "approve" ? "Approve" : "Decline"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
