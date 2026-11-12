import { Alert } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

type DialogErrorProps = {
    /** What went wrong, in the reader's terms; nothing is shown while null. */
    message: string | null | undefined;
    /** A short headline, e.g. "Couldn't save changes". */
    title?: string;
    /** Something to do about it (a retry or an alternative), under the message. */
    children?: React.ReactNode;
    "data-testid"?: string;
};

/**
 * The one way a dialog reports a failure: inside the dialog, directly above
 * its buttons, next to what the person was doing. Never a toast while a
 * dialog is open: a toast lands on top of the dialog's title and fields
 * (on a phone it has nowhere else to go) and is gone before it is read.
 *
 * The wrapper is always rendered so screen readers announce the message the
 * moment it appears.
 */
export default function DialogError({ message, title, children, "data-testid": testId = "dialog-error" }: DialogErrorProps) {
    return (
        <div role="alert">
            {message && (
                // role="presentation": the wrapper is the live region; a second
                // role="alert" inside it would be announced twice.
                <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden />} title={title} role="presentation" data-testid={testId}>
                    {message}
                    {children}
                </Alert>
            )}
        </div>
    );
}
