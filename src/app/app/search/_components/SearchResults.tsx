import { SimpleGrid, Stack, Title } from '@mantine/core';

import type { RouterOutputs } from '~/trpc/react';

import EventSearchCard from './EventSearchCard';
import PhotographerCard from './PhotographerCard';

type SearchResultsProps = {
  results: Pick<RouterOutputs['search']['searchAll'], 'events' | 'photographers'>;
  searchType: 'all' | 'photographers' | 'events';
};

/** Result grids: photographers two-up, events three-up on wide screens. */
export default function SearchResults({ results, searchType }: SearchResultsProps) {
  const showPhotographers = searchType !== 'events' && results.photographers.length > 0;
  const showEvents = searchType !== 'photographers' && results.events.length > 0;

  return (
    <Stack gap="xl">
      {showPhotographers && (
        <Stack gap="sm" component="section" aria-labelledby="search-photographers">
          <Title order={2} size="h5" id="search-photographers">
            Photographers
          </Title>
          <SimpleGrid component="ul" cols={{ base: 1, md: 2 }} spacing="md" m={0} p={0}>
            {results.photographers.map((photographer) => (
              <li key={photographer.id} style={{ listStyle: 'none', minWidth: 0 }}>
                <PhotographerCard photographer={photographer} />
              </li>
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {showEvents && (
        <Stack gap="sm" component="section" aria-labelledby="search-events">
          <Title order={2} size="h5" id="search-events">
            Events
          </Title>
          <SimpleGrid component="ul" cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" m={0} p={0}>
            {results.events.map((event) => (
              <li key={event.id} style={{ listStyle: 'none', minWidth: 0 }}>
                <EventSearchCard event={event} />
              </li>
            ))}
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}
