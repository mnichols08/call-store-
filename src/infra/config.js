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
});

export function checkConfig(c = config) {
  if (c.production && c.secret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 characters in production.');
}
