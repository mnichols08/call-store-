# Changelog

## Unreleased

### Fixed
- Text cut by a length limit in the middle of an emoji no longer breaks the pages that show it (found by the Zubra stress tests). Input is made well-formed, limits never split a character, and component props are cleaned.

### Added
- Zubra stress tests and benchmark (`npm run stress`); findings in `docs/zubra-findings.md`.
- Calls: start blank, capture progressively with autosave, claim, park, resume, ask for help, assign, finish with an outcome, reopen; timeline and audit trail.
- Customers (people and organisations, many phones, contacts, history) and caller lookup by phone, name or account number.
- Items catalog; add mid-call, link to calls.
- Shared queue with live updates; Today dashboard; reports with CSV; activity log.
- Staff sign-in, invitations, roles and password changes through the Potomac kit.
- Calls where a coworker asked you for help are shown first on Today.
- `npm run backup` (consistent live copy, newest 14 kept), Railway config and deployment notes.
- Nudges (toast, Today panel, Web Push), with automatic nudges when you ask someone for help or assign them a call; limited to 10 a minute per person.
- Printable call tickets and print-ready reports and queue.
- Reports: wait to pick up, share picked up within target (`PICKUP_TARGET_MINUTES`), time to finish, per-person, longest waiting now, timing CSV.
- JSON request logs (`LOG_REQUESTS`), request ids, and `/metrics` (`METRICS_TOKEN`).
- Look and feel of the drawer counter: dark navy and pale-blue themes (follows the system, 🌙/☀️ toggle), frosted cards over the Southern Auto Supply artwork, blue accent, 44px controls, offline pill.
- SQLite storage with checksummed numbered migrations; Zubra-rendered pages that work without JavaScript.
