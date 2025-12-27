'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Container, Group, Space, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";

import FeatureTable from "../_components/FeatureTable";
import PageHeading from "../_components/PageHeading";
import PriceCard from "../_components/PriceCard";
import { api } from "~/trpc/react";

export default function Page() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onError: (error) => {
      notifications.show({
        color: 'red',
        message: error.message || 'Failed to start checkout. Please try again.',
        title: 'Checkout Failed',
      });
      setLoading(false);
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  const handleUpgradeToPro = () => {
    setLoading(true);

    const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO || '';

    if (!priceId) {
      notifications.show({
        color: 'red',
        message: 'Stripe configuration missing. Please contact support.',
        title: 'Configuration Error',
      });
      setLoading(false);
      return;
    }

    createCheckout.mutate({
      cancelUrl: `${window.location.origin}/pricing`,
      priceId,
      successUrl: `${window.location.origin}/app/subscription/success`,
    });
  };

  const handleBasicSignup = () => {
    router.push('/register');
  };

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
          buttonText="Sign up"
          buttonVariant="contained"
          features={["1 user", "1 project", "1000 requests"]}
          onClick={handleBasicSignup}
          price={0}
          title="Basic"
        />
        <PriceCard
          buttonText="Sign up"
          buttonVariant="outlined"
          features={["5 users", "10 projects", "5000 requests"]}
          loading={loading}
          onClick={handleUpgradeToPro}
          price={10}
          title="Pro"
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