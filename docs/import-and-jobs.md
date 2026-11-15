# Customer import and specialty jobs

## Importing customers
**Customers → Import list** (managers and the owner). Paste a spreadsheet or choose a CSV/TSV file. Columns are found by their header: `ID` (the account number), `Name`, `Phone`, and optionally `Address` and `Notes`. Tabs, commas, semicolons and pipes all work, so a copy straight from a spreadsheet is fine. A cell with several phones can separate them with `;`, `/`, `|` or "or".

You see what would happen before anything is saved: new, updated, already up to date, or skipped (with the reason). Importing matches an existing customer by account number, or by the same name and phone when they have no account number yet, so it never makes a twin. An update only changes the name, fills in a missing account number and adds phones that aren't there. Nothing is deleted. A whole import is saved together or not at all, and is recorded in the activity log. New names that read as a business (LLC, Farms, Auto, Construction…) start as businesses. Up to 5,000 rows or 600,000 characters at a time.

## Specialty jobs
A customer picks "What kind of job is it?" on a new request: hydraulic hose assembly, paint mixing, battery, or special order. The request page then offers a form with the right questions (lengths and fittings for a hose, paint code and amount, battery group size, and so on), plus photos. Staff see the same form on the call. These never reach the part finder, so they never spend an AI search. The fields live in `src/domain/measure.js`.
