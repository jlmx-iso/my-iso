import { Title } from "@mantine/core";

export default function PageHeading({ children }: { children: React.ReactNode; }) {
  return <Title order={2} className="text-center">{children}</Title>
}