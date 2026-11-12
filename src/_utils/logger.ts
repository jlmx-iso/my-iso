type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type LogMetadata = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: unknown;
}

const MAX_DEPTH = 6;

/**
 * Makes a value safe and useful to pass to JSON.stringify:
 *
 * - `Error` objects become `{ name, message, stack, cause, ...own fields }`.
 *   JSON.stringify on its own turns an Error into `{}`, because its
 *   interesting properties are not enumerable.
 * - bigint becomes a string, functions and symbols a short description.
 * - cycles and very deep structures are cut off instead of throwing.
 */
export function toLoggable(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    if (value.cause !== undefined) {
      serialized.cause = toLoggable(value.cause, depth + 1, seen);
    }
    // Own enumerable extras such as Prisma's `code` or tRPC's `code`.
    for (const [key, extra] of Object.entries(value)) {
      if (!(key in serialized)) serialized[key] = toLoggable(extra, depth + 1, seen);
    }
    return serialized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toLoggable(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toLoggable(item, depth + 1, seen);
  }
  return result;
}

/**
 * Edge-compatible structured logger for production use
 * Features:
 * - Structured JSON logging in production
 * - Pretty-printed logs in development
 * - Timestamp support
 * - Log level filtering
 * - Error objects in metadata are logged with name, message and stack
 *
 * Never pass personal data (email addresses, phone numbers, IP addresses,
 * message bodies, whole user or input objects) as metadata: log ids, or a
 * keyed hash from ~/server/_utils/hash.
 */
const isProd = process.env.NODE_ENV === 'production';

/* eslint-disable no-console -- this module is the one place that writes to the console */
const write = (level: LogLevel, output: string): void => {
  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
};
/* eslint-enable no-console */

const formatLog = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
  const timestamp = new Date().toISOString();
  const safeMetadata = metadata === undefined ? undefined : toLoggable(metadata);

  if (isProd) {
    // Structured JSON logging for production (easier to parse by log aggregators)
    const entry: LogEntry = {
      level,
      message,
      timestamp,
      ...(safeMetadata !== undefined && { metadata: safeMetadata }),
    };
    write(level, JSON.stringify(entry));
  } else {
    // Human-readable logging for development
    const metadataStr = safeMetadata !== undefined ? `\n${JSON.stringify(safeMetadata, null, 2)}` : '';
    write(level, `[${timestamp}] [${level.toUpperCase()}] ${message}${metadataStr}`);
  }
};

export const logger = {
  error: (message: string, metadata?: LogMetadata) => {
    formatLog('error', message, metadata);
  },

  warn: (message: string, metadata?: LogMetadata) => {
    formatLog('warn', message, metadata);
  },

  info: (message: string, metadata?: LogMetadata) => {
    formatLog('info', message, metadata);
  },

  debug: (message: string, metadata?: LogMetadata) => {
    // Only log debug messages in development
    if (!isProd) {
      formatLog('debug', message, metadata);
    }
  },
};
