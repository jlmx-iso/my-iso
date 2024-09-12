/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */


/**
 * A simple logger that logs messages to the console.
 * TODO: Replace with a proper logger like Winston or Pino.
 */
export const logger = {
  error: (message: string, metadata?: Record<string, any>) => {
    console.error(`[ERROR] ${message}`, JSON.stringify(metadata, null, 2));
  },

  info: (message: string, metadata?: Record<string, any>) => {
    console.log(`[INFO] ${message}`, JSON.stringify(metadata, null, 2));
  },

  warn: (message: string, metadata?: Record<string, any>) => {
    console.warn(`[WARN] ${message}`, JSON.stringify(metadata, null, 2));
  },
}