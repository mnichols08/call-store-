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
- Under the box, a read-back shows what it understood before you press Enter. Anything it had to guess (such as a truck from `3/4 ton`) is marked.
- Tick a line when it is handled, change it (the lines after it are read again) or remove it.

## How it works
It is fixed rules, not AI, so the same text always gives the same answer and it works with no network: `src/domain/quickline.js` with the names in `src/domain/vehicle-names.js`. The page and the server use the same file, so the read-back is exactly what is saved. The call's own vehicle fields follow the last line, so vehicle lookup, the parts finder and the queue see the same call. VIN and unit number are never overwritten.

Without JavaScript the box is a plain form: type, press Add, the page reloads.

## Limits
The model list is a convenience, not a catalogue: a word after a make that it does not know is taken as the model (marked as a guess). Engine codes such as `22re` stay in the part text. Add makes and models in `vehicle-names.js`.
