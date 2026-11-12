import type { ZodType } from "zod";

type Def = {
  type: string;
  checks?: Array<{ _zod: { def: { check: string; minimum?: number; value?: number; inclusive?: boolean; format?: string } } }>;
  format?: string;
  shape?: Record<string, ZodType>;
  element?: ZodType;
  innerType?: ZodType;
  in?: ZodType;
  options?: ZodType[];
  entries?: Record<string, string | number>;
  values?: unknown[];
  items?: ZodType[];
};

const NO_VALUE = Symbol("no value");

const defOf = (schema: ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

function checks(def: Def) {
  return (def.checks ?? []).map((check) => check._zod.def);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sampleString(def: Def): string | typeof NO_VALUE {
  const format = def.format ?? checks(def).find((check) => check.check === "string_format")?.format;
  const min = Math.max(1, ...checks(def).filter((check) => check.check === "min_length").map((check) => check.minimum ?? 0));
  switch (format) {
    case undefined:
      return "a".repeat(min);
    case "email":
      return "member@example.com";
    case "url":
      return "https://example.com/";
    case "datetime":
      return new Date(Date.now() + 30 * DAY_MS).toISOString();
    case "cuid":
      return "cjld2cjxh0000qzrmn831i7rn";
    case "uuid":
      return "123e4567-e89b-42d3-a456-426614174000";
    default:
      return NO_VALUE;
  }
}

function sampleNumber(def: Def): number {
  const lower = checks(def).find((check) => check.check === "greater_than");
  if (lower?.value === undefined) return 1;
  return lower.inclusive ? lower.value : lower.value + 1;
}

function sample(schema: ZodType): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "string":
      return sampleString(def);
    case "number":
      return sampleNumber(def);
    case "boolean":
      return false;
    case "date":
      return new Date(Date.now() + 30 * DAY_MS);
    case "enum":
      return Object.values(def.entries ?? {})[0] ?? NO_VALUE;
    case "literal":
      return def.values?.[0] ?? NO_VALUE;
    case "optional":
    case "default":
      return undefined;
    case "nullable":
      return null;
    case "pipe":
      return def.in ? sample(def.in) : NO_VALUE;
    case "union": {
      for (const option of def.options ?? []) {
        const value = sample(option);
        if (value !== NO_VALUE && option.safeParse(value).success) return value;
      }
      return NO_VALUE;
    }
    case "array": {
      const min = checks(def).find((check) => check.check === "min_length")?.minimum ?? 0;
      const items = Array.from({ length: min }, () => (def.element ? sample(def.element) : NO_VALUE));
      return items.includes(NO_VALUE) ? NO_VALUE : items;
    }
    case "tuple": {
      const items = (def.items ?? []).map(sample);
      return items.includes(NO_VALUE) ? NO_VALUE : items;
    }
    case "record":
      return {};
    case "object": {
      const value: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(def.shape ?? {})) {
        const fieldValue = sample(field);
        if (fieldValue === NO_VALUE) return NO_VALUE;
        if (fieldValue !== undefined) value[key] = fieldValue;
      }
      return value;
    }
    default:
      return NO_VALUE;
  }
}

/**
 * A small value that `schemas` (a procedure's inputs, merged as tRPC merges
 * them) accept, built from the schemas themselves; undefined when one
 * cannot be built (a regex, a refinement that the sample fails). For tests
 * that must get past input validation to reach a procedure's own code.
 */
export function minimalInput(schemas: readonly ZodType[]): unknown {
  if (schemas.length === 0) return undefined;
  const parts = schemas.map(sample);
  if (parts.includes(NO_VALUE)) return undefined;
  const value = parts.length === 1 ? parts[0] : Object.assign({}, ...parts.map((part) => part ?? {}));
  return schemas.every((schema) => schema.safeParse(value).success) ? value : undefined;
}
