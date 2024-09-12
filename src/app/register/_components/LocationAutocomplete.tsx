import { Autocomplete, type AutocompleteProps, useCombobox } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';

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

    const [data, setData] = useState<string[]>();
    const [value, setValue] = useState('');

    const { data: autocompleteData = [], isSuccess, isError } = api.google.getAutocompleteLocations.useQuery({ input: value }, {
        enabled: value.length > 0,
    });

    useEffect(() => {
        if (isSuccess) {
            setData(autocompleteData);
        }

        if (isError) {
            // add error handling here
            // eslint-disable-next-line no-console
            console.log("Error fetching data");
        }

    }, [isSuccess, isError, autocompleteData]);

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
};
