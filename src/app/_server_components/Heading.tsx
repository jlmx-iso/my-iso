import { Title, type TitleOrder } from "@mantine/core"

export const Heading = ({ children, order = 2 }: { children: string; order?: TitleOrder }) => {
    return (
        <Title order={order}>{children}</Title>
    )
}