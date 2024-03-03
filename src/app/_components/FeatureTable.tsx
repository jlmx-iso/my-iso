"use client";

import { Table } from "@mantine/core";

type FeatureTableProps = {
  features: {
    title: string;
    items: string[];
  }[];
};

export default function FeatureTable({ features }: FeatureTableProps) {
  // convert the items into rows where each column is an item from a feature
  // e.g. [{ title: "Basic", items: ["1 user", "1 project", "1000 requests"] }], [{ title: "Pro", items: ["5 users", "10 projects", "5000 requests"] }]
  // to ["1 user", "5 users"], ["1 project", "10 projects"], ["1000 requests", "5000 requests"]

  const rows = features[0]?.items.map((_, i) => {
    return features.map((feature) => feature.items[i]);
  });

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          {features.map((feature) => (
            <Table.Th key={feature.title}>{feature.title}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows?.map((row) => (
          <Table.Tr key={row.join()}>
            {row.map((item) => (
              <Table.Td key={item}>{item}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}