"use client";

import { ActionIcon, type ActionIconProps, Button, type ButtonProps, Modal as MantineModal } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';

type ModalProps = {
    title: string;
    children: React.ReactNode;
    /**
     * Pass `opened` to control the modal from the parent, which then updates
     * it in `onOpen` and `onClose`. Without it the modal keeps its own state
     * and the two callbacks are notifications.
     */
    opened?: boolean;
    onOpen?: () => void;
    onClose?: () => void;
};

type ActionIconModalProps = ModalProps & {
    actionIconProps: ActionIconProps;
    icon: React.ReactNode;
    isIconModal: true;
}

type ButtonModalProps = ModalProps & {
    buttonProps: ButtonProps;
    buttonLabel: string | React.ReactNode;
    isIconModal: false;
};

/** A modal together with the button (or icon button) that opens it. */
export function Modal({ children, title, opened: controlledOpened, onOpen, onClose, ...props }: ActionIconModalProps | ButtonModalProps) {
    const [opened, setOpened] = useUncontrolled({
        value: controlledOpened,
        defaultValue: false,
        finalValue: false,
        onChange: (next) => (next ? onOpen : onClose)?.(),
    });
    const open = () => setOpened(true);
    const close = () => setOpened(false);

    return (
        <>
            <MantineModal opened={opened} onClose={close} title={title}>
                {children}
            </MantineModal>

            {props.isIconModal
                ? <ActionIcon onClick={open} {...props.actionIconProps}>{props.icon}</ActionIcon>
                : <Button onClick={open} {...props.buttonProps}>{props.buttonLabel}</Button>}
        </>
    );
}
