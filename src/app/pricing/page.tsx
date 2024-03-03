import { Container, Group, Space, Table, Title } from "@mantine/core";
import PriceCard from "../_components/PriceCard";
import PageHeading from "../_components/PageHeading";
import FeatureTable from "../_components/FeatureTable";

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
          style={{ marginTop: "2rem", marginBottom: "2rem" }}
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
              title: "Basic",
              items: ["1 user", "1 project", "1000 requests"],
            },
            {
              title: "Pro",
              items: ["5 users", "10 projects", "5000 requests"],
            },
          ]}
        />
      </Container>
    </Container>
  );
}