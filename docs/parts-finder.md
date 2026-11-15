# Vehicle lookup and the part finder

## How an answer is found

1. **The shop's own memory first.** Answers staff confirmed, answers taught by staff, and answers the AI gave before are looked at, best first. A part that fit for three people beats one nobody has tried; a part that failed twice is hidden.
2. **The AI only if memory has nothing**, or if someone presses "Ask the AI again". It is asked only for the vehicle (year, make, model, engine, drivetrain) and the part (or part number). Never the VIN, the customer, a phone number or the call's notes.
3. **Everything the AI says is saved** and shown as "Suggested by AI · not checked yet" until someone says it worked. A source link is kept only if the web search really returned that page. Text from the AI is stripped of markup and capped.

Feedback ("It worked", "Didn't work", "Wrong fit") is one vote per person per answer; changing your mind replaces it. A staff member can also add a number they know is right; it starts confirmed.

## Where vehicle facts come from

| Question | Source | Kept |
| --- | --- | --- |
| What is this VIN? | NHTSA vPIC | 90 days (keyed by a hash, never by the VIN) |
| Models of a make in a year | NHTSA vPIC | 30 days; each year is indexed once, then "closest match" is local |
| Engines and drivetrains | fueleconomy.gov (light vehicles), VIN decodes, and what staff picked | learned for good |

fueleconomy.gov covers cars and light trucks, not heavy trucks. For those the engine and drivetrain boxes take whatever is typed, and are remembered for next time. If NHTSA or fueleconomy.gov is down, saved answers are used and people are told plainly.

## Limits and cost

`AI_HOURLY_LIMIT` and `AI_DAILY_LIMIT` count AI lookups for the whole shop. Saved answers never count. Reports shows how many lookups were answered from memory, today's AI use, tokens and web searches. With no `ANTHROPIC_API_KEY` the finder shows saved answers only. Web search must be enabled for the organization in the Anthropic Console, and is billed per search.

## Privacy

The VIN is stored on the call and on the customer (when one is attached). Logs and the audit trail for lookups carry only the last six characters. The Anthropic key is read on the server and is never sent to a browser.

## Measurements and photos

Pick what kind of part it is (bearing, seal, belt, hose, fitting, wiper, filter) and enter the numbers that identify it, in millimetres or inches. Fractions like `1 1/2` are fine. A complete set of measurements becomes a key such as `bearing id25 od52 w15 mm`, the same whichever unit it was entered in. "Find by these measurements" looks for that key in the shop's saved answers first, and only then asks the AI, which is told the key and nothing about the customer. A part number staff confirm for the key is saved and shown first next time.

Photos are accepted only if they really are JPEG, PNG or WebP, are limited to 8 per call and 6 MB each, and have EXIF, XMP and text metadata removed (so location is never kept). The page shrinks a photo before sending it, which removes metadata too. They are served only to signed-in staff, and deleted `PHOTO_RETENTION_DAYS` (90) after the call closes.

## The customer link

"Make a link for the customer" gives a one-time address (shown once; only a hash is stored) that works for 48 hours for that call. The customer can give measurements, send photos and add a note, nothing else. Staff are nudged when something arrives. "Turn the links off" ends it early, and finishing the call ends it too. The link is sent by whatever the staff member uses (the "Text it" button opens their phone's messages); the app does not send texts itself yet.
