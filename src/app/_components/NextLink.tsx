"use client";

/**
 * `next/link` as a client reference. A Server Component cannot pass the Link
 * function itself as a prop (`component={Link}`) to a Mantine component, which
 * is a Client Component; it can pass this re-export.
 */
export { default as NextLink } from "next/link";
