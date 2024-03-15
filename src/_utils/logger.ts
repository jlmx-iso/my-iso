/* eslint-disable @typescript-eslint/no-explicit-any */
export const logger = {
  info: (message: string, metadata?: Record<string, any>) => {
    console.log(`[INFO] ${message}`, JSON.stringify(metadata, null, 2));
  },

  error: (message: string, metadata?: Record<string, any>) => {
    console.error(`[ERROR] ${message}`, JSON.stringify(metadata, null, 2));
  },

  warn: (message: string, metadata?: Record<string, any>) => {
    console.warn(`[WARN] ${message}`, JSON.stringify(metadata, null, 2));
  },
}