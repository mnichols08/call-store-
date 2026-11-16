# Changelog

## Unreleased: customer numbers, known addresses, owner recovery
- Caller lookup: a bare number means that customer. The account with exactly that number comes first, then the record with that id, then everything else. Typing `965` and pressing Enter puts customer 965 on the call.
- Delivery: a customer on file no longer needs an address typed. The address on their account is filled in (or left as "usual address" when none is written down). The cash customer (account 0, or no customer on the call) is still asked. An owner can switch this off on the Deliveries page.
- `npm run recover-owner` prints a one-time link for an owner who is locked out. Nothing is deleted.

## Unreleased: invites, passkeys and texts
- New **Invite** page (staff menu). Someone at a customer: find or add the customer first, then send a one-time link by text, email, or a QR code on your screen. The person picks their name, then a passkey or a username and password; they never choose their customer. The same "Invite a person" form is on each customer's Online account panel.
- Employees: managers invite counter staff, the owner invites anyone (kit PR #21). The link goes by text, email or QR; the employee picks a password (no passkeys for staff).
- Portal sign-in: passkey, or username and password, with the emailed link kept as a backup. Accounts no longer need an email; updates go by text to accounts with only a phone.
- Texts go through Brevo or Twilio (`SMS_PROVIDER`), or wait in the Outbox when neither is set up.
- Migration 014 rebuilds `portal_accounts`; migrations that rebuild a table run with foreign keys off and checked before commit.

## Unreleased: call lines as work
- Quick entry reads a **VIN** (decoded when you press Enter; the lines after it are for that vehicle; saved to the customer) and **paint** in any order (`1qt d3 valspar single stage`): code, type (touch-up, spray can, single stage, basecoat/clearcoat), brand (Nason, Valspar) and amount in oz, qt or gal, shown as a paint card.
- Every part line is queued for part-number suggestions in the background (saved answers first, then the AI); up to five show under the line.
- Each line is worked down the list: open, found it, need to order, can't get.
- The vehicle lookup panel on the right of a call is gone; the vehicle comes from quick entry. The customer's vehicles on file stay.
- Zubra packages upgraded from 5.17.0 to 5.19.0 (5.17 and 5.18 have Host header and router guard bypasses).

## Unreleased: backups and support
- The app now backs itself up: a copy of the database at start and every 24 hours, newest 14 kept (`BACKUP_DIR`, `BACKUP_EVERY_HOURS`).
- New `docs/support.md` (what to do when something breaks, handing it over) and `docs/owner-sheet.md` (a one-page "if it stops working" sheet for the owner).

## Unreleased: brand and search
- The shop's own logo replaces the placeholder badge on the public page and the customer portal (`public/logo.webp`), with favicon, home-screen icons and a web app manifest.
- Sharing the page now shows a 1200×630 preview image (`public/og-image.jpg`); Open Graph and Twitter card tags added.
- Search: a keyword title ("Southern Auto Supply | NAPA Auto Parts in Mt. Lake Park, MD"), a description of result length, canonical address, richer structured data (service area, brand, what we sell, image and logo), sitemap with a last-modified date. Staff and portal pages are marked noindex.

## Unreleased: manager pages polish
- Activity shows plain words ("Call taken", "Hours changed") instead of event codes; the code is still in the tooltip.
- Hours: form labels sit above their fields, Save is a proper blue button, and the week table fills the card on phones.

## Unreleased: customer portal look
- Portal pages and private link pages now match the public page: navy header with the logo, light cards, blue buttons, no truck photo behind the text. Styles live in `public/customer.css`; `layout()` takes `customer: true`.

## Unreleased: landing page redesign
- The public page is rebuilt with its own stylesheet (`public/site.css`): a dark NAPA-blue hero with the shop's artwork, a yellow facts band, icon cards for what we carry and the specialty services, three steps for ordering online, a professionals section, hours and find-us cards, and the shop's story. Sticky header with a call button; two-column cards on phones. The truck photo no longer shows through the page.
- `layout()` takes `bare: true` for pages that bring their own header and styles.

## Unreleased: design system (owner and manager)
- Reports is now an interactive page (a Svelte island): switch the range without reloading, see calls per day against the period before, and each speed number beside what it was. Numbers come from `/reports.json`; without JavaScript the plain tables and range links still work.
- Today shows managers and owners who is waiting longest (late calls in red) and what each person has open, plus the date.
- Fix: "Picked up in undefined min" when no pickup target is configured; it now uses the 5-minute default.

## Unreleased: quick entry
- Call screen: type what the caller wants the way you say it (`90 eclipse front brakes`, `front struts for 2000 tacoma`, `universal joint for 2007 chevy 3/4 ton`) and press Enter. Each Enter is one line; following lines stay on that vehicle until a new one is typed (`07 cherokee 4.0`). Fixed rules, no AI, with a live read-back. The call's vehicle and queue title follow the lines. See docs/quick-entry.md.

## Unreleased: part helper
- Customers describe a part on their private link or portal request with a guided page (a small Svelte island, the first build step in the project): photos with upload status, an optional AI look that suggests the kind of part and reads printed or stamped numbers, and size fields with live checking and inch/mm conversion. The AI only suggests; sizes it did not read off the part are dropped, and the customer checks everything before sending. See docs/part-helper.md.

## Unreleased: design system (counter screens)
- Call screen: the caller and the request come first, with the work tools (actions, vehicle lookup, parts finder, items) in a sticky right-hand column and the timeline folded away. The calls queue marks help requests and high-priority calls with a colored edge. Form labels and file pickers are tidied.

## Unreleased: design system (staff)
- Staff screens move to a sidebar app shell: grouped navigation with icons, a New call button, the signed-in person and theme switch at the foot, and a menu drawer on phones. Neutral surfaces in light and dark, brand blue as the accent, and no photo behind staff work. Notifications offer is a single line. The public page and customer portal are unchanged for now.

## Unreleased: delivery
- Deliveries: customers ask for it on a web request (address required), staff add it to any call, move it ready, out, delivered, and customers are told. Deliveries list by town and a printable driver sheet. Towns outside the service area are flagged, not refused. See docs/delivery.md.

## Unreleased: account types and counter card
- Customers are retail, pro or fleet: a badge, a list filter, and a `Type` column on import.
- A printable counter card with a QR code to online ordering, plus the shop's hours.

## Unreleased: order notebook
- Scan a photo of a page of the special-order notebook. The AI reads the date and the four columns; a person checks every line before anything is saved. Orders list with received and paid. See docs/orders.md.
- Fix: an impossible date such as 2026-13-45 on the Hours page could raise an error; dates are now checked safely.

## Unreleased: import and specialty jobs
- Import a customer list (ID, Name, Phone) from a CSV: look it over, then confirm. No twins, nothing deleted. See docs/import-and-jobs.md.
- Request types for hydraulic hose assembly, paint mixing, batteries and special orders, with their own questions and choice fields.

## Unreleased: public page and hours
- `/` is now the shop's public page for signed-out visitors (signed-in staff still get Today); robots.txt, sitemap and structured data.
- Opening hours (`src/domain/hours.js`, `src/domain/shop.js`), a manager Hours page for closures and special hours, and an after-hours note for portal customers.

## Unreleased — scanning
- Staff scan a customer's one-time badge (camera, photo or paste) to find them and start a call.
- A rep's own QR lets a customer ask for access; staff approve and a join link goes out. See docs/portal.md.

## Unreleased — QR codes
- QR codes now come from the shop's own Symbology library (`@journey-to-code/symbology`) instead of `qrcode-generator`. A test draws a code into pixels and reads it back with Symbology's decoder.

## Unreleased — streaming
- The call page is sent at once; the vehicle matches stream in when the lookup finishes (Zubra promise props). Slow or failing lookups stop waiting after `LOOKUP_TIMEOUT_MS` and show a plain message. See docs/zubra-findings.md.
- The part finder's AI answers stream in too: saved answers and the page show at once, "Asking the AI…" holds the place. A reload never asks the AI again.

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
