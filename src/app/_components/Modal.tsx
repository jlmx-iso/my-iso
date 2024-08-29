"use client";

import { useDisclosure } from '@mantine/hooks';
import { ActionIcon, type ActionIconProps, Button, Modal as MantineModal, type ModalProps as MantineModalProps, type ButtonProps } from '@mantine/core';

type ModalProps = Partial<MantineModalProps> & {
    title: string;
    children: React.ReactNode;
};

type ActionIconModalProps = ModalProps & {
    actionIconProps: ActionIconProps;
    icon: React.ReactNode;
    isIconModal: true;
}

type ButtonModalProps = ModalProps & {
    buttonProps: ButtonProps;
    buttonLabel: string;
    isIconModal: false;
};

export function Modal({ children, title, ...props }: ActionIconModalProps | ButtonModalProps) {
    const [opened, { open, close }] = useDisclosure(false);

    if (props.isIconModal) {
        const { actionIconProps, icon } = props;

        return (
            <>
                <MantineModal opened={opened} onClose={close} title={title}>
                    {children}
                </MantineModal>

                <ActionIcon onClick={open} {...actionIconProps}>{icon}</ActionIcon>
            </>
        );
    };

    const { buttonLabel, buttonProps } = props;

    return (
        <>
            <MantineModal opened={opened} onClose={close} title={title}>
                {children}
            </MantineModal>

            <Button onClick={open} {...buttonProps}>{buttonLabel}</Button>
        </>
    )


}