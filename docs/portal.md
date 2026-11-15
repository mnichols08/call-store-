# Customer portal

Customers send parts requests online and follow them without calling. Staff see them in the same queue as phone calls (marked **Web**).

## Joining
- Accounts exist only through an **invite**: a QR code (drawn here by Symbology, nothing sent to another service) a rep shows from the customer's page (or an emailed link), or one a member of that business shows from **Team**.
- An invite is 48 hours, ten people at most, and can be turned off from the customer's page. Only a hash is stored.
- The person gives a name and email; a **one-time link** goes to that email (30 minutes). Opening it only asks to confirm, so mail scanners can't use it up.
- An account belongs to one business. The first person from a business is its admin; admins (and shop managers) can remove people.
- Every later sign-in is the same: ask for a link, get it by email. The answer is identical whether or not the address has an account.

## Requests and updates
- A request becomes a call (`source = web`) in the shared queue. "Needed today" makes it high priority.
- Staff pick an update on the call (looking, need more info, confirmed, in stock, ordered, on the way, ready, can't get it, done), optionally with a message and an email. The customer sees the timeline on their dashboard; everyone at the business sees the business's open requests.
- Customers can add a note, measurements and photos (same limits and metadata stripping as the private link). Staff never see anything they shouldn't, and customers never see internal notes, helpers, outcomes or other businesses' requests.

## Email
Set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, and `PUBLIC_URL` (emailed links use it, never the Host header). Without a mail key, messages wait in **Outbox** (managers) so nothing is lost.

## Limits
Per-address and per-IP rate limits on joining, sign-in and uploads; 20 requests a day per person; staff invites limited per hour.

## Not built yet
SMS sign-in (a Twilio version of the same one-time link), prices and ordering/payment, inventory or POS links, reading stamped part numbers from photos.
