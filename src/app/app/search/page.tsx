'use client';

import { ActionIcon, Alert, Button, Collapse, Group, Paper, SegmentedControl, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates';
import { useDisclosure, useId } from '@mantine/hooks';
import { IconAdjustments, IconAlertCircle, IconSearch, IconSearchOff } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';

import { userFacingError } from '~/_utils/userError';
import EmptyState from '~/app/_components/EmptyState';
import { LocationAutocomplete } from '~/app/_components/LocationAutocomplete';
import PageHeader from '~/app/_components/PageHeader';
import { api } from '~/trpc/react';

import SearchLoadingSkeleton from './_components/SearchLoadingSkeleton';
import SearchResults from './_components/SearchResults';

type SearchType = 'all' | 'photographers' | 'events';

function Search() {
  const router = useRouter();
  const pathname = usePathname();
  // The submitted query lives in the URL (?q=), so results survive a reload,
  // the back button, and can be shared.
  const submittedQuery = useSearchParams().get('q')?.trim() ?? '';

  const [draft, setDraft] = useState(submittedQuery);
  const [location, setLocation] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [dateRange, setDateRange] = useState<DatesRangeValue<string>>([null, null]);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);
  const filtersId = useId();

  const hasSearched = submittedQuery.length > 0;

  // Always fetch all types — searchType only controls client-side display filtering
  const { data: results, isLoading, error, refetch } = api.search.searchAll.useQuery(
    {
      query: submittedQuery,
      location: location || undefined,
      filters: {
        type: 'all',
        // @mantine/dates emits local `YYYY-MM-DD` strings; the API expects Dates.
        dateFrom: dateRange[0] ? dayjs(dateRange[0]).startOf('day').toDate() : undefined,
        dateTo: dateRange[1] ? dayjs(dateRange[1]).endOf('day').toDate() : undefined,
      },
    },
    { enabled: hasSearched }
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const query = draft.trim();
    router.replace(query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname, { scroll: false });
  };

  const hasActiveFilters = !!(location || dateRange[0] || dateRange[1]);

  const photographerCount = results?.photographers.length ?? 0;
  const eventCount = results?.events.length ?? 0;
  const totalCount = photographerCount + eventCount;
  const hasResults = !!results && totalCount > 0;

  return (
    <Stack gap="md">
      <PageHeader title="Search" description="Find photographers and events by name, specialty or place" />

      <form role="search" onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            type="search"
            name="q"
            placeholder="Photographers, events, cities…"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            leftSection={<IconSearch size={20} aria-hidden />}
            rightSection={
              <Group gap={4} wrap="nowrap" mr={4}>
                <ActionIcon
                  variant={hasActiveFilters ? 'filled' : 'subtle'}
                  color={hasActiveFilters ? undefined : 'gray'}
                  onClick={toggleFilters}
                  size="lg"
                  aria-label={hasActiveFilters ? 'Filters (active)' : 'Filters'}
                  aria-expanded={filtersOpen}
                  aria-controls={filtersId}
                >
                  <IconAdjustments size={18} />
                </ActionIcon>
                <Button type="submit" size="compact-md" loading={isLoading}>
                  Search
                </Button>
              </Group>
            }
            rightSectionWidth={140}
            aria-label="Search photographers and events"
            autoComplete="off"
            enterKeyHint="search"
            size="lg"
            radius="md"
          />

          <Collapse expanded={filtersOpen} id={filtersId}>
            <Paper p="sm" radius="md" withBorder>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <LocationAutocomplete
                  label="Location"
                  placeholder="City, State"
                  isRequired={false}
                  value={location}
                  onChange={(val) => setLocation(val)}
                />
                <DatePickerInput
                  type="range"
                  label="Event dates"
                  description="Choose a start and an end date"
                  placeholder="Any time"
                  clearable
                  value={dateRange}
                  onChange={setDateRange}
                />
              </SimpleGrid>
            </Paper>
          </Collapse>
        </Stack>
      </form>

      {hasSearched && !isLoading && hasResults && (
        <SegmentedControl
          value={searchType}
          onChange={(v) => setSearchType(v)}
          aria-label="Show"
          data={[
            { label: `All (${totalCount})`, value: 'all' },
            { label: `Photographers (${photographerCount})`, value: 'photographers' },
            { label: `Events (${eventCount})`, value: 'events' },
          ]}
          size="sm"
          w={{ base: '100%', sm: 'fit-content' }}
        />
      )}

      {/* Always rendered so screen readers announce the outcome of a search. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading && 'Searching…'}
        {hasSearched && !isLoading && results &&
          (totalCount === 0
            ? `No results for ${submittedQuery}`
            : `${totalCount} ${totalCount === 1 ? 'result' : 'results'} for ${submittedQuery}`)}
      </div>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Search didn't work" role="alert">
          {userFacingError(error, 'Something went wrong on our side. Please try again.')}
          <Group mt="xs">
            <Button variant="default" size="xs" onClick={() => void refetch()}>
              Try again
            </Button>
          </Group>
        </Alert>
      )}

      {isLoading && hasSearched && <SearchLoadingSkeleton type={searchType} />}
      {hasSearched && !isLoading && hasResults && <SearchResults results={results} searchType={searchType} />}

      {/* Same visual language for "nothing found" and "nothing searched yet". */}
      {hasSearched && !isLoading && !error && results && !hasResults && (
        <EmptyState
          icon={IconSearchOff}
          title={`No results for "${submittedQuery}"`}
          description={
            hasActiveFilters
              ? 'Try a different spelling, or remove the location and date filters.'
              : 'Try a different spelling, a first name, a city, or a type of shoot like "wedding".'
          }
        />
      )}
      {!hasSearched && (
        <EmptyState
          icon={IconSearch}
          title="Discover the network"
          description="Search for photographers by name, specialty, or location. Find events near you."
        />
      )}
    </Stack>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <Search />
    </Suspense>
  );
}
