'use client';

import { ActionIcon, Alert, Button, Collapse, Group, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates';
import { useDebouncedValue, useDisclosure, useId } from '@mantine/hooks';
import { IconAdjustments, IconAlertCircle, IconSearch, IconSearchOff } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useRef, useState } from 'react';

import { SEARCH_MAX_OFFSET } from '~/_utils/limits';
import { SEARCH_PAGE_SIZE } from '~/_utils/pageSizes';
import { loadedCountLabel, mergeOffsetPages } from '~/_utils/pagination';
import { userFacingError } from '~/_utils/userError';
import EmptyState from '~/app/_components/EmptyState';
import { LocationAutocomplete } from '~/app/_components/LocationAutocomplete';
import PageHeader from '~/app/_components/PageHeader';
import { focusInto } from '~/app/_hooks/useFocusNewItems';
import { api } from '~/trpc/react';

import SearchLoadingSkeleton from './_components/SearchLoadingSkeleton';
import SearchResults from './_components/SearchResults';

type SearchType = 'all' | 'photographers' | 'events';

const LOCATION_DEBOUNCE_MS = 450;

function Search() {
  const router = useRouter();
  const pathname = usePathname();
  // The submitted query lives in the URL (?q=), so results survive a reload,
  // the back button, and can be shared.
  const submittedQuery = useSearchParams().get('q')?.trim() ?? '';

  // What is in the box. It follows the URL: after Back or Forward the box
  // shows the query whose results are on screen, not the last thing typed.
  const [typed, setTyped] = useState({ forQuery: submittedQuery, value: submittedQuery });
  const draft = typed.forQuery === submittedQuery ? typed.value : submittedQuery;
  const setDraft = (value: string) => setTyped({ forQuery: submittedQuery, value });

  const [locationDraft, setLocation] = useState('');
  // The location filter is typed into: search once the typing pauses, not on
  // every keystroke.
  const [location] = useDebouncedValue(locationDraft.trim(), LOCATION_DEBOUNCE_MS);
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [dateRange, setDateRange] = useState<DatesRangeValue<string>>([null, null]);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);
  const filtersId = useId();

  const hasSearched = submittedQuery.length > 0;

  // The server filters by date only when it gets both ends, so a half-chosen
  // range is not sent at all (and is not shown as an active filter).
  const [dateFrom, dateTo] = dateRange;
  const hasDateRange = !!dateFrom && !!dateTo;
  const searchInput = {
    query: submittedQuery,
    location: location || undefined,
    filters: {
      // Always fetch all types — searchType only controls client-side display filtering
      type: 'all' as const,
      // @mantine/dates emits local `YYYY-MM-DD` strings; the API expects Dates.
      ...(hasDateRange
        ? { dateFrom: dayjs(dateFrom).startOf('day').toDate(), dateTo: dayjs(dateTo).endOf('day').toDate() }
        : {}),
    },
  };

  // "Load more" adds a page; a new search starts again from the first one.
  const searchKey = JSON.stringify([submittedQuery, location, hasDateRange ? dateRange : null]);
  const [paging, setPaging] = useState({ count: 1, key: searchKey });
  const pageCount = paging.key === searchKey ? paging.count : 1;

  // One query per loaded page. Each asks for one row more than a page holds,
  // which is how the client knows whether there is more to load.
  const pages = api.useQueries((t) =>
    Array.from({ length: hasSearched ? pageCount : 0 }, (_, index) =>
      t.search.searchAll({ ...searchInput, limit: SEARCH_PAGE_SIZE + 1, offset: index * SEARCH_PAGE_SIZE }),
    ),
  );
  const firstPage = pages[0];
  const lastPage = pages.at(-1);
  const isLoading = hasSearched && !!firstPage?.isPending;
  const error = firstPage?.error ?? null;
  const isLoadingMore = pageCount > 1 && !!lastPage?.isPending;
  const loadMoreError = pageCount > 1 ? (lastPage?.error ?? null) : null;

  const photographers = mergeOffsetPages(pages.map((page) => page.data?.photographers), SEARCH_PAGE_SIZE);
  const events = mergeOffsetPages(pages.map((page) => page.data?.events), SEARCH_PAGE_SIZE);
  const results = firstPage?.data ? { events: events.items, photographers: photographers.items } : undefined;
  const hasMore =
    (photographers.hasMore || events.hasMore) && pageCount * SEARCH_PAGE_SIZE <= SEARCH_MAX_OFFSET;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const query = draft.trim();
    if (query === submittedQuery) return;
    // A history entry per search, so Back returns to the previous results.
    router.push(query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname, { scroll: false });
  };

  const hasActiveFilters = !!locationDraft.trim() || hasDateRange;

  const photographerCount = results?.photographers.length ?? 0;
  const eventCount = results?.events.length ?? 0;
  const totalCount = photographerCount + eventCount;
  const hasResults = !!results && totalCount > 0;
  // Counts never claim to be the total while more can be loaded: "20+".
  const totalLabel = loadedCountLabel(totalCount, hasMore);

  // After "Load more", focus goes to the first result that was added (the
  // button may be gone, which would otherwise leave focus on <body>).
  const resultsRef = useRef<HTMLDivElement>(null);
  const countsWhenAsked = useRef<{ events: number; photographers: number } | null>(null);
  useEffect(() => {
    const before = countsWhenAsked.current;
    if (!before || (photographerCount <= before.photographers && eventCount <= before.events)) return;
    countsWhenAsked.current = null;
    const morePhotographers = photographerCount > before.photographers && searchType !== 'events';
    const [list, index] = morePhotographers ? ['photographers', before.photographers] : ['events', before.events];
    focusInto(resultsRef.current?.querySelector(`[data-results="${list}"]`)?.children.item(index));
  }, [eventCount, photographerCount, searchType]);

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
                  className="touch-target"
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
                  value={locationDraft}
                  onChange={(val) => setLocation(val)}
                />
                <DatePickerInput
                  type="range"
                  label="Event dates"
                  description={
                    dateFrom && !dateTo
                      ? 'Now choose the end date. The filter applies once both are set.'
                      : 'Choose a start and an end date'
                  }
                  placeholder="Any time"
                  clearable
                  allowSingleDateInRange
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
          name="search-result-type"
          value={searchType}
          onChange={(v) => setSearchType(v)}
          aria-label="Show"
          data={[
            { label: `All (${totalLabel})`, value: 'all' },
            { label: `Photographers (${loadedCountLabel(photographerCount, hasMore && photographers.hasMore)})`, value: 'photographers' },
            { label: `Events (${loadedCountLabel(eventCount, hasMore && events.hasMore)})`, value: 'events' },
          ]}
          size="sm"
          w={{ base: '100%', sm: 'fit-content' }}
        />
      )}

      {/* Always rendered so screen readers announce the outcome of a search. */}
      <div role="status" aria-atomic="true" className="sr-only">
        {isLoading && 'Searching…'}
        {hasSearched && !isLoading && results &&
          (totalCount === 0
            ? `No results for ${submittedQuery}`
            : hasMore
              ? `Showing the first ${totalCount} results for ${submittedQuery}. More are available.`
              : `${totalCount} ${totalCount === 1 ? 'result' : 'results'} for ${submittedQuery}`)}
      </div>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} title="Search didn't work">
          {userFacingError(error, 'Something went wrong on our side. Please try again.')}
          <Group mt="xs">
            <Button variant="default" size="xs" onClick={() => void firstPage?.refetch()}>
              Try again
            </Button>
          </Group>
        </Alert>
      )}

      {isLoading && hasSearched && <SearchLoadingSkeleton type={searchType} />}
      {hasSearched && !isLoading && hasResults && (
        <div ref={resultsRef}>
          <SearchResults results={results} searchType={searchType} />
        </div>
      )}

      {hasSearched && !isLoading && hasResults && hasMore && (
        <Stack gap={6} align="center">
          <Text size="sm" c="dimmed" data-testid="search-partial">
            Showing the first {totalCount} results
          </Text>
          <Button
            variant="default"
            loading={isLoadingMore}
            onClick={() => {
              countsWhenAsked.current = { events: eventCount, photographers: photographerCount };
              if (loadMoreError) void lastPage?.refetch();
              else setPaging({ count: pageCount + 1, key: searchKey });
            }}
          >
            {loadMoreError ? 'Try again' : 'Load more results'}
          </Button>
          {loadMoreError && (
            <Text size="sm" c="red" role="alert">
              {userFacingError(loadMoreError, "We couldn't load more results. Please try again.")}
            </Text>
          )}
        </Stack>
      )}

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
