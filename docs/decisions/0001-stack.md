# 0001. Stack

Status: proposed, built against. Decided by: Mikey Nichols (to confirm).

## Context

A call desk for one store's counter staff, replacing paper and scattered notes. Parts Counter planned it with a Rust/WASM core, PostgreSQL and WebSockets; the ask here is the same product with "less Rust complexity at the core" and a more conventional, enterprise shape, built on Zubra, Zubra UI and the Potomac kit.

## Decision

| Part | Choice | Why |
| --- | --- | --- |
| Language | JavaScript (ES modules), Node 22.13+ | The kit is plain JS for Node 22.13+. No build step. |
| HTTP | `node:http` and a 30-line router | The kit's staff pages speak Node's request and response; fewer layers between. |
| Database | SQLite through `node:sqlite` | One file, real transactions, no server to run. The kit's store contract (synchronous reads, write stored before it returns) is what the driver gives for free. |
| Migrations | Numbered SQL files, checksummed | The only way the schema changes. A changed applied migration is refused. |
| UI | Server-rendered Zubra components via `@zubra/server`, no client framework | Pages work before and without JavaScript. Zubra UI parts carry the forms. |
| Identity | `kit/staff` | Accounts, scrypt passwords, sessions, invites, lockouts, roles. Not rewritten. |
| Rate limit | In-process limiter on sign-in | The kit's lockouts reset on restart and its README asks for one. |
| Realtime | Server-sent events | One-way "something changed" is all the queue needs; no WebSocket server. |
| Tests | `node:test` | Domain and application tests on in-memory SQLite; HTTP tests against a real server. |
| Kit and Zubra UI | Copied in at recorded commits (`vendor/MANIFEST.md`) | The kit is private and unpublished; Zubra UI has no tagged release. |

## Layers

`domain` (rules, no I/O) ← `app` (permissions, transactions, audit) ← `web` (HTTP, pages). `infra` (SQLite, config) is handed to `app`. The domain never imports a driver or a framework; the web layer never writes SQL.

## Where it differs from the kit

- `kit/stages` is a straight line of steps with one owner. A call parks, resumes, goes back to the queue and is reopened, and its status, owner and help state are separate. The lifecycle is `src/domain/call.js`.
- `kit/customers` is shopper accounts that sign themselves up. Here customers are records staff keep, so they are ordinary tables.

## Consequences

- One process, one SQLite file on a persistent volume. A deploy may mean a few seconds down; fine for a counter. Moving to PostgreSQL later means rewriting `src/infra` and the SQL in `src/app`.
- `node:sqlite` is still marked experimental in Node 22 and prints a warning.
- Staff lockouts and the sign-in limiter live in the process; several instances would count apart.
- Live updates are per process; several instances would need a shared channel.
