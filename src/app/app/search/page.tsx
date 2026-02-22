'use client';

import { useState } from 'react';
import { TextInput, Button, Group, SegmentedControl, Stack, Text, Collapse, ActionIcon, Paper } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { IconAdjustments, IconSearch } from '@tabler/icons-react';
import { api } from '~/trpc/react';
import { LocationAutocomplete } from '~/app/_components/LocationAutocomplete';
import EmptyState from '~/app/_components/EmptyState';
import PageHeader from '~/app/_components/PageHeader';
import SearchResults from './_components/SearchResults';
import SearchLoadingSkeleton from './_components/SearchLoadingSkeleton';

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'photographers' | 'events'>('all');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [hasSearched, setHasSearched] = useState(false);
  const [filtersOpen, { toggle: toggleFilters }] = useDisclosure(false);

  const { data: results, isLoading, error } = api.search.searchAll.useQuery(
    {
      query: searchQuery,
      location: location || undefined,
      filters: {
        type: searchType,
        dateFrom: dateRange[0] ?? undefined,
        dateTo: dateRange[1] ?? undefined,
      },
    },
    { enabled: hasSearched && searchQuery.length > 0 }
  );

  const handleSearch = () => {
    if (searchQuery) {
      setHasSearched(true);
    }
  };

  const hasActiveFilters = location || searchType !== 'all' || dateRange[0] || dateRange[1];

  return (
    <Stack gap="lg">
      <PageHeader
        title="Search"
        description="Find photographers and events near you"
      />

      {/* Search bar */}
      <TextInput
        placeholder="Search photographers, events, locations..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        leftSection={<IconSearch size={20} />}
        rightSection={
          <Button
            size="compact-sm"
            onClick={handleSearch}
            loading={isLoading}
            mr={4}
          >
            Search
          </Button>
        }
        rightSectionWidth={90}
        aria-label="Search query"
        size="lg"
        radius="md"
      />

      {/* Type + filter toggle */}
      <Group justify="space-between" align="center">
        <SegmentedControl
          value={searchType}
          onChange={(val) => setSearchType(val as 'all' | 'photographers' | 'events')}
          data={[
            { value: 'all', label: 'All' },
            { value: 'photographers', label: 'Photographers' },
            { value: 'events', label: 'Events' },
          ]}
          size="sm"
        />
        <ActionIcon
          variant={hasActiveFilters ? "filled" : "subtle"}
          color={hasActiveFilters ? undefined : "gray"}
          onClick={toggleFilters}
          size="lg"
          radius="md"
          aria-label="Toggle filters"
          aria-expanded={filtersOpen}
        >
          <IconAdjustments size={20} />
        </ActionIcon>
      </Group>

      {/* Collapsible filters */}
      <Collapse in={filtersOpen}>
        <Paper p="md" radius="md" withBorder>
          <Stack gap="sm">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.5 }}>
              Filters
            </Text>
            <Group grow gap="sm">
              <LocationAutocomplete
                label="Location"
                placeholder="City, State"
                isRequired={false}
                value={location}
                onChange={(val) => setLocation(val)}
              />
              {searchType !== 'photographers' && (
                <DatePickerInput
                  type="range"
                  label="Date range"
                  placeholder="Select dates"
                  value={dateRange}
                  onChange={(value) => setDateRange(value as [Date | null, Date | null])}
                />
              )}
            </Group>
          </Stack>
        </Paper>
      </Collapse>

      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading && "Searching..."}
        {hasSearched && !isLoading && results &&
          `Found ${results.photographers.length + results.events.length} results`}
        {hasSearched && !isLoading && !error && !results && "No results found"}
        {error && `Error: ${error.message}`}
      </div>

      {error && (
        <Text c="red" size="sm" role="alert">
          Error searching: {error.message}
        </Text>
      )}

      {/* Results */}
      {isLoading && hasSearched && <SearchLoadingSkeleton type={searchType} />}
      {hasSearched && !isLoading && results && <SearchResults results={results} />}
      {hasSearched && !isLoading && !error && !results && (
        <EmptyState
          icon={IconSearch}
          title="No results found"
          description="Try adjusting your search terms or filters."
        />
      )}

      {/* Pre-search state */}
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
