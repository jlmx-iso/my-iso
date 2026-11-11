import { Stack, Text } from '@mantine/core';
import EventSearchCard from './EventSearchCard';
import PhotographerCard from './PhotographerCard';
import type { RouterOutputs } from '~/trpc/react';

type SearchResultsProps = {
  results: RouterOutputs['search']['searchAll'];
  searchType: 'all' | 'photographers' | 'events';
};

export default function SearchResults({ results, searchType }: SearchResultsProps) {
  const hasPhotographers = results.photographers.length > 0;
  const hasEvents = results.events.length > 0;

  if (!hasPhotographers && !hasEvents) {
    return (
      <Stack align="center" mt="xl">
        <Text size="lg" c="dimmed">No results found</Text>
      </Stack>
    );
  }

  const showPhotographers = (searchType === 'all' || searchType === 'photographers') && hasPhotographers;
  const showEvents = (searchType === 'all' || searchType === 'events') && hasEvents;

  return (
    <Stack gap="sm">
      {showPhotographers && (
        <>
          {searchType === 'all' && (
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>
              Photographers
            </Text>
          )}
          {results.photographers.map((photographer) => (
            <PhotographerCard key={photographer.id} photographer={photographer} />
          ))}
        </>
      )}

      {showEvents && (
        <>
          {searchType === 'all' && (
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }} mt={showPhotographers ? 'sm' : undefined}>
              Events
            </Text>
          )}
          {results.events.map((event) => (
            <EventSearchCard key={event.id} event={event} />
          ))}
        </>
      )}
    </Stack>
  );
}
