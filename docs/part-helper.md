# The part helper

A customer who has been sent a private link (`/d/<token>`), or who opens a request in the customer portal, gets a guided page to describe the part: photos, what it is, and the sizes.

## What the customer sees

1. **Photos.** Take or add pictures. Each is shrunk and stripped of camera data in the browser, uploaded, and shown with a Sent or Try again badge.
2. **"Take a look at my photos"** (only when the AI is switched on and there is at least one photo). The AI looks at the newest three photos and suggests the kind of part, any numbers printed or stamped on it, and what to measure next. **It only suggests.** Nothing is saved until the customer presses Send.
3. **What is it?** Pick the kind of part or job, choose millimetres or inches, and fill in the sizes. Fields the AI filled are marked "from your photo, please check". Sizes show their conversion, and a bad number is flagged as the customer types, using the same rules as the server (`src/domain/measure.js`).

Without JavaScript the page falls back to the plain form and upload box.

## What the AI is allowed to do

- Only a **real part type** from the list is kept.
- A size is kept only if the AI marks it as **printed or stamped on the part** (or on a ruler next to it). Sizes judged by eye are dropped, as are impossible numbers and fields that don't exist (`cleanPartReading`).
- Only the pictures are sent, with no name, phone number, vehicle or notes. The page tells the customer that the photos are shown to an AI service.
- Six looks an hour per request and 300 a day in total. Each look is recorded on the call's timeline and in the audit log.

## Where the code is

| Piece | File |
| --- | --- |
| Island (Svelte) | `src/islands/PartHelper.svelte`, `src/islands/part-helper.js` |
| Built output (committed) | `public/islands/part-helper.js`, `.css` |
| Build | `npm run build:islands` (esbuild and Svelte, dev dependencies only) |
| Page mount and no-JS fallback | `partHelper()` in `src/web/pages/details.js` |
| Endpoints | `POST /d/:token/assist`, `POST /portal/requests/:id/assist`; `…/details` also answers JSON |
| AI call and cleaning | `readPart` in `src/infra/ai.js`, `cleanPartReading` in `src/domain/measure.js`, `assist` in `src/app/details.js` |

The built files are committed, so running the shop needs no build step. Only changing the island does: edit it, run `npm run build:islands`, commit both.
