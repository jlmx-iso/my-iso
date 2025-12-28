import { Tabs, Stack, Text } from '@mantine/core';
import EventSearchCard from './EventSearchCard';
import PhotographerCard from './PhotographerCard';
import type { RouterOutputs } from '~/trpc/react';

type SearchResultsProps = {
  results: RouterOutputs['search']['searchAll'];
};

export default function SearchResults({ results }: SearchResultsProps) {
  const hasPhotographers = results.photographers.length > 0;
  const hasEvents = results.events.length > 0;
  const totalResults = results.photographers.length + results.events.length;

  if (!hasPhotographers && !hasEvents) {
    return (
      <Stack align="center" mt="xl">
        <Text size="lg" c="dimmed">No results found</Text>
      </Stack>
    );
  }

  return (
    <Tabs defaultValue="all" mt="xl">
      <Tabs.List>
        <Tabs.Tab value="all">All ({totalResults})</Tabs.Tab>
        {hasPhotographers && (
          <Tabs.Tab value="photographers">Photographers ({results.photographers.length})</Tabs.Tab>
        )}
        {hasEvents && (
          <Tabs.Tab value="events">Events ({results.events.length})</Tabs.Tab>
        )}
      </Tabs.List>

      <Tabs.Panel value="all" pt="md">
        <Stack gap="md">
          {hasPhotographers && (
            <>
              {results.photographers.length > 0 && (
                <Text size="lg" fw={600}>Photographers</Text>
              )}
              {results.photographers.map((photographer) => (
                <PhotographerCard key={photographer.id} photographer={photographer} />
              ))}
            </>
          )}
          {hasEvents && (
            <>
              {results.events.length > 0 && (
                <Text size="lg" fw={600} mt={hasPhotographers ? "xl" : undefined}>Events</Text>
              )}
              {results.events.map((event) => (
                <EventSearchCard key={event.id} event={event} />
              ))}
            </>
          )}
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel value="photographers" pt="md">
        <Stack gap="md">
          {results.photographers.map((photographer) => (
            <PhotographerCard key={photographer.id} photographer={photographer} />
          ))}
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel value="events" pt="md">
        <Stack gap="md">
          {results.events.map((event) => (
            <EventSearchCard key={event.id} event={event} />
          ))}
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}
