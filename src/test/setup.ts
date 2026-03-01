// Required env vars — set before any module that reads process.env is imported.
// SKIP_ENV_VALIDATION=1 (set in vitest.config.ts env) disables @t3-oss/env-nextjs validation,
// so these only need to satisfy modules that read process.env directly.
process.env.SKIP_ENV_VALIDATION = "1";
process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = "test-secret-that-is-at-least-32-chars-long!!!";
process.env.STRIPE_SECRET_KEY = "stripe_test_key_placeholder";
process.env.STRIPE_WEBHOOK_SECRET = "stripe_webhook_secret_placeholder";
process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
process.env.DATABASE_URL = undefined as unknown as string; // No DB in tests
process.env.EMAIL_FROM = "test@example.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
process.env.CLOUDINARY_API_KEY = "test-cloudinary-key";
process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://us.posthog.com";
process.env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY = "test-posthog-key";
process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY = "test-places-key";
process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY = "stripe_public_key_placeholder";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-supabase-anon-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
