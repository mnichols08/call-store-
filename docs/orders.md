# The order notebook

Special orders written in the counter notebook (line code, part number, where it was ordered from, customer) can be brought in from a photo.

## How it works
1. **Orders → Scan a page** (owner and managers). Take a photo of a page, flat and in good light, with the whole page in frame.
2. The browser redraws the photo at 1,600 px (this also drops camera metadata such as location) and sends it to the server, which sends it to Claude Haiku to read. The photo is **not kept**.
3. You get a form with one editable line per order, the date of the page, and a customer match for each name (one clear match is chosen; several are offered). Fields the AI wasn't sure of are outlined in red. A weekday in the header that doesn't fit the date is flagged. Crossed-out lines start unticked.
4. Nothing is saved until you press **Save these orders**. A line already saved for the same day (same code, part number and customer) is skipped, so saving a page twice is safe.

Saved orders appear in **Orders**, newest page first, searchable by customer, part number, supplier or line code, with a "still waiting" filter. Any staff member can mark an order received or paid; only managers can scan, save or remove.

## What to know
- **It will make mistakes.** Handwriting is hard: 0 and O, 1 and 7, and names especially. That is why every line is checked by a person and why the AI is told never to guess or "correct" a part number. The weakest fields are outlined.
- **Privacy.** The photo, which can show customers' names, goes to the AI service for the read. This is different from the part finder, which never sends customer data. Read photos are limited to 15 an hour per person, and each read is recorded in the activity log with its size (never the contents).
- Needs `ANTHROPIC_API_KEY`. Without it the page says so and the Orders list still works.
- The notebook's right-hand check marks become "received"; "paid" next to a name becomes the paid flag.

Code: `src/domain/orders.js` (cleaning), `src/infra/ai.js` (`readSheet`), `src/app/orders.js`, `src/web/pages/orders.js`, `public/orders.js`.
