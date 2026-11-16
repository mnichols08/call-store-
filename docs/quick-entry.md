# Quick entry

On a call, type what the caller asks for the way you would say it, and press Enter.

    90 eclipse front brakes         → Front brakes · 1990 Mitsubishi Eclipse
    front struts for 2000 tacoma    → Front struts · 2000 Toyota Tacoma
    universal joint for 2007 chevy 3/4 ton → U-joint · 2007 Chevrolet Silverado 2500 (a guess: check the model)

Each Enter is one line. Lines that follow stay on the same vehicle until you type another:

    07 cherokee 4.0     sets the vehicle: 2007 Jeep Cherokee 4.0L
    front shocks        → Front shocks · 2007 Jeep Cherokee 4.0L

- A line with only a year, engine or drivetrain (`5.4`, `4x4`) changes the current vehicle. A line with a make or model starts a new one.
- Order does not matter: part first or vehicle first, `2 front struts`, `struts x2`, `a pair of wiper blades`.
- A part number in the line (`alternator AW4066`) is kept with the part.
- **A VIN** (17 characters) is a vehicle of its own: it is decoded when you press Enter, and the lines after it are for that vehicle. With a customer on the call, the vehicle is saved to them. If the decoder can't read it, the line keeps the VIN and says why.
- **Paint**, in any order: `1qt d3 valspar single stage`, `paint WA8555`, `nason basecoat clearcoat 040 2 qts`, `2 spray cans of paint ua`. A line is paint when it says "paint", a brand (Nason, Valspar) or a type (touch-up, spray can, single stage, basecoat/clearcoat; `ss`, `bc`, `cc` once it's already paint). The amount is a number with oz, qt or gal (`1qt`, `8 oz`, `half gallon`). What's left is the paint code. The line shows a paint card (code, type, brand, amount) and never goes to the part finder.
- Under the box, a read-back shows what it understood before you press Enter. Anything it had to guess (such as a truck from `3/4 ton`) is marked.
- Each line is worked down the list: **Open**, **Found it**, **Need to order**, **Can't get**. Change a line (the lines after it are read again, and it is asked about again) or remove it.

## Part-number suggestions
Every part line goes into a queue, and the part finder looks it up in the background, one line at a time: the shop's own answers first, the AI only when there are none (`docs/parts-finder.md`). Up to five suggestions land under the line, marked when they came from the AI and nobody has checked them yet. A line typed before any vehicle waits for one; without an AI key, only saved answers are shown. The page redraws when an answer arrives. The queue is `src/app/finder.js`.

The vehicle lookup panel that used to sit on the right is gone: the vehicle comes from these lines. The customer's vehicles on file still show there, with **Use**.

## How it works
Reading the line is fixed rules, not AI, so the same text always gives the same answer and it works with no network: `src/domain/quickline.js` with the names in `src/domain/vehicle-names.js`. The page and the server use the same file, so the read-back is exactly what is saved. The call's own vehicle fields follow the last line, so vehicle lookup, the parts finder and the queue see the same call. VIN and unit number are never overwritten.

Without JavaScript the box is a plain form: type, press Add, the page reloads.

## Limits
The model list is a convenience, not a catalogue: a word after a make that it does not know is taken as the model (marked as a guess). Engine codes such as `22re` stay in the part text. Add makes and models in `vehicle-names.js`.
