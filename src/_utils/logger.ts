/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Edge-compatible structured logger for production use
 * Features:
 * - Structured JSON logging in production
 * - Pretty-printed logs in development
 * - Timestamp support
 * - Log level filtering
 */
const isProd = process.env.NODE_ENV === 'production';

const formatLog = (level: LogLevel, message: string, metadata?: Record<string, any>): void => {
  const timestamp = new Date().toISOString();

  if (isProd) {
    // Structured JSON logging for production (easier to parse by log aggregators)
    const entry: LogEntry = {
      level,
      message,
      timestamp,
      ...(metadata && { metadata }),
    };
    const output = JSON.stringify(entry);

    // Use appropriate console method
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
  } else {
    // Human-readable logging for development
    const metadataStr = metadata ? `\n${JSON.stringify(metadata, null, 2)}` : '';
    const output = `[${timestamp}] [${level.toUpperCase()}] ${message}${metadataStr}`;

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
  }
};

export const logger = {
  error: (message: string, metadata?: Record<string, any>) => {
    formatLog('error', message, metadata);
  },

  warn: (message: string, metadata?: Record<string, any>) => {
    formatLog('warn', message, metadata);
  },

  info: (message: string, metadata?: Record<string, any>) => {
    formatLog('info', message, metadata);
  },

  debug: (message: string, metadata?: Record<string, any>) => {
    // Only log debug messages in development
    if (!isProd) {
      formatLog('debug', message, metadata);
    }
  },
};