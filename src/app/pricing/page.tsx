import { Container, Group, Space, Title } from "@mantine/core";

import FeatureTable from "../_components/FeatureTable";
import PageHeading from "../_components/PageHeading";
import PriceCard from "../_components/PriceCard";

export default function Page() {
  return (
    <Container fluid={true}>
      <PageHeading>Pricing</PageHeading>
      <Title order={4} fw={300} fs="italic" className="text-center">
        Choose a plan that works for you
      </Title>
      <Group
        align="center"
        gap="lg"
        justify="center"
        style={{ marginBottom: "2rem", marginTop: "2rem" }}
        w="100%"
      >
        <PriceCard
          title="Basic"
          price={0}
          features={["1 user", "1 project", "1000 requests"]}
          buttonText="Sign up"
          buttonVariant="contained"
        />
        <PriceCard
          title="Pro"
          price={10}
          features={["5 users", "10 projects", "5000 requests"]}
          buttonText="Sign up"
          buttonVariant="outlined"
        />
      </Group>
      <Space h="xl" />
      <Container>
        <Title order={3} fw={300}>
          Compare Features
        </Title>
        <FeatureTable
          features={[
            {
              items: ["1 user", "1 project", "1000 requests"],
              title: "Basic",
            },
            {
              items: ["5 users", "10 projects", "5000 requests"],
              title: "Pro",
            },
          ]}
        />
      </Container>
    </Container>
  );
}