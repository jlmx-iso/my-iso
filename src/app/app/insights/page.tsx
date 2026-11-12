import { Button, Container, List, ListItem, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconChartBar, IconCrown, IconEye, IconMessageCircle, IconRoute, IconUsers } from "@tabler/icons-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { siteUrl } from "~/_lib/site";
import { PRO_PLAN, proPriceView } from "~/_utils/plans";
import { hasProAccess } from "~/_utils/subscriptionView";
import { NextLink } from "~/app/_components/NextLink";
import PageHeader from "~/app/_components/PageHeader";
import { auth } from "~/auth";
import { getPricingForRole } from "~/server/_utils/pricing";
import { api } from "~/trpc/server";

import InsightsDashboard from "./_components/InsightsDashboard";

export const metadata: Metadata = { title: "Insights" };

const WHAT_YOU_GET = [
  { icon: IconEye, text: "How often your profile was opened, day by day, over 7, 30 or 90 days" },
  { icon: IconRoute, text: "Where they came from: search, events, Discover, messages or a shared link" },
  { icon: IconChartBar, text: "Views of each of your events, and the applications they received" },
  { icon: IconMessageCircle, text: "How many photographers messaged you first" },
  { icon: IconUsers, text: "Counts only: ISO never records who visited" },
] as const;

/**
 * Pro insights. A member without Pro sees what the page would show, and
 * no numbers: none are made up, and theirs are not shown before they pay.
 */
export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/app/insights");

  const caller = await api();
  const [subscription, me] = await Promise.all([caller.subscription.getStatus(), caller.user.getMe()]);
  const isPro = hasProAccess(subscription);
  const profileUrl = me.handle ? siteUrl(`/photographer/${me.handle}`) : siteUrl(`/app/photographer/${session.user.id}`);
  const price = proPriceView(getPricingForRole(me.role), "monthly");

  return (
    <Container size="lg" py="lg" px={0}>
      <Stack gap="xl">
        <PageHeader title="Insights" description="Who is finding your work, and where they come from" />
        {isPro ? (
          <InsightsDashboard profileUrl={profileUrl} />
        ) : (
          <Paper withBorder radius="md" p={{ base: "lg", sm: "xl" }} maw={720} data-testid="insights-upsell">
            <Stack gap="lg" align="flex-start">
              <ThemeIcon size={44} radius="md" variant="light" color="orange">
                <IconCrown size={24} aria-hidden />
              </ThemeIcon>
              <Stack gap={6}>
                <Title order={2} size="h3">See who&apos;s finding your work</Title>
                <Text c="dimmed">{PRO_PLAN.name} shows you:</Text>
              </Stack>
              <List spacing="sm" center={false} size="sm">
                {WHAT_YOU_GET.map(({ icon: Icon, text }) => (
                  <ListItem
                    key={text}
                    icon={
                      <ThemeIcon size={24} radius="xl" variant="light" color="orange">
                        <Icon size={14} aria-hidden />
                      </ThemeIcon>
                    }
                  >
                    {text}
                  </ListItem>
                ))}
              </List>
              <Button component={NextLink} href="/app/settings" size="md" leftSection={<IconCrown size={18} aria-hidden />} data-testid="insights-upsell-cta">
                See {PRO_PLAN.name}: {price.perMonth}/mo
              </Button>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
