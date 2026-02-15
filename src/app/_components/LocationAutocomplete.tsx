"use client";

import { Autocomplete, type AutocompleteProps, useCombobox } from '@mantine/core';
import { useMemo, useState } from 'react';

import { debounce } from '~/_utils';
import { api } from '~/trpc/react';

type LocationAutocompleteProps = AutocompleteProps & {
    label: string;
    placeholder: string;
    isRequired: boolean;
};

export function LocationAutocomplete({ label, placeholder, isRequired, ...props }: LocationAutocompleteProps) {
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    });

    const [value, setValue] = useState('');

    const { data: autocompleteData = [] } = api.google.getAutocompleteLocations.useQuery({ query: value }, {
        enabled: value.length > 0,
    });

    const debouncedSetValue = useMemo(() => debounce((newValue: string) => {
        setValue(newValue);
    }, 300), []);

    return (
        <Autocomplete
            {...props}
            label={label}
            placeholder={placeholder}
            required={isRequired}
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
