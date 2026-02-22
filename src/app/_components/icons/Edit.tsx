"use client";

import { ActionIcon } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import Link, { type LinkProps } from "next/link";

type BaseEditIconProps = {
    size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
};

type EditIconButtonProps = BaseEditIconProps & {
    onClick?: () => void;
};

type EditIconLinkProps = BaseEditIconProps & LinkProps;

type EditIconProps = EditIconButtonProps | EditIconLinkProps;

export const EditIcon = (props: EditIconProps) => {
    const componentType = "onClick" in props ? "button" : "link";
    const { size, onClick, href } = props as EditIconButtonProps & EditIconLinkProps;
    return (
        <ActionIcon onClick={onClick} size={size} component={componentType === "link" ? Link : undefined} href={href} variant="subtle">
            <IconPencil size={size} />
        </ActionIcon>
    );
};