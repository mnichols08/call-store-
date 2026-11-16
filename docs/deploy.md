# Deploying

One process and one SQLite file. Any host that runs Node 22.13+ and keeps a disk between restarts will do; these notes use Railway.

## Settings

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32`). The app refuses to start without it. |
| `DATABASE_PATH` | A path **on a volume**, e.g. `/data/call-store.db`. Without a volume the database is lost at every deploy. |
| `BUSINESS_NAME`, `TIME_ZONE` | Shown in the header; the zone draws report days. |
| `PICKUP_TARGET_MINUTES` | How quickly callers should be picked up (default 5). Reports show how often that happened. |
| `LOG_REQUESTS` | One JSON log line per request. On in production by default. |
| `METRICS_TOKEN` | Set it to expose `/metrics` to a scraper sending `Authorization: Bearer <token>`. Unset, `/metrics` doesn't exist. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Identity for Web Push. Leave unset and a key pair is made once and kept in the database; set them if you want them to survive a fresh database. Subject is `mailto:you@example.com` or your https address. |
| `TRUSTED_PROXIES` | `1` behind Railway's proxy, so sign-in limits count real client addresses. |
| `PUBLIC_URL` | The site's address, used to print the first owner's link. |

`railway.json` sets the start command and a health check on `/healthz`. Migrations run on start.

## First start

The log prints `Set up the first owner: …/staff/accept?token=…`. Open it, choose an email and password. That link works once and expires; restarting before you use it prints a fresh one. Then invite everyone from **People** (owner only).

Lost the owner's password and signed out everywhere? In a shell on the host, `npm run recover-owner` prints a one-time link that sets a new one (add the email if there is more than one owner). Another owner can also make a reset link from **People**.

## Backups

```sh
npm run backup            # backups/call-store-YYYY-MM-DD.db next to the database, newest 14 kept
npm run backup -- /data/backups
```

The app takes this copy by itself when it starts and then every 24 hours (`BACKUP_DIR` to move them, `BACKUP_EVERY_HOURS=0` to turn it off), and logs `Backed up to …` or `Backup failed: …`. It uses SQLite's `VACUUM INTO`, which is a consistent copy while the app is running. Copy the files off the volume now and then: a backup on the same disk doesn't survive losing the disk. To restore, stop the app, replace the database file with a backup, start it.

## Updating

Deploys restart the process (a few seconds). New migrations apply on start, each in a transaction; one that fails leaves the database as it was and the app doesn't start. Take a backup first.

## Limits worth knowing

- One instance only: sign-in lockouts, the rate limiter and live updates live in the process.
- `node:sqlite` prints an experimental warning on Node 22. It is expected.

## Notifications on phones

Web Push works over https only. On an iPhone the app has to be added to the Home Screen first (Share, then Add to Home Screen); Android and desktop browsers can turn notifications on from the Today page directly. Everything still works without push: nudges wait on Today.
