import { Alert, Box, Container, Divider, List, ListItem, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { isValidElement, type ReactNode } from "react";

export type LegalSection = {
  title: string;
  /** Paragraphs, in order. */
  body: ReactNode[];
  /** An optional list after the paragraphs. */
  list?: ReactNode[];
  /** An optional table after the list: a header row, then rows. */
  table?: { head: string[]; rows: ReactNode[][] };
};

/**
 * Layout of the legal pages (/privacy, /terms, /subprocessors): a draft
 * notice, a title, the date of the text and numbered sections. Server
 * component; no scripts.
 */
export default function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  /** When the text last changed, as people should read it ("November 2026"). */
  updated: string;
  intro?: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <Container size="md" w="100%">
      <Box py={60}>
        <Stack gap="lg" mb={40}>
          <Alert color="gray" variant="light" icon={<IconInfoCircle size={18} aria-hidden />}>
            <strong>Draft — pending legal review.</strong> This describes what ISO does today. A lawyer
            hasn&apos;t reviewed it yet, so the wording may change.
          </Alert>
          <Text size="sm" fw={600} c="orange" tt="uppercase" style={{ letterSpacing: 1 }}>
            Legal
          </Text>
          <Title order={1}>{title}</Title>
          <Text c="dimmed" size="sm">
            Last updated: {updated}
          </Text>
          {intro && <Text style={{ lineHeight: 1.7 }}>{intro}</Text>}
        </Stack>

        <Divider mb="xl" />

        <Stack gap="xl">
          {sections.map((section, index) => (
            <section key={section.title} aria-labelledby={`legal-section-${index + 1}`}>
              <Title order={2} size="h3" mb="xs" id={`legal-section-${index + 1}`}>
                {index + 1}. {section.title}
              </Title>
              <Stack gap="sm">
                {section.body.filter((paragraph) => !rendersEmpty(paragraph)).map((paragraph, paragraphIndex) => (
                  <Text key={paragraphIndex} style={{ lineHeight: 1.7 }}>
                    {paragraph}
                  </Text>
                ))}
                {section.list && (
                  <List spacing="xs" style={{ lineHeight: 1.6 }}>
                    {section.list.map((item, itemIndex) => (
                      <ListItem key={itemIndex}>{item}</ListItem>
                    ))}
                  </List>
                )}
                {section.table && (
                  <Box style={{ overflowX: "auto" }}>
                    <table className="legal-table">
                      <thead>
                        <tr>
                          {section.table.head.map((heading) => (
                            <th key={heading} scope="col">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                )}
              </Stack>
            </section>
          ))}
        </Stack>
      </Box>
    </Container>
  );
}

/** A paragraph that is only an owner TODO with no fallback, in production: nothing to show. */
function rendersEmpty(paragraph: ReactNode): boolean {
  return (
    isProductionBuild() &&
    isValidElement<{ fallback?: ReactNode }>(paragraph) &&
    paragraph.type === OwnerTodo &&
    paragraph.props.fallback === ""
  );
}

/** Whether this build is the production deployment (NEXT_PUBLIC_APP_ENV, inlined at build). */
export function isProductionBuild(): boolean {
  return process.env.NEXT_PUBLIC_APP_ENV === "production";
}

/**
 * A fact the owner must fill in before the text is final. Outside
 * production it is shown as a red marker, so it cannot be missed; in
 * production `fallback` is shown instead, which keeps the sentence
 * grammatical and true without the missing fact. Fill these in before
 * launch (docs/DEPLOYMENT.md, first deploy checklist).
 */
export function OwnerTodo({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  if (isProductionBuild()) return <>{fallback}</>;
  return (
    <Text span fw={700} c="var(--mantine-color-error)" data-owner-todo>
      [TODO for the owner: {children}]
    </Text>
  );
}
