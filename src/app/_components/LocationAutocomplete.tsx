import { Autocomplete, type AutocompleteProps, useCombobox } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';

import { debounce, logger } from '~/_utils';
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

    const [data, setData] = useState<string[]>();
    const [value, setValue] = useState('');

    const { data: autocompleteData = [], isSuccess, error } = api.google.getAutocompleteLocations.useQuery({ query: value }, {
        enabled: value.length > 0,
    });

    useEffect(() => {
        if (isSuccess) {
            setData(autocompleteData);
        }

        if (error) {
            logger.error("Error fetching location autocomplete data", { error });
        }

    }, [isSuccess, error, autocompleteData]);

    const debouncedSetValue = useMemo(() => debounce((newValue: string) => {
        setValue(newValue);
    }, 300), []);

    return (
        <Autocomplete
            {...props}
            label={label}
            placeholder={placeholder}
            required={isRequired}
            data={data}
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
