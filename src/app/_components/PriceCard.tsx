import { Button, Card, Stack, Text } from "@mantine/core";

type CardDetails = {
  title: string;
  price: number;
  features: string[];
  buttonText: string;
  buttonVariant: "contained" | "outlined" | "text";
};

export default function PriceCard(cardDetails: CardDetails) {
  const { title, price, features, buttonText, buttonVariant } = cardDetails;

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
        <Button variant={buttonVariant}>{buttonText}</Button>
      </div>
    </Card>
  );
}