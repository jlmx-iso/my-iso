'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Container, Group, Space, Title, Button, Text, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useSession } from "next-auth/react";
import Link from "next/link";

import FeatureTable from "../_components/FeatureTable";
import PageHeading from "../_components/PageHeading";
import PriceCard from "../_components/PriceCard";
import { api } from "~/trpc/react";
import { env } from "~/env";

export default function Page() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);

  // Check if user has existing subscription
  const { data: subscription } = api.subscription.getCurrentSubscription.useQuery(
    undefined,
    { enabled: !!session }
  );

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
      } else {
        notifications.show({
          color: 'red',
          message: 'Failed to get checkout URL. Please try again.',
          title: 'Checkout Failed',
        });
        setLoading(false);
      }
    },
  });

  const handleUpgradeToPro = () => {
    // Check if user is authenticated
    if (status === 'unauthenticated') {
      notifications.show({
        color: 'blue',
        message: 'Please log in to upgrade to Pro.',
        title: 'Login Required',
      });
      router.push('/login');
      return;
    }

    // Check if user already has active subscription
    if (subscription?.isActive) {
      notifications.show({
        color: 'blue',
        message: 'You already have an active subscription. Manage it from your subscription page.',
        title: 'Already Subscribed',
      });
      router.push('/app/subscription');
      return;
    }

    setLoading(true);

    const priceId = env.NEXT_PUBLIC_STRIPE_PRICE_ID_PRO;

    createCheckout.mutate({
      cancelUrl: `${env.NEXT_PUBLIC_BASE_URL}/pricing`,
      priceId,
      successUrl: `${env.NEXT_PUBLIC_BASE_URL}/app/subscription/success`,
    });
  };

  const handleBasicSignup = () => {
    if (status === 'authenticated') {
      router.push('/app/events');
    } else {
      router.push('/register');
    }
  };

  // Show different UI based on authentication status
  const getProButtonContent = () => {
    if (status === 'loading') {
      return { buttonText: "Loading...", disabled: true };
    }

    if (status === 'unauthenticated') {
      return { buttonText: "Login to Upgrade", disabled: false };
    }

    if (subscription?.isActive) {
      return { buttonText: "Already Subscribed", disabled: true };
    }

    return { buttonText: "Upgrade to Pro", disabled: false };
  };

  const proButton = getProButtonContent();

  return (
    <Container fluid={true}>
      <PageHeading>Pricing</PageHeading>
      <Title order={4} fw={300} fs="italic" className="text-center">
        Choose a plan that works for you
      </Title>

      {subscription?.isActive && (
        <Stack align="center" gap="sm" my="md">
          <Text size="sm" c="green" fw={500}>
            You're currently on the {subscription.planName || 'Pro'} plan
          </Text>
          <Link href="/app/subscription">
            <Button variant="light" size="sm">Manage Subscription</Button>
          </Link>
        </Stack>
      )}

      <Group
        align="center"
        gap="lg"
        justify="center"
        style={{ marginBottom: "2rem", marginTop: "2rem" }}
        w="100%"
      >
        <PriceCard
          buttonText={status === 'authenticated' ? "Current Plan" : "Sign up"}
          buttonVariant="contained"
          features={["Basic features", "Community support", "1 photographer profile"]}
          loading={false}
          onClick={handleBasicSignup}
          price={0}
          title="Basic"
        />
        <PriceCard
          buttonText={proButton.buttonText}
          buttonVariant="outlined"
          features={["All basic features", "Priority support", "Unlimited events", "Advanced analytics"]}
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
              items: ["Basic features", "Community support", "1 photographer profile"],
              title: "Basic",
            },
            {
              items: ["All basic features", "Priority support", "Unlimited events", "Advanced analytics"],
              title: "Pro",
            },
          ]}
        />
      </Container>
    </Container>
  );
}
