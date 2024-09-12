"use client";

import { ActionIcon, type ActionIconProps, Button, type ButtonProps, Modal as MantineModal, type ModalProps as MantineModalProps } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

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