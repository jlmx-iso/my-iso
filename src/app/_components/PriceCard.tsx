import { Button, Card, Stack, Text } from "@mantine/core";

type CardDetails = {
  buttonText: string;
  buttonVariant: "contained" | "outlined" | "text";
  features: string[];
  loading?: boolean;
  onClick?: () => void;
  price: number;
  title: string;
};

export default function PriceCard(cardDetails: CardDetails) {
  const { title, price, features, buttonText, buttonVariant, onClick, loading } = cardDetails;

  return (
    <Card shadow="sm" padding="lg" radius="lg" w="100%" maw="240">
      <Stack gap="0">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        {price === 0 ? (
          <Text size="xl" fw={700}>
            Free
          </Text>
        ) : (
        <Text size="xl" fw={700}>
          ${price}
          <Text span size="sm" fw={400}>
            /month
          </Text>
        </Text>
        )}
      </Stack>
      <div style={{ marginTop: "1rem" }}>
        {features.map((feature) => (
          <Text key={feature} size="sm">
            {feature}
          </Text>
        ))}
      </div>
      <div style={{ marginTop: "1rem" }}>
        <Button variant={buttonVariant} onClick={onClick} loading={loading}>
          {buttonText}
        </Button>
      </div>
    </Card>
  );
}