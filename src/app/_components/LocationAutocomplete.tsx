"use client";

import { Autocomplete, type AutocompleteProps, useCombobox } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';

import { debounce } from '~/_utils';
import { api } from '~/trpc/react';

type LocationAutocompleteProps = AutocompleteProps & {
    label: string;
    placeholder: string;
    isRequired: boolean;
};

/** The server returns nothing for shorter queries, so none are sent. */
export const LOCATION_MIN_QUERY_LENGTH = 3;
const LOCATION_HINT = `Type at least ${LOCATION_MIN_QUERY_LENGTH} letters to see suggestions`;

export function LocationAutocomplete({ label, placeholder, isRequired, description, ...props }: LocationAutocompleteProps) {
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    });

    const [value, setValue] = useState('');

    const { data: autocompleteData = [] } = api.google.getAutocompleteLocations.useQuery({ query: value }, {
        enabled: value.trim().length >= LOCATION_MIN_QUERY_LENGTH,
    });

    const debouncedSetValue = useMemo(() => debounce((newValue: string) => {
        setValue(newValue);
    }, 300), []);

    useEffect(() => {
        return () => debouncedSetValue.cancel();
    }, [debouncedSetValue]);

    return (
        <Autocomplete
            {...props}
            label={label}
            placeholder={placeholder}
            required={isRequired}
            description={description ? <>{description} {LOCATION_HINT}.</> : `${LOCATION_HINT}.`}
            data={autocompleteData}
            onChange={(event) => {
                if (props.onChange) {
                    props.onChange(event);
                }
                debouncedSetValue(event);
                combobox.resetSelectedOption();
                combobox.openDropdown();
            }}
        />
    );
}
