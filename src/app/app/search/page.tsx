'use client';

import { useState } from 'react';
import { TextInput, Button, Select, Stack, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconSearch, IconMapPin } from '@tabler/icons-react';
import { api } from '~/trpc/react';
import SearchResults from './_components/SearchResults';

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'photographers' | 'events'>('all');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [hasSearched, setHasSearched] = useState(false);

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

  return (
    <Stack gap="md" p="md">
      <h1>Search</h1>

      <TextInput
        placeholder="Search photographers, events..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        size="md"
      />

      <TextInput
        placeholder="Location (optional)"
        value={location}
        onChange={(e) => setLocation(e.currentTarget.value)}
        leftSection={<IconMapPin size={16} />}
        size="md"
      />

      <Select
        label="Search Type"
        value={searchType}
        onChange={(val) => val && setSearchType(val as 'all' | 'photographers' | 'events')}
        data={[
          { value: 'all', label: 'All' },
          { value: 'photographers', label: 'Photographers' },
          { value: 'events', label: 'Events' },
        ]}
      />

      {searchType !== 'photographers' && (
        <DatePickerInput
          type="range"
          label="Date Range (for events)"
          placeholder="Pick dates"
          value={dateRange}
          onChange={setDateRange}
        />
      )}

      <Button onClick={handleSearch} loading={isLoading} size="md">
        Search
      </Button>

      {error && (
        <Text c="red" size="sm">
          Error searching: {error.message}
        </Text>
      )}

      {hasSearched && results && <SearchResults results={results} />}
      {hasSearched && !isLoading && !error && !results && (
        <Text c="dimmed">No results found</Text>
      )}
    </Stack>
  );
}
