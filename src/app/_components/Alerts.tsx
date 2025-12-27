import { Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { type ReactElement } from 'react';

type ErrorAlertProps = {
    message: string;
    title: string;
    icon?: ReactElement;
};

export const ErrorAlert = ({ message, title, icon = <IconInfoCircle /> }: ErrorAlertProps) => {
    return (
        <Alert variant="light" color="red" title={title} icon={icon}>
            {message}
        </Alert>
    );
}