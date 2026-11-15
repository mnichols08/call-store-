# Domain

## The call

A call is one phone call, counter visit or continuing inquiry. It is the unit of work, and it is valid with nothing in it. Every field is optional and may arrive in any order: `6205-2RS` alone is a call; so is "need a water pump, 2008 F-150"; so is an unknown walk-in.

Three things about a call are independent:

| | Values |
| --- | --- |
| **Status** | open, working, parked, resolved, closed |
| **Assignment** | nobody, or one person |
| **Help** | none, anyone, or one named coworker |

A parked call still belongs to whoever parked it; a call can be open and asking for help. Moves: `open → working | parked | resolved | closed`, `working → parked | resolved | closed | open`, `parked → working | open | resolved | closed`, `resolved → closed | working`, `closed → open`. Resolving or closing needs an outcome.

**Outcomes:** quoted, sold, no sale, unavailable, customer declined, callback required, transferred/referred, closed without sale; optionally the final part numbers, brand, quantity, price and an invoice/reference.

**Claiming** is one winner: the update only succeeds if nobody else holds the call, and the loser is told who does.

**Concurrent edits:** each save carries the revision it started from. If a coworker saved since, nothing is overwritten and the page says so.

**Application** (what it goes on) keeps year, make, model, engine, drivetrain, VIN/serial, fleet/unit number and a free-text field together, so a tractor, a bearing or a hydraulic fitting fit the same form. All optional.

## Records

- **Customer:** a person or an organisation, an optional unique account number, any number of phones (stored as typed, searched by digits), contacts, address, notes, active/inactive. A call may reference one; history is the calls that reference it. A call's customer can be attached or removed later.
- **Item:** SKU (unique, case-insensitive), name, brand, unit, optional price in cents, active/retired. A call lists items with quantities.
- **Call event:** the timeline of a call: who did what and when.
- **Audit event:** the same, for everything, including customers and items.

## Differences from Parts Counter's plan

Same: ticket-first, progressive capture, optional customer, shared queue, help requests, outcomes, timeline, server-authoritative state. Different: plain Node and SQLite instead of a Rust/WASM core and PostgreSQL; server-sent events instead of WebSockets; **calls** are called calls.

## What's next

In rough order: notifications when someone asks you for help; recent-calls search by part number across history; saved vehicles/equipment on a customer (promote a call's application); an attachment store; team chat and PTO if wanted; research assistance; a PostgreSQL option; dark mode.
