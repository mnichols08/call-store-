// Configuration comes from the environment, once, here.
const production = process.env.NODE_ENV === 'production';

export const config = Object.freeze({
  production,
  port: Number(process.env.PORT ?? 3000),
  // On Railway (or anywhere) point this at a persistent volume.
  database: process.env.DATABASE_PATH ?? 'data/call-store.db',
  // Name shown in the header and on sign-in.
  business: process.env.BUSINESS_NAME ?? 'Southern Auto Supply',
  // IANA zone the day boundaries in reports are drawn in.
  zone: process.env.TIME_ZONE ?? 'America/New_York',
  // Signs the one-line messages that follow a form post. Set it in production.
  secret: process.env.SESSION_SECRET ?? (production ? '' : 'development-only-secret-do-not-use'),
  // How many proxies in front add to X-Forwarded-For (1 on Railway).
  proxies: Number(process.env.TRUSTED_PROXIES ?? (production ? 1 : 0)),
  // Public address of the app; used for the setup link and as the Web Push contact.
  publicUrl: process.env.PUBLIC_URL ?? '',
  // Web Push identity. Leave unset and one is generated and kept in the database.
  vapid: Object.freeze({ publicKey: process.env.VAPID_PUBLIC_KEY ?? '', privateKey: process.env.VAPID_PRIVATE_KEY ?? '', subject: process.env.VAPID_SUBJECT ?? '' }),
  // Callers should be picked up within this many minutes; reports show how often that happened.
  pickupTargetMinutes: Number(process.env.PICKUP_TARGET_MINUTES ?? 5),
  // One JSON line per request (on by default in production).
  logRequests: (process.env.LOG_REQUESTS ?? (production ? 'true' : 'false')) === 'true',
  // Set to expose /metrics (Prometheus format) to a scraper sending this bearer token.
  photoRetentionDays: Number(process.env.PHOTO_RETENTION_DAYS ?? 90),
  metricsToken: process.env.METRICS_TOKEN ?? '',
  // A vehicle lookup that takes longer than this stops waiting (the rest of the page is already there).
  lookupTimeoutMs: Number(process.env.LOOKUP_TIMEOUT_MS ?? 10_000),
  // Email to customers (one-time sign-in links, request updates). Without these they wait in the outbox.
  mail: Object.freeze({ provider: process.env.MAIL_PROVIDER ?? '', apiKey: process.env.RESEND_API_KEY ?? '', from: process.env.MAIL_FROM ?? '' }),
  // Part-number suggestions from Claude. Without a key the finder still works from what the shop has saved.
  ai: Object.freeze({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-haiku-5-5',
    webSearch: (process.env.AI_WEB_SEARCH ?? 'true') === 'true',
    domains: (process.env.AI_SEARCH_DOMAINS ?? '').split(',').map((d) => d.trim()).filter(Boolean),
    hourly: Number(process.env.AI_HOURLY_LIMIT ?? 30),
    daily: Number(process.env.AI_DAILY_LIMIT ?? 200),
  }),
});

export function checkConfig(c = config) {
  if (c.production && c.secret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 characters in production.');
}
