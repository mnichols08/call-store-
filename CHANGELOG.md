# Changelog

## Unreleased — streaming
- The call page is sent at once; the vehicle matches stream in when the lookup finishes (Zubra promise props). Slow or failing lookups stop waiting after `LOOKUP_TIMEOUT_MS` and show a plain message. See docs/zubra-findings.md.

## Unreleased — customer portal
- Customers join by invite (QR code or email), confirm by one-time email link, and see their business's requests and updates. See docs/portal.md.
- Staff answer web requests with status updates; Outbox page for unsent mail.

## Unreleased

### Fixed
- Text cut by a length limit in the middle of an emoji no longer breaks the pages that show it (found by the Zubra stress tests). Input is made well-formed, limits never split a character, and component props are cleaned.

### Added
- Details and photos on a call: measurement templates (bearing, seal, belt, hose, hydraulic fitting, wiper, filter) in millimetres or inches, up to 8 photos, and a note. Photos are checked to be real JPEG/PNG/WebP and stripped of location and camera data before they're kept; they're deleted 90 days after a call closes (`PHOTO_RETENTION_DAYS`).
- A private link for the customer (no sign-in, one request, 48 hours, revocable, only a hash stored) where they give the same measurements, send photos and add a note. Staff get a nudge when something arrives.
- "Find by these measurements": the part finder looks at what the shop already knows for those measurements before asking the AI, and a part number staff confirm is remembered whichever unit the next person measures in.
- Live: watch a coworker's call (read-only, with their part search as it happens) and suggest them a part number. Off until a manager or owner turns it on; the person being watched sees who is watching, each suggestion reaches them as a nudge and a card they accept (it goes on the call and into the shop's saved answers) or dismiss, and watching is written to the activity log.
- Vehicle lookup on a call: read a VIN (NHTSA), find the closest vehicle from a year and a model ("2015 silvrado"), or pick year / make / model / engine / drivetrain with suggestions. Vehicles are saved to the customer; the picker's lists are learned and kept, so each question is asked of the outside world once.
- Part finder: part by vehicle, or a part number to cross-reference, with NAPA, Balkamp and Dorman numbers. The shop's saved answers are always looked at first; Claude (Haiku, with web search) is asked only when there is nothing saved or someone asks for a fresh search. "It worked" / "Didn't work" / "Wrong fit" buttons teach the shop; staff can add a number they know is right. Hourly and daily limits, and a use panel on Reports.
- Redirects with a `#section` now put the message before the section (the message used to be lost).
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
