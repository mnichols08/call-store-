# Keeping it running

For whoever looks after the call desk. The owner's version is [owner-sheet.md](owner-sheet.md).

## What can go wrong, and what to do

| Sign | Likely cause | Do this |
| --- | --- | --- |
| The site won't load | App stopped or host is down | Check `/healthz`. In Railway, open the service, read the latest deploy log, and redeploy the last good deploy. |
| It loads but a page errors | A bad deploy | Roll back to the previous deploy in Railway. The database is untouched by a rollback. |
| Everyone is signed out | `SESSION_SECRET` changed | Put the old value back. |
| Data is missing | The volume wasn't mounted (`DATABASE_PATH` must be on it) | Fix the mount, then restore the newest backup if needed. |
| Online parts lookup says it can't help | The AI, NHTSA or fueleconomy service is down or the key is wrong | Nothing breaks: staff look parts up by hand. Check the keys in the host's variables. |
| Customer emails don't arrive | Mail key or sending address | Check the **Outbox** page (staff) and the mail variables. |

## Backups

The app copies the database to `backups/` next to it when it starts and every 24 hours, keeping the newest 14. The log says `Backed up to …` or `Backup failed: …`.

A copy on the same disk doesn't survive losing the disk, so copy the newest file somewhere else each week (a laptop, cloud storage).

To restore: stop the app, replace the database file with a backup, start it. New migrations apply on start.

## Watching it

- `/healthz` answers 200 when the app is up. Point a free uptime monitor (UptimeRobot, Better Stack) at it and have it text or email the person on call.
- `/metrics` (token-protected) has request counts and timings for Grafana.
- One JSON log line per request, with how long it took.

## Handing it over

If the person who built this isn't available, another developer needs only:

1. The repository (`mnichols08/call-store-`) and the [README](../README.md).
2. The host login (Railway project) and where the environment variables are listed.
3. [deploy.md](deploy.md), which covers setup, updating and restoring.

It is plain Node and one SQLite file, with no other servers or services to learn first. `npm test` runs the whole suite in about ten seconds, so a change can be checked before it goes live.
