"use client";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconLock,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import PageHeader from "~/app/_components/PageHeader";
import { api } from "~/trpc/react";

const statusColors: Record<string, string> = {
  pending: "yellow",
  approved: "teal",
  rejected: "red",
};

const userTypeLabels: Record<string, string> = {
  lead: "Lead",
  second: "Second",
  both: "Both",
};

export default function Page() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [page, setPage] = useState(1);

  const { data, error, isLoading, refetch } = api.waitlist.getAll.useQuery({ status, page, limit: 20 });
  const { mutate: approve } = api.waitlist.approve.useMutation({ onSuccess: () => refetch() });
  const { mutate: reject } = api.waitlist.reject.useMutation({ onSuccess: () => refetch() });

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
        value={status}
        onChange={(v) => {
          setStatus(v as typeof status);
          setPage(1);
        }}
        data={[
          { label: `Pending${data && status === "pending" ? ` (${data.total})` : ""}`, value: "pending" },
          { label: "Approved", value: "approved" },
          { label: "Rejected", value: "rejected" },
          { label: "All", value: "all" },
        ]}
      />

      {isLoading && (
        <Stack align="center" py="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading waitlist...</Text>
        </Stack>
      )}

      {!isLoading && error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Failed to load waitlist">
          {error.message}
          <Button size="xs" variant="subtle" onClick={() => refetch()} mt="xs">
            Retry
          </Button>
        </Alert>
      )}

      {!isLoading && data && <Stack gap="sm">
        {data.items.map((entry) => (
          <Paper key={entry.id} withBorder p="md" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={4} style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text fw={600}>{entry.name}</Text>
                  <Badge size="xs" color={statusColors[entry.status] ?? "gray"}>
                    {entry.status}
                  </Badge>
                  <Badge size="xs" variant="light">
                    {userTypeLabels[entry.userType] ?? entry.userType}
                  </Badge>
                  {entry.position && (
                    <Text size="xs" c="dimmed">
                      #{entry.position}
                    </Text>
                  )}
                </Group>
                <Text size="sm" c="dimmed">{entry.email}</Text>
                <Group gap="xs">
                  {entry.instagram && (
                    <Text
                      size="xs"
                      component="a"
                      href={entry.instagram.startsWith("http") ? entry.instagram : `https://instagram.com/${entry.instagram.replace("@", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      c="blue"
                    >
                      Instagram <IconExternalLink size={10} />
                    </Text>
                  )}
                  {entry.website && (
                    <Text
                      size="xs"
                      component="a"
                      href={entry.website.startsWith("http") ? entry.website : `https://${entry.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      c="blue"
                    >
                      Website <IconExternalLink size={10} />
                    </Text>
                  )}
                  {entry.referralSource && (
                    <Text size="xs" c="dimmed">
                      Source: {entry.referralSource}
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  Applied {new Date(entry.createdAt).toLocaleDateString()}
                </Text>
              </Stack>

              {entry.status === "pending" && (
                <Group gap="xs">
                  <Button
                    size="xs"
                    color="teal"
                    variant="light"
                    leftSection={<IconCheck size={14} />}
                    onClick={() => approve({ id: entry.id })}
                  >
                    Approve
                  </Button>
                  <Button
                    size="xs"
                    color="gray"
                    variant="subtle"
                    leftSection={<IconX size={14} />}
                    onClick={() => reject({ id: entry.id })}
                  >
                    Skip
                  </Button>
                </Group>
              )}
            </Group>
          </Paper>
        ))}

        {data.items.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            No {status === "all" ? "" : status} entries.
          </Text>
        )}
      </Stack>}

      {data && data.totalPages > 1 && (
        <Pagination
          total={data.totalPages}
          value={page}
          onChange={setPage}
          mx="auto"
        />
      )}
    </Stack>
  );
}
