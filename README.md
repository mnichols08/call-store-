# Call Store

A call desk for the parts counter. Someone answers the phone, writes down what the caller needs, and the call goes into a shared queue that coworkers can see, claim, park, help with and finish. Customers and items are kept so the regulars are recognised and the same parts aren't described from scratch.

Built for Southern Auto Supply on [Zubra](https://github.com/journey-to-code-org/zubra), [Zubra UI](https://github.com/journey-to-code-org/zubra-ui) and the [Potomac kit](https://github.com/potomac-solutions/kit). It takes the ideas of [Parts Counter](https://github.com/mnichols08/parts-counter) (the ticket is the unit of work; entering information should never take longer than writing it on paper) and drops the Rust/WASM core for plain Node.

## What it does

- **Calls.** A call can start with nothing. Add the caller, the request, part numbers, the vehicle or equipment, and notes in any order; it saves as you type. Press **N** anywhere to start one.
- **Caller lookup.** Phone number in any format (or just the last four digits), name, or account number. **No customer is a normal state**, and one can be attached later without starting over.
- **Shared queue.** All open, mine, unassigned, needs help, parked, finished. Claiming is one-winner: two people can't take the same call. Park a call and come back to it; ask anyone, or one coworker, for a hand.
- **Outcomes and history.** A call ends with what came of it (quoted, sold, no sale, unavailable, callback…). Every change is on the call's timeline, attributed to the person who made it.
- **Customers.** People and businesses, any number of phones, contacts, and a history of their calls.
- **Items.** A catalog anyone can add to mid-call; managers correct and retire.
- **Staff.** Sign-in, invitations, password changes and roles (owner, manager, staff) from the kit. Reports and an activity log for managers.
- **Works without JavaScript.** Every page is server-rendered; autosave, live lookup and live queue updates are added on top.

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
