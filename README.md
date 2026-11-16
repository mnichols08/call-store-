# Call Store

A call desk for the parts counter. Someone answers the phone, writes down what the caller needs, and the call goes into a shared queue that coworkers can see, claim, park, help with and finish. Customers and items are kept so the regulars are recognised and the same parts aren't described from scratch.

Built for Southern Auto Supply on [Zubra](https://github.com/journey-to-code-org/zubra), [Zubra UI](https://github.com/journey-to-code-org/zubra-ui) and the [Potomac kit](https://github.com/potomac-solutions/kit). It takes the ideas of [Parts Counter](https://github.com/mnichols08/parts-counter) (the ticket is the unit of work; entering information should never take longer than writing it on paper) and drops the Rust/WASM core for plain Node.

## What it does

- **Calls.** A call can start with nothing. Add the caller, the request, part numbers, the vehicle or equipment, and notes in any order; it saves as you type. Press **N** anywhere to start one.
- **Caller lookup.** A customer number first: type `965` and press Enter, and customer 965 is on the call. Otherwise a phone number in any format (or just the last four digits), a name, or an account number. **No customer is a normal state**, and one can be attached later without starting over.
- **Shared queue.** All open, mine, unassigned, needs help, parked, finished. Claiming is one-winner: two people can't take the same call. Park a call and come back to it; ask anyone, or one coworker, for a hand.
- **Outcomes and history.** A call ends with what came of it (quoted, sold, no sale, unavailable, callback…). Every change is on the call's timeline, attributed to the person who made it.
- **Customers.** People and businesses, any number of phones, contacts, and a history of their calls.
- **Items.** A catalog anyone can add to mid-call; managers correct and retire.
- **Nudges.** Ask a coworker to look at a call, with an optional note. It appears as a toast if they have a page open, waits on their Today page until they say "Got it", and reaches their phone or desktop by Web Push if they've turned notifications on. Asking for help from someone, or assigning them a call, nudges them automatically.
- **Print.** Every call prints as a plain one-page ticket (`/calls/:id/print`); reports and the queue print cleanly too. Save as PDF from the print dialog.
- **How fast.** Reports show how long callers wait to be picked up, how often that beats your target, how long calls take to finish, who finished what, and the longest wait right now. Timing CSV for a spreadsheet.
- **Watching it run.** `/healthz`, one JSON log line per request (with durations), and a token-protected `/metrics` in Prometheus format for Grafana.
- **Staff.** Sign-in, invitations, password changes and roles (owner, manager, staff) from the kit. Reports and an activity log for managers.
- **Works without JavaScript.** Every page is server-rendered; autosave, live lookup and live queue updates are added on top.

- **Vehicle lookup and part finder.** VIN, year and model (closest match), or year / make / model / engine / drivetrain; then NAPA, Balkamp and Dorman numbers from the shop's own saved answers first and Claude only when nothing is saved. See `docs/parts-finder.md`.
- **Live.** Watch a coworker's call and suggest a part number to them, with a manager/owner switch (off by default).

## Run it

Needs Node 22.13 or later.

```sh
npm install
npm run migrate          # creates data/call-store.db
npm run seed             # optional: a few customers and items
npm start                # http://localhost:3000
```

The first start prints a one-time link to make the first owner's account. Open it, choose an email and password, then invite everyone else from **People**.

```sh
npm test                 # unit, application and HTTP tests
npm run stress           # Zubra speed and memory benchmark (findings in docs/zubra-findings.md)
npm run build:islands    # only after editing a Svelte island in src/islands (the built files are committed)
```

Configuration is environment variables; see [`.env.example`](.env.example). `SESSION_SECRET` is required in production.

## How it is built

```
src/domain/   the rules: call lifecycle, outcomes, phone matching, who may do what. No I/O.
src/app/      what the store can do. Every action checks permission, and writes its audit entry
              and timeline event in the same transaction as the change.
src/infra/    SQLite, migrations, config, the kit's store seam.
src/web/      HTTP, pages, Zubra components. Calls src/app and nothing deeper.
migrations/   numbered SQL; the only way the schema changes.
vendor/       the kit's modules and Zubra UI's components, copied at recorded commits (vendor/MANIFEST.md).
```

The decisions are in [`docs/`](docs/): [stack](docs/decisions/0001-stack.md), [domain](docs/domain.md), [authorization](docs/authorization.md), [deploying and backups](docs/deploy.md).

## Not in this version

Inventory and ordering (the POS stays the source of truth), telephony integration, call transcription, research assistance, team chat, PTO, notifications, offline use, several stores. See [`docs/domain.md`](docs/domain.md#whats-next).

## Customer portal
Customers can send requests, measurements and photos online and follow updates. See [docs/portal.md](docs/portal.md).
The shop's public page and opening hours: see [docs/site.md](docs/site.md).
Scanning the special-order notebook by photo: see [docs/orders.md](docs/orders.md). Customer import and specialty jobs: [docs/import-and-jobs.md](docs/import-and-jobs.md).
