import { Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

type ErrorAlertProps = {
    message: string;
    title: string;
    icon?: JSX.Element;
};

export const ErrorAlert = ({ message, title, icon = <IconInfoCircle /> }: ErrorAlertProps) => {
    return (
        <Alert variant="light" color="red" title={title} icon={icon}>
            {message}
        </Alert>
    );
}